const Company = require('../models/Company');
const User = require('../models/User');
const Project = require('../models/Project');
const TimeLog = require('../models/TimeLog');
const Transaction = require('../models/Transaction');
const SupportTicket = require('../models/SupportTicket');
const AuditLog = require('../models/AuditLog');
const Plan = require('../models/Plan');

const getStats = async (req, res, next) => {
    try {
        const totalCompanies = await Company.countDocuments();
        const totalUsers = await User.countDocuments();
        const totalProjects = await Project.countDocuments();
        const activeSubscriptions = await Company.countDocuments({ subscriptionStatus: 'active' });

        // Calculate Revenue from Companies
        const companies = await Company.find();
        const plans = await Plan.find(); // Fetch all plans to lookup prices

        let monthlyRevenue = 0;
        let totalStorageUsed = 0;

        // Create a map for easy plan lookup: ID -> Price AND Name -> Price (lowercase)
        const planPriceMap = {};
        plans.forEach(p => {
            if (p._id) planPriceMap[p._id.toString()] = p.price;
            if (p.name) planPriceMap[p.name.toLowerCase()] = p.price;
        });

        // Add legacy/static plan prices just in case
        planPriceMap['starter'] = 29;
        planPriceMap['business'] = 99;
        planPriceMap['enterprise'] = 499;
        planPriceMap['pro'] = 149;
        planPriceMap['basic'] = 0; // Assuming basic is free or check DB

        companies.forEach(c => {
            totalStorageUsed += (c.storageUsed || 0);
            if (c.subscriptionStatus === 'active' && c.subscriptionPlanId) {
                // Try to find price by ID first (if it's an ID string)
                let price = planPriceMap[c.subscriptionPlanId.toString()];

                // If not found by ID, try by Name (lowercase)
                if (price === undefined) {
                    price = planPriceMap[c.subscriptionPlanId.toString().toLowerCase()];
                }

                if (price) {
                    monthlyRevenue += price;
                }
            }
        });

        // Mocking growth percentages for the UI
        const growth = {
            companies: '+5.2%',
            subscriptions: '+3.1%',
            revenue: '+12%',
            users: '+8.4%',
            projects: '+4.5%',
            storage: '+15.2%'
        };

        // Generating a simple 12-month revenue trend (semi-mocked for visualization)
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonth = new Date().getMonth();
        const revenueData = [];

        for (let i = 11; i >= 0; i--) {
            const m = (currentMonth - i + 12) % 12;
            const baseValue = monthlyRevenue / 1000;
            const factor = 1 - (i * 0.05); // Simulated historical data
            revenueData.push({
                name: monthNames[m],
                value: Math.max(0, parseFloat((baseValue * factor).toFixed(1)))
            });
        }

        const recentSignups = await Company.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('name subscriptionPlanId createdAt');

        const formatStorage = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        res.json({
            stats: {
                totalCompanies,
                totalUsers,
                totalProjects,
                activeSubscriptions,
                monthlyRevenue: monthlyRevenue,
                storageUsage: formatStorage(totalStorageUsed),
                rawStorageUsage: totalStorageUsed,
                expiringTrials: 5
            },
            growth,
            revenueData,
            recentSignups
        });
    } catch (error) {
        next(error);
    }
};

const approveCompany = async (req, res, next) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            res.status(404);
            throw new Error('Company not found');
        }

        company.subscriptionStatus = 'active';
        await company.save();

        await User.findOneAndUpdate(
            { companyId: company._id, role: 'COMPANY_OWNER' },
            { isActive: true }
        );

        res.json({ message: `Company ${company.name} approved and activated` });
    } catch (error) {
        next(error);
    }
};

const rejectCompany = async (req, res, next) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            res.status(404);
            throw new Error('Company not found');
        }

        company.subscriptionStatus = 'canceled';
        await company.save();

        await User.findOneAndUpdate(
            { companyId: company._id, role: 'COMPANY_OWNER' },
            { isActive: false }
        );

        res.json({ message: `Company ${company.name} rejected` });
    } catch (error) {
        next(error);
    }
};

// @desc    Get billing transactions and failures (Mixed with Company Subscriptions)
// @route   GET /api/super-admin/billing/transactions
// @access  Private (Super Admin)
const getTransactions = async (req, res, next) => {
    try {
        const { status, limit = 50 } = req.query;
        let query = {};
        if (status) query.status = status;

        // 0. Build Company Display ID Map (Matching Companies Page Logic)
        // Companies page uses User (Owner) index to generate COMP-XXX
        const owners = await User.find({ role: 'COMPANY_OWNER' });
        const companyIdMap = {};
        owners.forEach((user, index) => {
            if (user.companyId) {
                const displayId = String(index + 1).padStart(3, '0');
                companyIdMap[user.companyId.toString()] = `COMP-${displayId}`;
            }
        });

        // 1. Fetch real transactions
        const realTransactionsDocs = await Transaction.find(query)
            .populate('companyId', 'name')
            .lean();

        const realTransactions = realTransactionsDocs.map(t => ({
            ...t,
            // Inject the display ID if company exists
            displayCompanyId: t.companyId ? companyIdMap[t.companyId._id.toString()] : 'N/A'
        }));

        // 2. Fetch companies to simulate subscription transactions
        let virtualTransactions = [];
        if (!status || status === 'paid') {
            const companies = await Company.find({ subscriptionStatus: 'active' });
            const plans = await Plan.find();

            // Build Price Map
            const planPriceMap = {};
            plans.forEach(p => {
                if (p._id) planPriceMap[p._id.toString()] = p.price;
                if (p.name) planPriceMap[p.name.toLowerCase()] = p.price;
            });
            // Legacy
            planPriceMap['starter'] = 29; planPriceMap['business'] = 99;
            planPriceMap['enterprise'] = 499; planPriceMap['pro'] = 149; planPriceMap['basic'] = 0;

            virtualTransactions = companies.map(c => {
                let price = 0;
                if (c.subscriptionPlanId) {
                    price = planPriceMap[c.subscriptionPlanId.toString()] || planPriceMap[c.subscriptionPlanId.toString().toLowerCase()] || 0;
                }

                if (price === 0) return null;

                return {
                    _id: c._id,
                    companyId: {
                        _id: c._id,
                        name: c.name
                    },
                    displayCompanyId: companyIdMap[c._id.toString()] || 'N/A', // Add Display ID
                    amount: price,
                    status: 'paid',
                    date: c.startDate || c.createdAt,
                    createdAt: c.startDate || c.createdAt,
                    invoiceId: 'SUB-' + c._id.toString().substring(18),
                    paymentMethod: 'Subscription',
                    isVirtual: true
                };
            }).filter(t => t !== null);
        }

        // 3. Merge and Sort
        const allTransactions = [...realTransactions, ...virtualTransactions].sort((a, b) => {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        // 4. Limit
        const limitedTransactions = allTransactions.slice(0, parseInt(limit));

        res.json(limitedTransactions);
    } catch (error) {
        next(error);
    }
};

// @desc    Get detailed billing stats for Revenue page
// @route   GET /api/super-admin/billing/stats
// @access  Private (Super Admin)
const getBillingStats = async (req, res, next) => {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);

        // 1. Calculate Net Revenue YTD (Paid transactions in current year)
        // We really should use Real Transactions for this, but if they want "Assign = Revenue",
        // we might need to mimic it. However, usually Net Revenue is CASH collected. 
        // Let's stick to Real Transactions for YTD to be accurate to "Cash Flow", 
        // BUT users often want to see the "Value" of signed contracts.
        // Given the request, I will adhere to MRR for the Trend, but YTD might look low if no transactions exist.
        // Let's keep YTD as real transactions for now unless asked.
        const revenueYTDResult = await Transaction.aggregate([
            {
                $match: {
                    status: 'paid',
                    createdAt: { $gte: startOfYear }
                }
            },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        let netRevenueYTD = revenueYTDResult.length > 0 ? revenueYTDResult[0].total : 0;

        // 2. Calculate Yearly Revenue
        let yearlyRevenue = netRevenueYTD;

        // 3. Calculate Total Refunds
        const refundsResult = await Transaction.aggregate([
            {
                $match: {
                    status: 'refunded',
                    createdAt: { $gte: startOfYear }
                }
            },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalRefunds = refundsResult.length > 0 ? refundsResult[0].total : 0;

        // 4. Calculate Pending Invoices Amount
        const pendingResult = await Transaction.aggregate([
            { $match: { status: 'pending' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const pendingInvoices = pendingResult.length > 0 ? pendingResult[0].total : 0;

        // 5. Calculate MRR (Monthly Recurring Revenue) - Sum of active subscriptions
        const companies = await Company.find({ subscriptionStatus: 'active' });
        const plans = await Plan.find(); // Fetch plans for lookup

        // Map Price
        const planPriceMap = {};
        plans.forEach(p => {
            if (p._id) planPriceMap[p._id.toString()] = p.price;
            if (p.name) planPriceMap[p.name.toLowerCase()] = p.price;
        });
        planPriceMap['starter'] = 29; planPriceMap['business'] = 99;
        planPriceMap['enterprise'] = 499; planPriceMap['pro'] = 149; planPriceMap['basic'] = 0;

        let currentMRR = 0;
        companies.forEach(c => {
            if (c.subscriptionPlanId) {
                let price = planPriceMap[c.subscriptionPlanId.toString()] || planPriceMap[c.subscriptionPlanId.toString().toLowerCase()];
                if (price) currentMRR += price;
            }
        });

        // 6. Generate Monthly Revenue Trend (Last 12 months)
        // BASED ON ACTIVE SUBSCRIPTIONS AT THAT TIME (Proxy: CreatedAt)
        const monthlyRevenueTrend = [];
        for (let i = 11; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1); // End of that month

            // Calculate MRR for this month:
            // Sum of companies created BEFORE nextMonth AND currently active (approximation)
            // A better check would be "created before end of month AND (no expiry OR expiry after start of month)"
            // For simplicity/Trend compliance, we allow all currently active companies created before this month end.
            let monthMRR = 0;
            companies.forEach(c => {
                const created = new Date(c.createdAt);
                if (created < nextMonth) {
                    // Company existed in this month.
                    if (c.subscriptionPlanId) {
                        let price = planPriceMap[c.subscriptionPlanId.toString()] || planPriceMap[c.subscriptionPlanId.toString().toLowerCase()];
                        if (price) monthMRR += price;
                    }
                }
            });

            monthlyRevenueTrend.push(monthMRR);
        }

        // 7. Generate Yearly Revenue Trend (Last 3 Years)
        const yearlyRevenueTrend = [];
        const years = [currentYear - 2, currentYear - 1, currentYear];

        for (const year of years) {
            let yearMRR = 0;
            // Similar proxy logic if needed, or use Transaction data.
            // Usually Yearly performance is Cash Flow, so Transaction data is better.
            // But if empty, it looks broken. Let's hybridize? No, keeping Transaction for Yearly seems safer for "Billing".
            // However, for consistency with Trend, let's use the same "Value" logic if Transaction is 0.
            if (yearlyRevenue === 0 && year === currentYear) {
                yearMRR = currentMRR * 12; // Projecting?
            }

            // Keep existing Transaction logic for Yearly Bar Chart as it usually denotes "Closed Deals"
            const start = new Date(year, 0, 1);
            const end = new Date(year + 1, 0, 1);
            const yearStats = await Transaction.aggregate([
                { $match: { status: 'paid', createdAt: { $gte: start, $lt: end } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]);

            yearlyRevenueTrend.push({
                year,
                total: yearStats.length > 0 ? yearStats[0].total : 0
            });
        }

        res.json({
            netRevenueYTD,
            yearlyRevenue, // New field
            totalRefunds,
            pendingInvoices,
            currentMRR,
            growthTrend: '+12% vs last year',
            monthlyRevenueTrend,
            yearlyRevenueTrend
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get support tickets
// @route   GET /api/super-admin/support/tickets
// @access  Private (Super Admin)
const getSupportTickets = async (req, res, next) => {
    try {
        const tickets = await SupportTicket.find()
            .populate('companyId', 'name')
            .populate('userId', 'fullName email')
            .sort({ updatedAt: -1 });

        res.json(tickets);
    } catch (error) {
        next(error);
    }
};

// @desc    Update support ticket status or add reply
// @route   PATCH /api/super-admin/support/tickets/:id
// @access  Private (Super Admin)
const updateSupportTicket = async (req, res, next) => {
    try {
        const { status, message } = req.body;
        const ticket = await SupportTicket.findById(req.params.id);

        if (!ticket) {
            res.status(404);
            throw new Error('Ticket not found');
        }

        if (status) ticket.status = status;
        if (message) {
            ticket.messages.push({
                senderId: req.user._id,
                senderRole: req.user.role,
                text: message
            });
        }

        await ticket.save();
        res.json(ticket);
    } catch (error) {
        next(error);
    }
};

// @desc    Get all users across all platforms
// @route   GET /api/super-admin/users
// @access  Private (Super Admin)
const getGlobalUsers = async (req, res, next) => {
    try {
        const users = await User.find()
            .populate('companyId', 'name')
            .select('-password')
            .sort({ createdAt: -1 });

        res.json(users);
    } catch (error) {
        next(error);
    }
};

// @desc    Get system audit logs
// @route   GET /api/super-admin/logs
// @access  Private (Super Admin)
const getSystemLogs = async (req, res, next) => {
    try {
        const logs = await AuditLog.find()
            .populate('userId', 'fullName email')
            .sort({ createdAt: -1 })
            .limit(100);

        res.json(logs);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getStats,
    approveCompany,
    rejectCompany,
    getTransactions,
    getBillingStats,
    getSupportTickets,
    updateSupportTicket,
    getGlobalUsers,
    getSystemLogs
};

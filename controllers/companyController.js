const Company = require('../models/Company');
const User = require('../models/User');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Issue = require('../models/Issue');
const Invoice = require('../models/Invoice');
const Photo = require('../models/Photo');
const PurchaseOrder = require('../models/purchaseOrder.model');
const TimeLog = require('../models/TimeLog');

// @desc    Get dashboard statistics for a company
// @route   GET /api/companies/dashboard/stats
// @access  Private (Company Admin/Owner)
const getDashboardStats = async (req, res, next) => {
    try {
        const today = new Date();
        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const endOfToday = new Date(today.setHours(23, 59, 59, 999));

        const companyId = req.user.companyId;
        const userId = req.user._id;
        const role = req.user.role;

        const isStaff = ['WORKER', 'FOREMAN'].includes(role);

        // Define filters based on role
        const taskFilter = { companyId };
        const projectFilter = { companyId, status: 'active' };
        const issueFilter = { companyId, status: 'open' };

        if (isStaff) {
            taskFilter.assignedTo = userId;
            // For staff, we show projects where they have active tasks
            const staffTasks = await Task.find({ assignedTo: userId }).select('projectId');
            const projectIds = staffTasks.map(t => t.projectId).filter(id => id);
            projectFilter._id = { $in: projectIds };
        }

        // Parallel counts for cards
        const [
            todayTasks,
            overdueTasks,
            activeProjects,
            openIssues,
            pendingInvoicesCount,
            totalPhotosToday,
            onSiteEmployees
        ] = await Promise.all([
            Task.countDocuments({ ...taskFilter, dueDate: { $gte: startOfToday, $lte: endOfToday } }),
            Task.countDocuments({ ...taskFilter, status: { $ne: 'completed' }, dueDate: { $lt: startOfToday } }),
            Project.countDocuments(projectFilter),
            Issue.countDocuments(issueFilter),
            Invoice.countDocuments({ companyId, status: { $in: ['unpaid', 'partially_paid', 'overdue'] } }),
            Photo.countDocuments({ companyId, createdAt: { $gte: startOfToday } }),
            TimeLog.countDocuments({ companyId, clockOut: { $exists: false } })
        ]);

        // Outstanding Invoices Sum
        const unpaidInvoices = await Invoice.find({
            companyId,
            status: { $in: ['unpaid', 'partially_paid', 'overdue'] }
        });
        const outstandingAmount = unpaidInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

        // Project Progress (Bar Chart Data)
        const activeProjectsList = await Project.find(projectFilter).limit(5);

        const barData = await Promise.all(activeProjectsList.map(async (p) => {
            const pos = await PurchaseOrder.find({ projectId: p._id, status: 'received' });
            const spent = pos.reduce((sum, po) => sum + (po.totalAmount || 0), 0);

            return {
                name: p.name.length > 10 ? p.name.substring(0, 10) + '...' : p.name,
                progress: p.progress || 0,
                budget: p.budget > 0 ? Math.round((spent / p.budget) * 100) : 0
            };
        }));

        // Task Distribution (Pie Chart Data)
        const taskStats = await Task.aggregate([
            { $match: taskFilter },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const pieData = [
            { name: 'Completed', value: taskStats.find(s => s._id === 'completed')?.count || 0, color: '#10b981' },
            { name: 'In Progress', value: taskStats.find(s => s._id === 'in_progress')?.count || 0, color: '#3b82f6' },
            { name: 'Review', value: taskStats.find(s => s._id === 'review')?.count || 0, color: '#8b5cf6' },
            { name: 'Not Started', value: taskStats.find(s => s._id === 'todo')?.count || 0, color: '#94a3b8' }
        ];

        // Recent Activity (Feed)
        const [recentPhotos, recentProjects] = await Promise.all([
            Photo.find({ companyId }).populate('uploadedBy', 'fullName').populate('projectId', 'name').sort({ createdAt: -1 }).limit(3),
            Project.find({ companyId }).populate('createdBy', 'fullName').sort({ createdAt: -1 }).limit(2)
        ]);

        const activityFeed = [
            ...recentPhotos.map(p => ({
                user: p.uploadedBy?.fullName || 'Member',
                action: 'uploaded a site photo',
                project: p.projectId?.name || 'Project',
                time: p.createdAt,
                type: 'photo'
            })),
            ...recentProjects.map(p => ({
                user: p.createdBy?.fullName || 'Admin',
                action: 'created a new project',
                project: p.name,
                time: p.createdAt,
                type: 'system'
            }))
        ].sort((a, b) => new Date(b.time) - new Date(a.time));

        res.json({
            metrics: {
                todayTasks,
                overdueTasks,
                activeProjects,
                openIssues,
                pendingInvoices: pendingInvoicesCount,
                outstandingInvoices: outstandingAmount >= 1000 ? `$${(outstandingAmount / 1000).toFixed(1)}k` : `$${outstandingAmount}`,
                onSiteEmployees,
                recentPhotos: totalPhotosToday
            },
            barData,
            pieData,
            activityFeed
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all companies (company owners) (Super Admin only)
// @route   GET /api/companies
// @access  Private/SuperAdmin
const getCompanies = async (req, res, next) => {
    try {
        // Fetch users who are company owners and populate company details
        const users = await User.find({ role: 'COMPANY_OWNER' })
            .populate('companyId')
            .select('-password');

        // Map to a structure that the frontend expects, merging user and company info
        const companies = users.map(user => {
            const company = user.companyId || {};
            return {
                ...company._doc, // Company details
                ...user._doc,    // User details (overwrites _id with user._id)
                id: user._id,    // Explicitly set ID to User ID for deletion
                company_id_ref: company._id, // Keep reference to actual company ID
                name: company.name || user.fullName, // Use company name, fallback to user name
                ownerName: user.fullName,
                email: user.email, // Ensure user email is used
                phone: user.phone || company.phone,
                users: company.users // Keep existing virtuals/fields if any
            };
        });

        res.json(companies);
    } catch (error) {
        next(error);
    }
};

// @desc    Get company by ID
// @route   GET /api/companies/:id
// @access  Private (Own company only unless SuperAdmin)
const getCompanyById = async (req, res, next) => {
    try {
        const company = await Company.findById(req.params.id);

        if (!company) {
            res.status(404);
            throw new Error('Company not found');
        }

        // Authorization check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== company._id.toString()) {
            res.status(403);
            throw new Error('Not authorized to access this company');
        }

        res.json(company);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new company (Super Admin only)
// @route   POST /api/companies
// @access  Private/SuperAdmin
const createCompany = async (req, res, next) => {
    try {
        const { name, email, phone, address, startDate, expireDate, plan, planType, password } = req.body;

        const companyExists = await Company.findOne({ name });

        if (companyExists) {
            res.status(400);
            throw new Error('Company with this name already exists');
        }

        const userExists = await User.findOne({ email });

        if (userExists) {
            res.status(400);
            throw new Error('User with this email already exists');
        }

        const company = await Company.create({
            name,
            email,
            phone,
            address,
            startDate,
            expireDate,
            subscriptionPlanId: plan,
            planType
        });

        const user = await User.create({
            companyId: company._id,
            fullName: name + ' Admin',
            email,
            password,
            role: 'COMPANY_OWNER',
            phone
        });

        res.status(201).json({ company, user });
    } catch (error) {
        next(error);
    }
};

// @desc    Update company (accepts User ID or Company ID contextually, but usually Company ID for settings)
// @route   PATCH /api/companies/:id
// @access  Private (Company Owner or SuperAdmin)
const updateCompany = async (req, res, next) => {
    try {
        // Check if ID is a User ID (Super Admin editing from list) or Company ID
        let companyId = req.params.id;
        let userId = null;

        const user = await User.findById(req.params.id);
        if (user && user.role === 'COMPANY_OWNER') {
            userId = user._id;
            companyId = user.companyId;
        }

        const company = await Company.findById(companyId);

        if (!company) {
            res.status(404);
            throw new Error('Company not found');
        }

        // Authorization check
        if (req.user.role !== 'SUPER_ADMIN' && (req.user.role !== 'COMPANY_OWNER' || req.user.companyId.toString() !== company._id.toString())) {
            res.status(403);
            throw new Error('Not authorized to update this company');
        }

        // Update Company Details
        // Sanitize body to remove immutable fields
        const updates = { ...req.body };
        delete updates._id;
        delete updates.createdAt;
        delete updates.updatedAt;

        const updatedCompany = await Company.findByIdAndUpdate(company._id, updates, {
            new: true,
            runValidators: true
        });

        // Update User Details if User ID was found (e.g. email, password from Super Admin)
        if (userId) {
            const userUpdates = {};
            if (req.body.email) userUpdates.email = req.body.email;
            if (req.body.password) userUpdates.password = req.body.password; // Handle middleware hashing usually
            // Note: In a real app, password should be hashed if changed. Assuming User model pre-save hook handles it.

            if (Object.keys(userUpdates).length > 0) {
                // For password hashing to work with pre-save, use findById + save, not findOneAndUpdate
                const userToUpdate = await User.findById(userId);
                if (req.body.email) userToUpdate.email = req.body.email;
                if (req.body.password) userToUpdate.password = req.body.password;
                await userToUpdate.save();
            }
        }

        res.json(updatedCompany);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete company (User & Company)
// @route   DELETE /api/companies/:id
// @access  Private/SuperAdmin
const deleteCompany = async (req, res, next) => {
    try {
        console.log(`Attempting to delete company/user with ID: ${req.params.id}`);

        // The ID passed is now the USER ID because we list Users
        const user = await User.findById(req.params.id);

        if (!user) {
            console.log('User not found, trying company direct delete...');
            // Fallback: try finding company by ID in case it was a direct company ID
            const companyDirect = await Company.findById(req.params.id);
            if (companyDirect) {
                await Company.findByIdAndDelete(req.params.id);
                // Also try to find and delete the owner user if possible
                const deletedOwner = await User.findOneAndDelete({ companyId: req.params.id, role: 'COMPANY_OWNER' });
                console.log(`Direct company delete success. Owner deleted: ${!!deletedOwner}`);
                return res.json({ message: 'Company removed' });
            }
            console.log('User/Company not found');
            res.status(404);
            throw new Error('User/Company not found');
        }

        console.log(`User found: ${user.email}, Company ID: ${user.companyId}`);

        // Delete the associated Company first
        if (user.companyId) {
            const deletedCompany = await Company.findByIdAndDelete(user.companyId);
            console.log(`Company document deleted: ${!!deletedCompany}`);
        }

        // Delete the User
        await User.findByIdAndDelete(req.params.id);
        console.log('User document deleted');

        res.json({ message: 'Company Owner and Company data removed' });
    } catch (error) {
        console.error('Error in deleteCompany:', error);
        next(error);
    }
};

module.exports = {
    getDashboardStats,
    getCompanies,
    getCompanyById,
    createCompany,
    updateCompany,
    deleteCompany
};

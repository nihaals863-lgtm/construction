const Payroll = require('../models/Payroll');
const TimeLog = require('../models/TimeLog');
const User = require('../models/User');

// Canada Tax Rules (2024 Estimates)
const TAX_RULES = {
    CPP_RATE: 0.0595, // 5.95%
    EI_RATE: 0.0166,  // 1.66%
    WCB_RATE: 0.025,  // 2.5% (Construction Estimate)
    FEDERAL_BRACKETS: [
        { limit: 55867, rate: 0.15 },
        { limit: 111733, rate: 0.205 },
        { limit: 173205, rate: 0.26 },
        { limit: 246752, rate: 0.29 },
        { limit: Infinity, rate: 0.33 }
    ],
    ANNUAL_BASIC_EXEMPTION: 3500
};

const calculateDeductions = (grossPay, payPeriodsPerYear = 52) => {
    // Basic CPP Exemption per pay period
    const exemptionPerPeriod = TAX_RULES.ANNUAL_BASIC_EXEMPTION / payPeriodsPerYear;

    const cpp = Math.max(0, (grossPay - exemptionPerPeriod) * TAX_RULES.CPP_RATE);
    const ei = grossPay * TAX_RULES.EI_RATE;
    const wcb = grossPay * TAX_RULES.WCB_RATE;

    // Simple tiered federal tax (annualized for calculation)
    const annualGross = grossPay * payPeriodsPerYear;
    let annualTax = 0;
    let remainingGross = annualGross;
    let prevLimit = 0;

    for (const bracket of TAX_RULES.FEDERAL_BRACKETS) {
        const taxableInBracket = Math.min(remainingGross, bracket.limit - prevLimit);
        if (taxableInBracket <= 0) break;
        annualTax += taxableInBracket * bracket.rate;
        remainingGross -= taxableInBracket;
        prevLimit = bracket.limit;
    }

    const federalTax = annualTax / payPeriodsPerYear;
    const netPay = grossPay - cpp - ei - federalTax;

    return {
        grossPay: Number(grossPay.toFixed(2)),
        cpp: Number(cpp.toFixed(2)),
        ei: Number(ei.toFixed(2)),
        wcb: Number(wcb.toFixed(2)),
        federalTax: Number(federalTax.toFixed(2)),
        netPay: Number(netPay.toFixed(2))
    };
};

// @desc    Get Payroll Preview
// @route   GET /api/payroll/preview
const getPayrollPreview = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const companyId = req.user.companyId;

        // 1. Find all approved time logs in period
        const logs = await TimeLog.find({
            companyId,
            status: 'approved',
            clockIn: { $gte: new Date(startDate) },
            clockOut: { $lte: new Date(endDate), $ne: null }
        }).populate('userId');

        // 2. Group by User
        const userPayroll = {};

        logs.forEach(log => {
            const userId = log.userId._id;
            if (!userPayroll[userId]) {
                userPayroll[userId] = {
                    user: log.userId,
                    totalHours: 0,
                    rate: log.userId.hourlyRate || 30
                };
            }
            const hours = (new Date(log.clockOut) - new Date(log.clockIn)) / 3600000;
            userPayroll[userId].totalHours += hours;
        });

        // 3. Calculate Deductions for each user
        const results = Object.values(userPayroll).map(item => {
            const gross = item.totalHours * item.rate;
            const deductions = calculateDeductions(gross);
            return {
                userId: item.user._id,
                name: item.user.fullName,
                role: item.user.role,
                totalHours: Number(item.totalHours.toFixed(2)),
                rate: item.rate,
                ...deductions
            };
        });

        res.json(results);
    } catch (error) {
        next(error);
    }
};

// @desc    Run Payroll (Save Records)
// @route   POST /api/payroll/run
const runPayroll = async (req, res, next) => {
    try {
        const { records, startDate, endDate } = req.body;
        const companyId = req.user.companyId;

        const payrollRecords = records.map(rec => ({
            companyId,
            employeeId: rec.userId,
            payPeriodStart: new Date(startDate),
            payPeriodEnd: new Date(endDate),
            totalHours: rec.totalHours,
            hourlyRate: rec.rate,
            grossPay: rec.grossPay,
            cpp: rec.cpp,
            ei: rec.ei,
            federalTax: rec.federalTax,
            wcb: rec.wcb,
            netPay: rec.netPay,
            status: 'paid',
            paymentDate: new Date(),
            referenceId: `PAY-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
        }));

        const saved = await Payroll.insertMany(payrollRecords);
        res.status(201).json(saved);
    } catch (error) {
        next(error);
    }
};

// @desc    Get Payroll History
// @route   GET /api/payroll/history
const getPayrollHistory = async (req, res, next) => {
    try {
        const history = await Payroll.find({ companyId: req.user.companyId })
            .populate('employeeId', 'fullName role')
            .sort({ createdAt: -1 });
        res.json(history);
    } catch (error) {
        next(error);
    }
};

// @desc    Get contributing TimeLogs for a single employee in a period (for detail modal)
// @route   GET /api/payroll/details?userId=&startDate=&endDate=
const getPayrollDetails = async (req, res, next) => {
    try {
        const { userId, startDate, endDate } = req.query;
        const companyId = req.user.companyId;

        const logs = await TimeLog.find({
            companyId,
            userId,
            status: 'approved',
            clockIn: { $gte: new Date(startDate) },
            clockOut: { $lte: new Date(endDate), $ne: null }
        })
            .populate('userId', 'fullName role hourlyRate')
            .populate('jobId', 'title')
            .sort({ clockIn: 1 });

        const enriched = logs.map(log => {
            const hours = (new Date(log.clockOut) - new Date(log.clockIn)) / 3600000;
            return {
                _id: log._id,
                date: log.clockIn,
                clockIn: log.clockIn,
                clockOut: log.clockOut,
                hours: Number(hours.toFixed(2)),
                job: log.jobId?.title || 'General',
                rate: log.userId?.hourlyRate || 30,
                amount: Number((hours * (log.userId?.hourlyRate || 30)).toFixed(2))
            };
        });

        res.json(enriched);
    } catch (error) {
        next(error);
    }
};

// @desc    Get a single saved payroll slip
// @route   GET /api/payroll/slip/:id
const getPayrollSlip = async (req, res, next) => {
    try {
        const record = await Payroll.findById(req.params.id)
            .populate('employeeId', 'fullName role email hourlyRate');
        if (!record) return res.status(404).json({ message: 'Payroll record not found' });
        res.json(record);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getPayrollPreview,
    runPayroll,
    getPayrollHistory,
    getPayrollDetails,
    getPayrollSlip
};


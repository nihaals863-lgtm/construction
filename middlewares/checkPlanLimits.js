const Company = require('../models/Company');
const Plan = require('../models/Plan');
const Project = require('../models/Project');
const User = require('../models/User');
const mongoose = require('mongoose');

const getPlan = async (company) => {
    if (!company.subscriptionPlanId) return null;
    
    // If it's already populated
    if (company.subscriptionPlanId.name) return company.subscriptionPlanId;

    // Try to find by ID or Name
    const planQuery = mongoose.Types.ObjectId.isValid(company.subscriptionPlanId)
        ? { _id: company.subscriptionPlanId }
        : { name: new RegExp('^' + company.subscriptionPlanId + '$', 'i') };
    
    return await Plan.findOne(planQuery);
};

const checkProjectLimit = async (req, res, next) => {
    try {
        const companyId = req.user.companyId;
        if (!companyId) {
            return res.status(400).json({ message: 'Company ID not found in user session' });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }

        const plan = await getPlan(company);
        const projectCount = await Project.countDocuments({ companyId });

        const maxProjects = plan ? plan.maxProjects : 1; // Default limit for no plan

        if (projectCount >= maxProjects && req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ 
                message: `Project limit reached. Your ${plan ? plan.name : 'current'} plan allows up to ${maxProjects} projects. Please upgrade your plan to create more projects.`,
                limitReached: true,
                limitType: 'projects',
                currentCount: projectCount,
                limit: maxProjects
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

const checkUserLimit = async (req, res, next) => {
    try {
        const companyId = req.user.companyId;
        if (!companyId) {
            return res.status(400).json({ message: 'Company ID not found in user session' });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }

        const plan = await getPlan(company);
        const userCount = await User.countDocuments({ 
            companyId,
            role: { $ne: 'CLIENT' } // Usually clients don't count towards seats
        });

        const maxUsers = plan ? plan.maxUsers : 5; // Default limit for no plan

        if (userCount >= maxUsers && req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ 
                message: `User limit reached. Your ${plan ? plan.name : 'current'} plan allows up to ${maxUsers} team members. Please upgrade your plan to add more members.`,
                limitReached: true,
                limitType: 'users',
                currentCount: userCount,
                limit: maxUsers
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = {
    checkProjectLimit,
    checkUserLimit
};

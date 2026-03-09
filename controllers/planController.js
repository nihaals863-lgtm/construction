const Plan = require('../models/Plan');

// @desc    Get all active plans
// @route   GET /api/plans
// @access  Public
const getPlans = async (req, res, next) => {
    try {
        const plans = await Plan.find({}).sort({ price: 1 });
        res.json(plans);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new plan
// @route   POST /api/plans
// @access  Private (Super Admin)
const createPlan = async (req, res, next) => {
    try {
        const plan = await Plan.create(req.body);
        res.status(201).json(plan);
    } catch (error) {
        next(error);
    }
};

// @desc    Update a plan
// @route   PATCH /api/plans/:id
// @access  Private (Super Admin)
const updatePlan = async (req, res, next) => {
    try {
        const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });
        if (!plan) {
            res.status(404);
            throw new Error('Plan not found');
        }
        res.json(plan);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete a plan
// @route   DELETE /api/plans/:id
// @access  Private (Super Admin)
const deletePlan = async (req, res, next) => {
    try {
        const plan = await Plan.findByIdAndDelete(req.params.id);
        if (!plan) {
            res.status(404);
            throw new Error('Plan not found');
        }
        res.json({ message: 'Plan deleted' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getPlans,
    createPlan,
    updatePlan,
    deletePlan
};

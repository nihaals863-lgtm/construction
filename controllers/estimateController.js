const Estimate = require('../models/Estimate');

// @desc    Get all estimates
// @route   GET /api/estimates
// @access  Private
const getEstimates = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };
        if (req.query.projectId) query.projectId = req.query.projectId;

        const estimates = await Estimate.find(query)
            .populate('projectId', 'name')
            .populate('clientId', 'fullName')
            .populate('createdBy', 'fullName');

        res.json(estimates);
    } catch (error) {
        next(error);
    }
};

// @desc    Create new estimate
// @route   POST /api/estimates
// @access  Private (PM, Owners)
const createEstimate = async (req, res, next) => {
    try {
        const estimateData = {
            ...req.body,
            companyId: req.user.companyId,
            createdBy: req.user._id
        };

        // Generate estimate number if not provided
        if (!estimateData.estimateNumber) {
            estimateData.estimateNumber = `EST-${Date.now()}`;
        }

        const estimate = await Estimate.create(estimateData);
        res.status(201).json(estimate);
    } catch (error) {
        next(error);
    }
};

// @desc    Update estimate status
// @route   PATCH /api/estimates/:id
// @access  Private
const updateEstimate = async (req, res, next) => {
    try {
        const estimate = await Estimate.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!estimate) {
            res.status(404);
            throw new Error('Estimate not found');
        }

        const updatedEstimate = await Estimate.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.json(updatedEstimate);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete estimate
// @route   DELETE /api/estimates/:id
// @access  Private (PM, Owners)
const deleteEstimate = async (req, res, next) => {
    try {
        const estimate = await Estimate.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!estimate) {
            res.status(404);
            throw new Error('Estimate not found');
        }

        await Estimate.findByIdAndDelete(req.params.id);
        res.json({ message: 'Estimate deleted successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getEstimates,
    createEstimate,
    updateEstimate,
    deleteEstimate
};

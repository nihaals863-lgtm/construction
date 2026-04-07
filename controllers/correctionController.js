const CorrectionRequest = require('../models/CorrectionRequest');
const TimeLog = require('../models/TimeLog');
const Notification = require('../models/Notification');
const User = require('../models/User');

// @desc    Create a correction request
// @route   POST /api/corrections
// @access  Private
const createCorrectionRequest = async (req, res, next) => {
    try {
        const { timeLogId, requestedChanges } = req.body;

        const timeLog = await TimeLog.findById(timeLogId);
        if (!timeLog) {
            res.status(404);
            throw new Error('TimeLog not found');
        }

        const correction = await CorrectionRequest.create({
            companyId: req.user.companyId,
            userId: req.user._id,
            timeLogId,
            requestedChanges
        });

        // Notify Admins/PMs
        const pms = await User.find({
            companyId: req.user.companyId,
            role: { $in: ['PM', 'COMPANY_OWNER'] }
        });

        await Promise.all(pms.map(pm => {
            return Notification.create({
                companyId: req.user.companyId,
                userId: pm._id,
                title: 'New Correction Request',
                message: `${req.user.fullName} has requested a correction for their timesheet on ${new Date(timeLog.clockIn).toLocaleDateString()}.`,
                type: 'financial',
                link: '/company-admin/timesheets'
            });
        }));

        res.status(201).json(correction);
    } catch (error) {
        next(error);
    }
};

// @desc    Get all correction requests for a company
// @route   GET /api/corrections
// @access  Private
const getCorrectionRequests = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        // If not PM/Owner, only show own requests
        if (!['PM', 'COMPANY_OWNER'].includes(req.user.role)) {
            query.userId = req.user._id;
        }

        const corrections = await CorrectionRequest.find(query)
            .populate('userId', 'fullName role')
            .populate('timeLogId')
            .sort({ createdAt: -1 });

        res.json(corrections);
    } catch (error) {
        next(error);
    }
};

// @desc    Update correction request status (Approve/Reject)
// @route   PATCH /api/corrections/:id
// @access  Private (PM, Owners)
const updateCorrectionRequest = async (req, res, next) => {
    try {
        const { status, reviewNotes } = req.body;
        const correction = await CorrectionRequest.findById(req.params.id);

        if (!correction) {
            res.status(404);
            throw new Error('Correction request not found');
        }

        correction.status = status;
        correction.reviewNotes = reviewNotes;
        correction.reviewedBy = req.user._id;
        await correction.save();

        // If approved, update the original TimeLog
        if (status === 'approved') {
            const timeLog = await TimeLog.findById(correction.timeLogId);
            if (timeLog) {
                if (correction.requestedChanges.clockIn) timeLog.clockIn = correction.requestedChanges.clockIn;
                if (correction.requestedChanges.clockOut) timeLog.clockOut = correction.requestedChanges.clockOut;
                await timeLog.save();
            }
        }

        // Notify User
        await Notification.create({
            companyId: req.user.companyId,
            userId: correction.userId,
            title: `Correction Request ${status.charAt(0).toUpperCase() + status.slice(1)}`,
            message: `Your correction request for ${new Date(correction.createdAt).toLocaleDateString()} has been ${status}.`,
            type: 'system',
            link: '/company-admin/timesheets'
        });

        res.json(correction);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete a correction request
// @route   DELETE /api/corrections/:id
// @access  Private (PM, Owners, or the user who created it)
const deleteCorrectionRequest = async (req, res, next) => {
    try {
        const correction = await CorrectionRequest.findById(req.params.id);

        if (!correction) {
            res.status(404);
            throw new Error('Correction request not found');
        }

        // Only allow PM, Owner, or the creator to delete
        if (!['PM', 'COMPANY_OWNER'].includes(req.user.role) && correction.userId.toString() !== req.user._id.toString()) {
            res.status(403);
            throw new Error('Not authorized to delete this request');
        }

        await correction.deleteOne();

        res.json({ message: 'Correction request removed' });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete multiple correction requests (e.g. all pending)
// @route   POST /api/corrections/bulk-delete
// @access  Private (PM, Owners)
const deleteMultipleCorrections = async (req, res, next) => {
    try {
        if (!['PM', 'COMPANY_OWNER'].includes(req.user.role)) {
            res.status(403);
            throw new Error('Not authorized to perform bulk deletion');
        }

        const { ids } = req.body;
        if (ids && ids.length > 0) {
            await CorrectionRequest.deleteMany({ _id: { $in: ids }, companyId: req.user.companyId });
        }

        res.json({ message: 'Corrections removed successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createCorrectionRequest,
    getCorrectionRequests,
    updateCorrectionRequest,
    deleteCorrectionRequest,
    deleteMultipleCorrections
};

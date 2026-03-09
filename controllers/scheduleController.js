const Schedule = require('../models/Schedule');

// @desc    Get all schedules
// @route   GET /api/schedules
// @access  Private
const getSchedules = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        if (req.query.projectId) {
            query.projectId = req.query.projectId;
        }

        const schedules = await Schedule.find(query)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName email')
            .populate('createdBy', 'fullName');

        res.json(schedules);
    } catch (error) {
        next(error);
    }
};

// @desc    Create new schedule
// @route   POST /api/schedules
// @access  Private (PM, COMPANY_OWNER)
const createSchedule = async (req, res, next) => {
    try {
        const schedule = await Schedule.create({
            ...req.body,
            companyId: req.user.companyId,
            createdBy: req.user._id
        });
        res.status(201).json(schedule);
    } catch (error) {
        next(error);
    }
};

// @desc    Update schedule
// @route   PATCH /api/schedules/:id
// @access  Private
const updateSchedule = async (req, res, next) => {
    try {
        const schedule = await Schedule.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!schedule) {
            res.status(404);
            throw new Error('Schedule not found');
        }

        const updatedSchedule = await Schedule.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.json(updatedSchedule);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete schedule
// @route   DELETE /api/schedules/:id
// @access  Private
const deleteSchedule = async (req, res, next) => {
    try {
        const schedule = await Schedule.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!schedule) {
            res.status(404);
            throw new Error('Schedule not found');
        }

        await Schedule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Schedule removed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule
};

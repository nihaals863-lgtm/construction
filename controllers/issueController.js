const Issue = require('../models/Issue');

// @desc    Get all issues
// @route   GET /api/issues
// @access  Private
const getIssues = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };
        if (req.query.projectId) query.projectId = req.query.projectId;
        if (req.query.jobId) query.jobId = req.query.jobId;
        if (req.query.status) query.status = req.query.status;

        const issues = await Issue.find(query)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName')
            .populate('reportedBy', 'fullName')
            .populate('photoIds')
            .sort({ createdAt: -1 });

        res.json(issues);
    } catch (error) {
        next(error);
    }
};

// @desc    Create new issue
// @route   POST /api/issues
// @access  Private
const createIssue = async (req, res, next) => {
    try {
        const images = req.files ? req.files.map(file => file.path) : [];

        const issue = await Issue.create({
            ...req.body,
            images,
            companyId: req.user.companyId,
            reportedBy: req.user._id
        });
        res.status(201).json(issue);
    } catch (error) {
        next(error);
    }
};

// @desc    Update issue
// @route   PATCH /api/issues/:id
// @access  Private
const updateIssue = async (req, res, next) => {
    try {
        const issue = await Issue.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!issue) {
            res.status(404);
            throw new Error('Issue not found');
        }

        const updates = { ...req.body };
        if (req.files && req.files.length > 0) {
            const newImages = req.files.map(file => file.path);
            // If the front-end sends currentImages as a JSON string or array, we use it
            let currentImages = [];
            if (req.body.currentImages) {
                try {
                    currentImages = typeof req.body.currentImages === 'string'
                        ? JSON.parse(req.body.currentImages)
                        : req.body.currentImages;
                } catch (e) {
                    currentImages = issue.images || [];
                }
            } else {
                currentImages = issue.images || [];
            }
            updates.images = [...currentImages, ...newImages];
        }

        const updatedIssue = await Issue.findByIdAndUpdate(req.params.id, updates, {
            new: true,
            runValidators: true
        });

        res.json(updatedIssue);
    } catch (error) {
        next(error);
    }
};

const deleteIssue = async (req, res, next) => {
    try {
        const issue = await Issue.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
        if (!issue) {
            res.status(404);
            throw new Error('Issue not found');
        }
        res.json({ message: 'Issue removed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getIssues,
    createIssue,
    updateIssue,
    deleteIssue
};

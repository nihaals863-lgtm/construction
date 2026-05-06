const Issue = require('../models/Issue');

// @desc    Get all issues
// @route   GET /api/issues
// @access  Private
const getIssues = async (req, res, next) => {
    try {
        const { role, _id: userId, companyId } = req.user;
        const query = { companyId };

        // Role-based filtering
        if (['FOREMAN', 'WORKER', 'SUBCONTRACTOR'].includes(role)) {
            query.$or = [
                { assignedTo: userId },
                { reportedBy: userId }
            ];
        } else if (role === 'PM') {
            const Project = require('../models/Project');
            const pmProjects = await Project.find({
                companyId,
                $or: [
                    { pmIds: userId },
                    { pmId: userId },
                    { createdBy: userId }
                ]
            }).select('_id');
            const projectIds = pmProjects.map(p => p._id);
            query.projectId = { $in: projectIds };
        }

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
        
        // Handle images (existing + new)
        let existingImages = [];
        if (req.body.images) {
            try {
                existingImages = typeof req.body.images === 'string' 
                    ? JSON.parse(req.body.images) 
                    : req.body.images;
            } catch (e) {
                existingImages = [];
            }
            delete updates.images; // Remove from updates to avoid conflict
        } else {
            // If images field is not present in req.body, it might be a simple status update
            // so we don't want to clear the images unless explicitly requested.
            // But for multipart form, we usually send it.
        }

        const newImages = req.files ? req.files.map(file => file.path) : [];
        
        // Only update images if we received the images field OR new files
        if (req.body.images || newImages.length > 0) {
            updates.images = [...existingImages, ...newImages];
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

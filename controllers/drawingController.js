const Drawing = require('../models/Drawing');
const DrawingAnnotation = require('../models/DrawingAnnotation');
const Job = require('../models/Job');
const Project = require('../models/Project');
const mongoose = require('mongoose');

// @desc    Get all drawings
// @route   GET /api/drawings
// @access  Private
const getDrawings = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        if (['PM', 'FOREMAN', 'WORKER', 'SUBCONTRACTOR'].includes(req.user.role)) {
            const jobFilter = { companyId: req.user.companyId };

            if (req.user.role === 'PM') {
                jobFilter.$or = [
                    { foremanId: req.user._id },
                    { createdBy: req.user._id }
                ];
            } else if (['FOREMAN', 'SUBCONTRACTOR'].includes(req.user.role)) {
                jobFilter.foremanId = req.user._id;
            } else {
                jobFilter.assignedWorkers = req.user._id;
            }

            const assignedJobs = await Job.find(jobFilter).select('projectId').lean();
            const jobProjectIds = assignedJobs
                .filter(j => j.projectId)
                .map(j => j.projectId.toString());

            let finalAllowedProjectIds = jobProjectIds;

            if (req.user.role === 'PM') {
                const directProjects = await Project.find({
                    companyId: req.user.companyId,
                    $or: [
                        { pmId: req.user._id },
                        { createdBy: req.user._id }
                    ]
                }).select('_id').lean();
                const directProjectIds = directProjects.map(p => p._id.toString());
                finalAllowedProjectIds = [...new Set([...jobProjectIds, ...directProjectIds])];
            }

            query.projectId = { $in: finalAllowedProjectIds };

        } else if (req.user.role === 'CLIENT') {
            const clientProjects = await Project.find({ clientId: req.user._id }).select('_id').lean();
            const projectIds = clientProjects.map(p => p._id.toString());
            query.projectId = { $in: projectIds };
        }

        // Apply additional filter if projectId is provided in query params
        if (req.query.projectId) {
            // Authorization check for restricted roles
            if (['CLIENT', 'PM', 'FOREMAN', 'WORKER', 'SUBCONTRACTOR'].includes(req.user.role)) {
                const allowedIds = query.projectId?.$in || [];
                if (!allowedIds.includes(req.query.projectId.toString())) {
                    return res.status(403).json({ message: 'Not authorized to access this project drawings' });
                }
            }
            query.projectId = req.query.projectId;
        }

        // Optimization: Use projection to only get the latest version and essential fields
        const drawings = await Drawing.find(query, {
            versions: { $slice: -1 } // Only retrieve the most recent version
        })
        .select('title drawingNumber category currentVersion status projectId createdAt')
        .populate('projectId', 'name')
        .sort({ createdAt: -1 })
        .lean();

        res.json(drawings);
    } catch (error) {
        next(error);
    }
};

// @desc    Create new drawing
// @route   POST /api/drawings
// @access  Private
const createDrawing = async (req, res, next) => {
    try {
        const { projectId, title, drawingNumber, category } = req.body;
        let fileUrl = req.body.fileUrl;

        if (req.file) {
            fileUrl = req.file.path.replace(/\\/g, '/');
        }

        if (!fileUrl) {
            res.status(400);
            throw new Error('Please upload a drawing file');
        }

        const drawing = await Drawing.create({
            companyId: req.user.companyId,
            projectId,
            title,
            drawingNumber,
            category,
            versions: [{
                versionNumber: 1,
                fileUrl,
                uploadedBy: req.user._id,
                description: 'Initial Version'
            }]
        });

        res.status(201).json(drawing);
    } catch (error) {
        next(error);
    }
};

// @desc    Add new version to drawing
// @route   POST /api/drawings/:id/versions
// @access  Private
const addDrawingVersion = async (req, res, next) => {
    try {
        const { description } = req.body;
        let fileUrl = req.body.fileUrl;

        if (req.file) {
            fileUrl = req.file.path.replace(/\\/g, '/');
        }

        if (!fileUrl) {
            res.status(400);
            throw new Error('Please upload a new drawing file');
        }

        const drawing = await Drawing.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!drawing) {
            res.status(404);
            throw new Error('Drawing not found');
        }

        const newVersionNumber = drawing.versions.length + 1;
        drawing.versions.push({
            versionNumber: newVersionNumber,
            fileUrl,
            uploadedBy: req.user._id,
            description
        });
        drawing.currentVersion = newVersionNumber;

        await drawing.save();
        res.status(201).json(drawing);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete drawing
// @route   DELETE /api/drawings/:id
// @access  Private
const deleteDrawing = async (req, res, next) => {
    try {
        const drawing = await Drawing.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!drawing) {
            res.status(404);
            throw new Error('Drawing not found');
        }

        await Drawing.findByIdAndDelete(req.params.id);
        res.json({ message: 'Drawing removed' });
    } catch (error) {
        next(error);
    }
};

// @desc    Get annotations for a drawing version
// @route   GET /api/drawings/:id/annotations?versionId=...
// @access  Private
const getDrawingAnnotations = async (req, res, next) => {
    try {
        const { versionId } = req.query;
        const query = { drawingId: req.params.id };

        if (versionId) {
            query.versionId = versionId;
        }

        if (req.user.role === 'CLIENT') {
            query.isVisibleToClient = true;
        }

        const annotations = await DrawingAnnotation.find(query)
            .populate('userId', 'fullName role')
            .sort({ createdAt: 1 })
            .lean();

        res.json(annotations);
    } catch (error) {
        next(error);
    }
};

// @desc    Create an annotation
// @route   POST /api/drawings/:id/annotations
// @access  Private
const createDrawingAnnotation = async (req, res, next) => {
    try {
        const { versionId, pageNumber, type, coordinates, content, isVisibleToClient } = req.body;

        const annotation = await DrawingAnnotation.create({
            drawingId: req.params.id,
            versionId,
            userId: req.user._id,
            pageNumber,
            type,
            coordinates,
            content,
            isVisibleToClient: isVisibleToClient ?? true
        });

        const populated = await DrawingAnnotation.findById(annotation._id).populate('userId', 'fullName role');
        res.status(201).json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Update an annotation
// @route   PATCH /api/drawings/annotations/:id
// @access  Private
const updateDrawingAnnotation = async (req, res, next) => {
    try {
        const annotation = await DrawingAnnotation.findById(req.params.id);

        if (!annotation) {
            return res.status(404).json({ message: 'Annotation not found' });
        }

        // Clients can't resolve/update others' annotations
        if (req.user.role === 'CLIENT' && annotation.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const updated = await DrawingAnnotation.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        ).populate('userId', 'fullName role');

        res.json(updated);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete an annotation
// @route   DELETE /api/drawings/annotations/:id
// @access  Private
const deleteDrawingAnnotation = async (req, res, next) => {
    try {
        const annotation = await DrawingAnnotation.findById(req.params.id);

        if (!annotation) {
            return res.status(404).json({ message: 'Annotation not found' });
        }

        // Only creator or Admin/PM can delete
        if (!['SUPER_ADMIN', 'COMPANY_OWNER', 'PM'].includes(req.user.role) &&
            annotation.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        await DrawingAnnotation.findByIdAndDelete(req.params.id);
        res.json({ message: 'Annotation removed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDrawings,
    createDrawing,
    addDrawingVersion,
    deleteDrawing,
    getDrawingAnnotations,
    createDrawingAnnotation,
    updateDrawingAnnotation,
    deleteDrawingAnnotation
};

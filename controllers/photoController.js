const Photo = require('../models/Photo');
const Project = require('../models/Project');
const Job = require('../models/Job');
const mongoose = require('mongoose');

// @desc    Get all photos
// @route   GET /api/photos
// @access  Private
const getPhotos = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        // Role-based Visibility Logic
        if (['PM', 'FOREMAN', 'WORKER', 'CLIENT'].includes(req.user.role)) {
            if (req.user.role === 'CLIENT') {
                const clientProjects = await Project.find({
                    companyId: req.user.companyId,
                    clientId: req.user._id
                }).select('_id').lean();
                const clientProjectIds = clientProjects.map(p => p._id.toString());
                
                if (req.query.projectId) {
                    if (!clientProjectIds.includes(req.query.projectId)) {
                        return res.status(403).json({ message: 'Not authorized for this project' });
                    }
                    query.projectId = req.query.projectId;
                } else {
                    query.projectId = { $in: clientProjectIds };
                }
            } else {
                const jobFilter = { companyId: req.user.companyId };

                if (req.user.role === 'PM') {
                    jobFilter.$or = [
                        { foremanId: req.user._id },
                        { createdBy: req.user._id }
                    ];
                } else if (req.user.role === 'FOREMAN') {
                    jobFilter.foremanId = req.user._id;
                } else {
                    jobFilter.assignedWorkers = req.user._id;
                }

                const assignedJobs = await Job.find(jobFilter).select('projectId').lean();
                const jobProjectIds = assignedJobs
                    .filter(j => j.projectId)
                    .map(j => j.projectId.toString());

                let allowedProjectIds = [];
                if (req.user.role === 'PM') {
                    const directProjects = await Project.find({
                        companyId: req.user.companyId,
                        $or: [
                            { pmIds: req.user._id },
                            { pmId: req.user._id },
                            { createdBy: req.user._id }
                        ]
                    }).select('_id').lean();
                    const directProjectIds = directProjects.map(p => p._id.toString());
                    allowedProjectIds = [...new Set([...jobProjectIds, ...directProjectIds])];
                } else {
                    allowedProjectIds = jobProjectIds;
                }

                if (req.query.projectId) {
                    if (!allowedProjectIds.includes(req.query.projectId)) {
                        // If they don't have project assignment, they can still view their own uploads on this project
                        query.projectId = req.query.projectId;
                        query.uploadedBy = req.user._id;
                    } else {
                        query.projectId = req.query.projectId;
                        query.$or = [
                            { uploadedBy: req.user._id },
                            { projectId: req.query.projectId }
                        ];
                    }
                } else {
                    query.$or = [
                        { uploadedBy: req.user._id },
                        { projectId: { $in: allowedProjectIds } }
                    ];
                }
            }
        } else {
            // Admin/Owner can view any project
            if (req.query.projectId) {
                query.projectId = req.query.projectId;
            }
        }

        if (req.query.taskId) query.taskId = req.query.taskId;

        const photos = await Photo.find(query)
            .select('-companyId')
            .populate('projectId', 'name')
            .populate('uploadedBy', 'fullName role')
            .sort({ createdAt: -1 })
            .lean();

        res.json(photos);
    } catch (error) {
        next(error);
    }
};

// @desc    Upload photo
// @route   POST /api/photos/upload
// @access  Private
const uploadPhoto = async (req, res, next) => {
    try {
        console.log('Upload Request Body:', req.body);
        console.log('Upload Request Files:', req.files);

        const { projectId, taskId, description } = req.body;
        const photos = [];

        // Handle Multiple Files
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = file.path;
                const photo = await Photo.create({
                    companyId: req.user.companyId,
                    projectId: projectId || undefined,
                    taskId: taskId || undefined,
                    uploadedBy: req.user._id,
                    imageUrl,
                    description: description || file.originalname // Fallback to filename if no description
                });
                photos.push(photo);
            }
        } 
        // Handle Single Image URL (External)
        else if (req.body.imageUrl) {
            const photo = await Photo.create({
                companyId: req.user.companyId,
                projectId: projectId || undefined,
                taskId: taskId || undefined,
                uploadedBy: req.user._id,
                imageUrl: req.body.imageUrl,
                description
            });
            photos.push(photo);
        }

        if (photos.length === 0) {
            res.status(400);
            throw new Error('Please upload at least one image file or provide an imageUrl');
        }

        // Return the first one or all? Let's return all for frontend consistency
        const photoIds = photos.map(p => p._id);
        const populated = await Photo.find({ _id: { $in: photoIds } })
            .populate('projectId', 'name')
            .populate('uploadedBy', 'fullName role')
            .sort({ createdAt: -1 })
            .lean();

        res.status(201).json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete photo
// @route   DELETE /api/photos/:id
// @access  Private
const deletePhoto = async (req, res, next) => {
    try {
        const photo = await Photo.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!photo) {
            res.status(404);
            throw new Error('Photo not found');
        }

        // Ideally, delete the physical file here too
        // if (photo.imageUrl.includes('uploads/')) { ... }

        await Photo.findByIdAndDelete(req.params.id);
        res.json({ message: 'Photo removed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getPhotos,
    uploadPhoto,
    deletePhoto
};

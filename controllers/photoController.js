const Photo = require('../models/Photo');
const Project = require('../models/Project');

// @desc    Get all photos
// @route   GET /api/photos
// @access  Private
const getPhotos = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        // PM / Foreman / Worker Visibility Logic
        if (['PM', 'FOREMAN', 'WORKER'].includes(req.user.role)) {
            const Job = require('../models/Job');
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

            const assignedJobs = await Job.find(jobFilter).select('projectId');
            const jobProjectIds = assignedJobs
                .filter(j => j.projectId)
                .map(j => j.projectId.toString());

            if (req.user.role === 'PM') {
                const Project = require('../models/Project');
                const directProjects = await Project.find({
                    companyId: req.user.companyId,
                    $or: [
                        { pmId: req.user._id },
                        { createdBy: req.user._id }
                    ]
                }).select('_id');
                const directProjectIds = directProjects.map(p => p._id.toString());
                const allProjectIds = [...new Set([...jobProjectIds, ...directProjectIds])];
                query.projectId = { $in: allProjectIds };
            } else {
                query.projectId = { $in: jobProjectIds };
            }
        }

        if (req.query.projectId) {
            // Further filter by specific projectId if provided
            // For security, if they provided one, ensure it's in their allowed list if they are a restricted role
            if (query.projectId && query.projectId.$in) {
                if (!query.projectId.$in.includes(req.query.projectId)) {
                    return res.status(403).json({ message: 'Not authorized for this project' });
                }
            }
            query.projectId = req.query.projectId;
        }
        if (req.query.taskId) query.taskId = req.query.taskId;

        const photos = await Photo.find(query)
            .populate('projectId', 'name')
            .populate('uploadedBy', 'fullName')
            .sort({ createdAt: -1 });

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
        console.log('Upload Request Headers:', req.headers);
        console.log('Upload Request Body:', req.body);
        console.log('Upload Request File:', req.file);

        const { projectId, taskId, description } = req.body;

        // Construct imageUrl from the file saved by multer
        let imageUrl = req.body.imageUrl; // fallback for legacy or manual URLs

        if (req.file) {
            // For Cloudinary, req.file.path is already the full URL
            imageUrl = req.file.path;
        }

        if (!imageUrl) {
            res.status(400);
            throw new Error('Please upload an image file or provide an imageUrl');
        }

        const photo = await Photo.create({
            companyId: req.user.companyId,
            projectId: projectId || undefined,
            taskId: taskId || undefined,
            uploadedBy: req.user._id,
            imageUrl,
            description
        });

        res.status(201).json(photo);
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

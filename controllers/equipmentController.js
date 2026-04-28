const Equipment = require('../models/Equipment');
const Job = require('../models/Job');
const cloudinary = require('cloudinary').v2;

// @desc    Get all equipment for the company
// @route   GET /api/equipment
// @access  Private
const getEquipment = async (req, res, next) => {
    try {
        let query = { companyId: req.user.companyId };

        // Role-Based Filtering
        if (req.user.role === 'SUBCONTRACTOR') {
            // Only show equipment that is currently assigned to a job
            // In a real scenario, we'd further filter by jobs the subcontractor is on
            query.assignedJob = { $ne: null };
        }

        const equipment = await Equipment.find(query)
            .populate({
                path: 'assignedJob',
                select: 'name status projectId',
                populate: {
                    path: 'projectId',
                    select: 'name'
                }
            }).lean();
        res.json(equipment);
    } catch (error) {
        next(error);
    }
};

// @desc    Create new equipment
// @route   POST /api/equipment
// @access  Private
const createEquipment = async (req, res, next) => {
    try {
        const equipment = await Equipment.create({
            ...req.body,
            companyId: req.user.companyId
        });
        res.status(201).json(equipment);
    } catch (error) {
        next(error);
    }
};

// @desc    Update equipment
// @route   PATCH /api/equipment/:id
// @access  Private
const updateEquipment = async (req, res, next) => {
    try {
        const equipment = await Equipment.findById(req.params.id);
        if (!equipment || equipment.companyId.toString() !== req.user.companyId.toString()) {
            res.status(404);
            throw new Error('Equipment not found');
        }

        const updated = await Equipment.findByIdAndUpdate(req.params.id, req.body, { new: true })
            .populate({
                path: 'assignedJob',
                select: 'name status projectId',
                populate: {
                    path: 'projectId',
                    select: 'name'
                }
            });
        res.json(updated);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete equipment
// @route   DELETE /api/equipment/:id
// @access  Private
const deleteEquipment = async (req, res, next) => {
    try {
        const equipment = await Equipment.findById(req.params.id);
        if (!equipment || equipment.companyId.toString() !== req.user.companyId.toString()) {
            res.status(404);
            throw new Error('Equipment not found');
        }
        await Equipment.findByIdAndDelete(req.params.id);
        res.json({ message: 'Equipment removed' });
    } catch (error) {
        next(error);
    }
};

// @desc    Assign equipment to job
// @route   POST /api/equipment/:id/assign
// @access  Private
const assignEquipment = async (req, res, next) => {
    try {
        const { jobId } = req.body;
        const equipment = await Equipment.findById(req.params.id);

        if (!equipment || equipment.companyId.toString() !== req.user.companyId.toString()) {
            res.status(404);
            throw new Error('Equipment not found');
        }

        // Lookup job + project name for history
        const job = await Job.findById(jobId).populate('projectId', 'name');
        const jobName = job?.name || 'Unknown Job';
        const projectName = job?.projectId?.name || 'Unknown Project';

        const assignedNow = new Date();
        equipment.assignedJob = jobId;
        equipment.assignedDate = assignedNow;
        equipment.status = 'operational';

        // Push to history — initialize array if missing (old documents pre-schema change)
        if (!equipment.assignmentHistory) equipment.assignmentHistory = [];
        equipment.assignmentHistory.push({
            jobId,
            jobName,
            projectName,
            assignedDate: assignedNow,
            returnedDate: null
        });

        await equipment.save();
        const populated = await Equipment.findById(equipment._id).populate({
            path: 'assignedJob',
            select: 'name status projectId',
            populate: {
                path: 'projectId',
                select: 'name'
            }
        });
        res.json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Return equipment from job
// @route   POST /api/equipment/:id/return
// @access  Private
const returnEquipment = async (req, res, next) => {
    try {
        const equipment = await Equipment.findById(req.params.id);

        if (!equipment || equipment.companyId.toString() !== req.user.companyId.toString()) {
            res.status(404);
            throw new Error('Equipment not found');
        }

        // Stamp returnedDate on the latest open history record
        // Guard: initialize if old document doesn't have the field
        if (!equipment.assignmentHistory) equipment.assignmentHistory = [];
        const openRecord = [...equipment.assignmentHistory].reverse().find(h => !h.returnedDate);
        if (openRecord) {
            openRecord.returnedDate = new Date();
        }

        equipment.assignedJob = null;
        equipment.assignedDate = null;
        equipment.status = 'idle';

        await equipment.save();
        res.json(equipment);
    } catch (error) {
        next(error);
    }
};

// @desc    Get assignment history for one equipment
// @route   GET /api/equipment/:id/history
// @access  Private
const getEquipmentHistory = async (req, res, next) => {
    try {
        const equipment = await Equipment.findById(req.params.id);
        if (!equipment || equipment.companyId.toString() !== req.user.companyId.toString()) {
            res.status(404);
            throw new Error('Equipment not found');
        }
        // Return sorted history (newest first) + equipment meta
        const history = [...(equipment.assignmentHistory || [])].reverse();
        res.json({
            _id: equipment._id,
            name: equipment.name,
            category: equipment.category,
            type: equipment.type,
            serialNumber: equipment.serialNumber,
            history
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Upload equipment image
// @route   POST /api/equipment/:id/upload-image
// @access  Private
const uploadEquipmentImage = async (req, res, next) => {
    try {
        const equipment = await Equipment.findById(req.params.id);
        if (!equipment || equipment.companyId.toString() !== req.user.companyId.toString()) {
            res.status(404);
            throw new Error('Equipment not found');
        }

        if (!req.file) {
            res.status(400);
            throw new Error('No image file provided');
        }

        // req.file.path is the Cloudinary URL (set by CloudinaryStorage)
        equipment.imageUrl = req.file.path;
        await equipment.save();

        res.json({ imageUrl: equipment.imageUrl });
    } catch (error) {
        next(error);
    }
};

// @desc    Get ALL equipment assignment history (company-wide)
// @route   GET /api/equipment/all-history
// @access  Private
const getAllEquipmentHistory = async (req, res, next) => {
    try {
        const allEquipment = await Equipment.find({ companyId: req.user.companyId })
            .select('name category type serialNumber assignmentHistory imageUrl')
            .lean();

        // Flatten all history records with equipment metadata
        const allHistory = [];
        for (const eq of allEquipment) {
            for (const h of (eq.assignmentHistory || [])) {
                allHistory.push({
                    equipmentId: eq._id,
                    equipmentName: eq.name,
                    equipmentType: eq.type,
                    equipmentCategory: eq.category,
                    serialNumber: eq.serialNumber,
                    jobName: h.jobName,
                    projectName: h.projectName,
                    assignedDate: h.assignedDate,
                    returnedDate: h.returnedDate,
                    notes: h.notes
                });
            }
        }

        // Sort newest first
        allHistory.sort((a, b) => new Date(b.assignedDate) - new Date(a.assignedDate));

        res.json(allHistory);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getEquipment,
    createEquipment,
    updateEquipment,
    deleteEquipment,
    assignEquipment,
    returnEquipment,
    uploadEquipmentImage,
    getEquipmentHistory,
    getAllEquipmentHistory
};

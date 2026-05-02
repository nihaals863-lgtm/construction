const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const Company = require('../models/Company');
const Plan = require('../models/Plan');
const Job = require('../models/Job');


// @desc    Get projects for the company
// @route   GET /api/projects
// @access  Private
const getProjects = async (req, res, next) => {
    try {
        const { role, _id: userId, companyId } = req.user;
        const query = { companyId };

        if (role === 'SUPER_ADMIN') {
            delete query.companyId;
        }

        if (['FOREMAN', 'WORKER', 'SUBCONTRACTOR'].includes(role)) {
            
            const jobFilter = { 
                companyId,
                $or: [
                    { foremanId: userId },
                    { assignedWorkers: userId }
                ]
            };
            if (role === 'PM') jobFilter.$or.push({ createdBy: userId });

            const [assignedJobs, directProjects] = await Promise.all([
                Job.find(jobFilter).select('projectId').lean(),
                Project.find({
                    companyId,
                    $or: [
                        { pmId: userId },
                        { createdBy: userId }
                    ]
                }).select('_id').lean()
            ]);
            
            const allProjectIds = [
                ...new Set([
                    ...assignedJobs.filter(j => j.projectId).map(j => j.projectId.toString()),
                    ...directProjects.map(p => p._id.toString())
                ])
            ];
            query._id = { $in: allProjectIds };
        }

        if (role === 'CLIENT') {
            query.clientId = userId;
        }

        // Exclude archived projects by default
        if (!req.query.includeArchived) {
            query.status = { $ne: 'archived' };
        }

        // Optimization: Select only necessary fields for the list view. 
        // We exclude 'image' if it's too large, but since we migrated to Cloudinary, 
        // we'll keep it but ensure old Base64 data doesn't bloat the response.
        const projects = await Project.find(query)
            .select('name status pmId clientId createdAt budget currentPhase location siteLatitude siteLongitude progress image startDate endDate')
            .populate('clientId', 'fullName email')
            .populate('pmId', 'fullName email')
            .sort({ createdAt: -1 })
            .lean();

        res.json(projects);
    } catch (error) {
        next(error);
    }
};

// @desc    Get project by ID
// @route   GET /api/projects/:id
// @access  Private
const getProjectById = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id)
            .populate('clientId', 'fullName email avatar')
            .populate('createdBy', 'fullName avatar')
            .populate('pmId', 'fullName email avatar')
            .lean();

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        // Multi-tenant authorization check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== project.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to access this project');
        }

        res.json(project);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new project
// @route   POST /api/projects
// @access  Private (PM, COMPANY_OWNER, SUPER_ADMIN)
const createProject = async (req, res, next) => {
    try {
        const { name, clientId, startDate, endDate, budget, location, geofenceRadius, image, pmId } = req.body;

        // --- ENFORCE PLAN LIMITS ---
        const companyId = req.user.companyId;
        const company = await Company.findById(companyId);
        if (company) {
            const mongoose = require('mongoose');
            // Try matching by ID first, then by name (case-insensitive)
            const planQuery = mongoose.Types.ObjectId.isValid(company.subscriptionPlanId)
                ? { _id: company.subscriptionPlanId }
                : { name: new RegExp('^' + company.subscriptionPlanId + '$', 'i') };

            const plan = await Plan.findOne(planQuery);
            
            // Define strict limits: Plan value > Plan model default > hard fallback
            const maxProjects = plan?.maxProjects || 5; 

            const currentProjectCount = await Project.countDocuments({ companyId });
            if (currentProjectCount >= maxProjects) {
                res.status(403);
                throw new Error(`Project limit reached for your Current Plan (${currentProjectCount}/${maxProjects} projects). Please upgrade your subscription to start more projects or manage existing ones.`);
            }
        }
        // ---------------------------

        // Handle Cloudinary Image
        let finalImage = image;
        if (req.file) {
            finalImage = req.file.path;
        }

        const project = await Project.create({
            companyId: req.user.companyId,
            name,
            clientId,
            startDate,
            endDate,
            budget,
            location,
            geofenceRadius,
            image: finalImage,
            pmId,
            createdBy: req.user._id
        });

        // CREATE CHAT ROOM FOR PROJECT
        try {
            const ChatRoom = require('../models/ChatRoom');
            const { syncProjectParticipants } = require('./chatController');

            await ChatRoom.create({
                companyId: req.user.companyId,
                projectId: project._id,
                roomType: 'PROJECT_GROUP',
                name: project.name,
                isGroup: true
            });

            // Initial sync
            await syncProjectParticipants(project._id);
        } catch (chatError) {
            console.error('Failed to create/sync chat room for project:', chatError);
        }

        const populatedProject = await Project.findById(project._id)
            .populate('clientId', 'fullName email')
            .populate('createdBy', 'fullName')
            .populate('pmId', 'fullName email');

        res.status(201).json(populatedProject);
    } catch (error) {
        next(error);
    }
};

// @desc    Update project
// @route   PATCH /api/projects/:id
// @access  Private (PM, COMPANY_OWNER, SUPER_ADMIN)
const updateProject = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id);

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        // Multi-tenant authorization check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== project.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to update this project');
        }

        const updateData = { ...req.body };
        
        // Sanitize "null" strings from frontend
        Object.keys(updateData).forEach(key => {
            if (updateData[key] === 'null' || updateData[key] === '') {
                updateData[key] = null;
            }
        });

        if (req.file) {
            updateData.image = req.file.path;
        }

        const updatedProject = await Project.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        }).populate('pmId', 'fullName email')
            .populate('createdBy', 'fullName')
            .lean();

        // Sync chat participants if PM or Client changed
        if (req.body.pmId || req.body.clientId) {
            const { syncProjectParticipants } = require('./chatController');
            await syncProjectParticipants(updatedProject._id);
        }

        res.json(updatedProject);
    } catch (error) {
        next(error);
    }
};

// @desc    Archive project (Soft delete)
// @route   DELETE /api/projects/:id
// @access  Private (COMPANY_OWNER, PM, SUPER_ADMIN)
const deleteProject = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id);

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        // Multi-tenant authorization check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== project.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to archive this project');
        }

        project.status = 'archived';
        await project.save();
        
        res.json({ message: 'Project moved to archive' });
    } catch (error) {
        next(error);
    }
};

// @desc    Get archived projects
// @route   GET /api/projects/archived
// @access  Private (COMPANY_OWNER, SUPER_ADMIN)
const getArchivedProjects = async (req, res, next) => {
    try {
        const query = { 
            companyId: req.user.companyId,
            status: 'archived'
        };

        const projects = await Project.find(query)
            .populate('clientId', 'fullName')
            .populate('pmId', 'fullName')
            .sort({ updatedAt: -1 })
            .lean();

        res.json(projects);
    } catch (error) {
        next(error);
    }
};

// @desc    Restore archived project
// @route   PATCH /api/projects/:id/restore
// @access  Private (COMPANY_OWNER, SUPER_ADMIN)
const restoreProject = async (req, res, next) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        project.status = 'active'; // Default back to active
        await project.save();

        res.json({ message: 'Project restored successfully', project });
    } catch (error) {
        next(error);
    }
};

// @desc    Permanently delete project
// @route   DELETE /api/projects/:id/permanent
// @access  Private (COMPANY_OWNER, SUPER_ADMIN)
const permanentlyDeleteProject = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id);

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        // Multi-tenant authorization check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== project.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to delete this project');
        }

        const Job = require('../models/Job');
        const JobTask = require('../models/JobTask');
        const TimeLog = require('../models/TimeLog');
        const ChatRoom = require('../models/ChatRoom');

        // Delete dependencies
        await TimeLog.deleteMany({ projectId: project._id });
        await JobTask.deleteMany({ jobId: { $in: await Job.find({ projectId: project._id }).distinct('_id') } });
        await Job.deleteMany({ projectId: project._id });
        await ChatRoom.deleteMany({ projectId: project._id });

        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project permanently removed' });
    } catch (error) {
        next(error);
    }
};

// @desc    Get project members (Team members working on the project)
// @route   GET /api/projects/:id/members
// @access  Private
const getProjectMembers = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id);

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        // Multi-tenant authorization check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== project.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to access this project');
        }

        // Find all users assigned to tasks in this project
        const tasks = await Task.find({ projectId: req.params.id }).select('assignedTo');
        const assignedUserIds = new Set();
        
        tasks.forEach(t => {
            if (t.assignedTo) {
                t.assignedTo.forEach(id => assignedUserIds.add(id.toString()));
            }
        });

        // Also check Job-level assignments
        const Job = require('../models/Job');
        const jobs = await Job.find({ projectId: req.params.id }).select('foremanId assignedWorkers');
        jobs.forEach(j => {
            if (j.foremanId) assignedUserIds.add(j.foremanId.toString());
            if (j.assignedWorkers) {
                j.assignedWorkers.forEach(id => assignedUserIds.add(id.toString()));
            }
        });

        // Include project creator and assigned PM
        if (project.createdBy) assignedUserIds.add(project.createdBy.toString());
        if (project.pmId) assignedUserIds.add(project.pmId.toString());

        const members = await User.find({
            _id: { $in: Array.from(assignedUserIds) },
            role: { $ne: 'CLIENT' }
        }).select('fullName email role phone status');

        res.json(members);
    } catch (error) {
        next(error);
    }
};

// @desc    Get client-safe progress summary
// @route   GET /api/projects/:id/client-progress
// @access  Private (Client, Admin, PM)
const getClientProgress = async (req, res, next) => {
    try {
        const Project = require('../models/Project');
        const Job = require('../models/Job');
        const JobTask = require('../models/JobTask');

        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        // Logic check: only assigned client or company staff
        if (req.user.role === 'CLIENT' && project.clientId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const jobs = await Job.find({ projectId: project._id }).select('_id status').lean();
        const jobIds = jobs.map(j => j._id);

        const tasks = await JobTask.find({ jobId: { $in: jobIds } }).select('status updatedAt title dueDate').lean();

        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.status === 'completed').length;
        const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        // Summarized Completed Work (Top 10)
        const completedWork = tasks
            .filter(t => t.status === 'completed')
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 10)
            .map(t => t.title);

        // Upcoming Work (Next 5)
        const upcomingWork = tasks
            .filter((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'in-progress')
            .sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity))
            .slice(0, 5)
            .map(t => t.title);

        res.json({
            projectName: project.name,
            currentPhase: project.currentPhase || 'Planning',
            progress: progressPercentage,
            status: project.status,
            completedWork,
            upcomingWork,
            startDate: project.startDate,
            endDate: project.endDate
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get client-visible updates
// @route   GET /api/projects/:id/client-updates
// @access  Private
const getProjectClientUpdates = async (req, res, next) => {
    try {
        const ProjectUpdate = require('../models/ProjectUpdate');
        const query = { projectId: req.params.id };

        if (req.user.role === 'CLIENT') {
            query.isVisibleToClient = true;
        }

        const updates = await ProjectUpdate.find(query)
            .sort({ date: -1 })
            .populate('createdBy', 'fullName')
            .lean();

        res.json(updates);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a project update
// @route   POST /api/projects/:id/client-updates
// @access  Private (PM+)
const createProjectClientUpdate = async (req, res, next) => {
    try {
        const ProjectUpdate = require('../models/ProjectUpdate');
        const Notification = require('../models/Notification');
        const Project = require('../models/Project');

        // Handle images from multer (CloudinaryStorage)
        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(file => file.path);
        }

        // Parse isVisibleToClient from FormData (comes as string)
        const isVisibleToClient = req.body.isVisibleToClient === 'true' || req.body.isVisibleToClient === true;

        const update = await ProjectUpdate.create({
            title: req.body.title,
            description: req.body.description,
            date: req.body.date || new Date(),
            isVisibleToClient,
            images,
            projectId: req.params.id,
            createdBy: req.user._id
        });

        // --- Notification Logic ---
        if (isVisibleToClient) {
            const project = await Project.findById(req.params.id);
            if (project && project.clientId) {
                // Create notification for client
                await Notification.create({
                    companyId: req.user.companyId,
                    userId: project.clientId,
                    title: 'New Project Update',
                    message: `A new update has been posted for project: "${project.name}".`,
                    type: 'system',
                    link: `/client-portal/progress/${project._id}`
                });

                // Emit socket event if io is available
                const io = req.app.get('io');
                if (io) {
                    io.to(project.clientId.toString()).emit('new_notification', {
                        title: 'New Project Update',
                        message: `A new update has been posted for project: "${project.name}".`
                    });
                }
            }
        }

        res.status(201).json(update);
    } catch (error) {
        next(error);
    }
};

// @desc    Get project financial summary (PO totals)
// @route   GET /api/projects/:id/financial-summary
// @access  Private
const getProjectFinancialSummary = async (req, res, next) => {
    try {
        const Project = require('../models/Project');
        const PurchaseOrder = require('../models/purchaseOrder.model');

        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        // Sum non-cancelled POs
        const pos = await PurchaseOrder.find({
            projectId: project._id,
            status: { $ne: 'Cancelled' }
        });

        const totalPoCost = pos.reduce((sum, po) => sum + (po.totalAmount || 0), 0);
        const committedCost = pos
            .filter(po => ['Approved', 'Sent', 'Delivered', 'Closed'].includes(po.status))
            .reduce((sum, po) => sum + (po.totalAmount || 0), 0);

        const pendingCost = totalPoCost - committedCost;
        const budget = project.budget || 0;
        const remainingBudget = budget - totalPoCost;
        const utilizationPercentage = budget > 0 ? (totalPoCost / budget) * 100 : 0;

        res.json({
            totalBudget: budget,
            totalPoCost,
            committedCost,
            pendingCost,
            remainingBudget,
            utilizationPercentage: utilizationPercentage.toFixed(2),
            poCount: pos.length
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    getProjectMembers,
    getClientProgress,
    getProjectClientUpdates,
    createProjectClientUpdate,
    getProjectFinancialSummary,
    getArchivedProjects,
    restoreProject,
    permanentlyDeleteProject
};

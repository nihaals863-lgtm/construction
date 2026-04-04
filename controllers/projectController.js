const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const Company = require('../models/Company');
const Plan = require('../models/Plan');


// @desc    Get projects for the company
// @route   GET /api/projects
// @access  Private
const getProjects = async (req, res, next) => {
    try {
        console.log('GET /api/projects - start', req.user.role);
        // Multi-tenant check: Filter by companyId
        const query = { companyId: req.user.companyId };

        // Super Admin can see all projects
        if (req.user.role === 'SUPER_ADMIN') {
            delete query.companyId;
        }

        // PM / Foreman / Worker Visibility Logic
        if (['PM', 'FOREMAN', 'WORKER'].includes(req.user.role)) {
            console.log('GET /api/projects - filtered visibility check');
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

            console.log('GET /api/projects - finding jobs with filter', jobFilter);
            const assignedJobs = await Job.find(jobFilter).select('projectId');
            console.log('GET /api/projects - jobs found', assignedJobs.length);
            // Ensure we handle cases where projectId might be missing or invalid
            const jobProjectIds = assignedJobs
                .filter(j => j.projectId)
                .map(j => j.projectId.toString());

            if (req.user.role === 'PM') {
                // For PMs, also include projects they are directly assigned to or created
                console.log('GET /api/projects - finding direct projects for PM');
                const directProjects = await Project.find({
                    companyId: req.user.companyId,
                    $or: [
                        { pmId: req.user._id },
                        { createdBy: req.user._id }
                    ]
                }).select('_id');
                const directProjectIds = directProjects.map(p => p._id.toString());

                // Combine and unique
                const allProjectIds = [...new Set([...jobProjectIds, ...directProjectIds])];

                // If the PM is involved in any project via jobs or direct assignment,
                // filter the main query by those IDs.
                query._id = { $in: allProjectIds };
            } else {
                query._id = { $in: jobProjectIds };
            }
        }

        // Clients can only see their own projects
        if (req.user.role === 'CLIENT') {
            query.clientId = req.user._id;
        }

        console.log('GET /api/projects - final query', query);
        const projects = await Project.find(query)
            .populate('clientId', 'fullName email')
            .populate('createdBy', 'fullName')
            .populate('pmId', 'fullName email')
            .sort({ createdAt: -1 });
        console.log('GET /api/projects - success', projects.length);
        res.json(projects);
    } catch (error) {
        console.error('GET /api/projects - error', error);
        next(error);
    }
};

// @desc    Get project by ID
// @route   GET /api/projects/:id
// @access  Private
const getProjectById = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id)
            .populate('clientId', 'fullName email')
            .populate('createdBy', 'fullName')
            .populate('pmId', 'fullName email');

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

        const project = await Project.create({
            companyId: req.user.companyId,
            name,
            clientId,
            startDate,
            endDate,
            budget,
            location,
            geofenceRadius,
            image,
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

        const updatedProject = await Project.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        }).populate('pmId', 'fullName email')
            .populate('createdBy', 'fullName');

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

// @desc    Delete project
// @route   DELETE /api/projects/:id
// @access  Private (COMPANY_OWNER, SUPER_ADMIN)
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
            throw new Error('Not authorized to delete this project');
        }

        const Job = require('../models/Job');
        const JobTask = require('../models/JobTask');
        const TimeLog = require('../models/TimeLog');

        // Find jobs under this project
        const jobs = await Job.find({ projectId: project._id });
        const jobIds = jobs.map(j => j._id);

        // Delete dependencies
        await TimeLog.deleteMany({ projectId: project._id });
        await JobTask.deleteMany({ jobId: { $in: jobIds } });
        await Job.deleteMany({ projectId: project._id });

        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project removed' });
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
        const assignedUserIds = [...new Set(tasks.flatMap(t => t.assignedTo.map(id => id.toString())))];

        // Include project creator and company owners/PMs might also be relevant
        // For now, let's get all staff who are assigned to tasks + the creator
        if (project.createdBy) {
            assignedUserIds.push(project.createdBy.toString());
        }

        const members = await User.find({
            _id: { $in: assignedUserIds },
            role: { $ne: 'CLIENT' } // Only staff members, client already knows themselves
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

        const jobs = await Job.find({ projectId: project._id });
        const jobIds = jobs.map(j => j._id);

        const tasks = await JobTask.find({ jobId: { $in: jobIds } });

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
            .filter(t => t.status === 'pending' || t.status === 'in-progress')
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
            .populate('createdBy', 'fullName');

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
    getProjectFinancialSummary
};

const mongoose = require('mongoose');
const JobTask = require('../models/JobTask');
const Job = require('../models/Job');
const User = require('../models/User');
const Notification = require('../models/Notification');
const SubTask = require('../models/SubTask');

// Helper: Validate role-based assignment hierarchy
const validateAssignmentHierarchy = async (assignerRole, assigneeId) => {
    if (!assigneeId) return null;
    const assignee = await User.findById(assigneeId).select('role fullName');
    if (!assignee) return null;
    if (assignerRole === 'PM' && assignee.role === 'WORKER') {
        return `Project Manager cannot directly assign tasks to a Worker. Assign to Foreman or Subcontractor first. (Tried to assign to: ${assignee.fullName})`;
    }
    if (['FOREMAN', 'SUBCONTRACTOR'].includes(assignerRole) && assignee.role !== 'WORKER') {
        return `${assignerRole} can only assign tasks to Workers. (Tried to assign to: ${assignee.fullName} who is ${assignee.role})`;
    }
    return null;
};

// Helper: Recursively create subtasks from a tree (for templates/pre-fills)
const createSubTasksRecursive = async (taskId, onModel, steps, companyId, createdBy, parentId = null, assignedTo = null, startDate = null, dueDate = null) => {
    if (!steps || !Array.isArray(steps) || steps.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const subTask = await SubTask.create({
            taskId,
            onModel,
            companyId,
            title: step.title,
            remarks: step.remarks || '',
            priority: step.priority || 'Medium',
            createdBy,
            position: i,
            parentSubTaskId: parentId,
            assignedTo: step.assignedTo || assignedTo || undefined,
            startDate: step.startDate || startDate || undefined,
            dueDate: step.dueDate || dueDate || undefined,
            status: 'todo'
        });
        count++;
        if (step.steps && step.steps.length > 0) {
            const childCount = await createSubTasksRecursive(taskId, onModel, step.steps, companyId, createdBy, subTask._id, assignedTo, startDate, dueDate);
            subTask.subTaskCount = childCount;
            await subTask.save();
            count += childCount;
        }
    }
    return count;
};

// Helper to update job progress
const updateJobProgress = async (jobId) => {
    try {
        const totalTasks = await JobTask.countDocuments({ jobId, status: { $ne: 'cancelled' } });
        if (totalTasks === 0) {
            await Job.findByIdAndUpdate(jobId, { progress: 0 });
            return;
        }

        const completedTasks = await JobTask.countDocuments({ jobId, status: 'completed' });
        const progress = Math.round((completedTasks / totalTasks) * 100);

        await Job.findByIdAndUpdate(jobId, { progress });
    } catch (err) {
        console.error('Error updating job progress:', err);
    }
};

// @desc    Create a new job task
// @route   POST /api/job-tasks
// @access  Private (Admin/PM/Foreman)
const createJobTask = async (req, res) => {
    try {
        const { jobId, title, description, assignedTo, assignedRoleType, priority, dueDate, startDate, subTasksList } = req.body;

        // --- Role Hierarchy Validation ---
        const hierarchyError = await validateAssignmentHierarchy(req.user.role, assignedTo);
        if (hierarchyError) {
            return res.status(403).json({ message: hierarchyError });
        }

        let assignedForeman = null;
        if (assignedTo) {
            const assigneeInfo = await User.findById(assignedTo).select('role');
            if (assigneeInfo && assigneeInfo.role === 'FOREMAN') {
                assignedForeman = assignedTo;
            } else if (req.user.role === 'FOREMAN') {
                assignedForeman = req.user._id;
            }
        }

        // Normalize for JobTask Schema
        const normalizedPriority = (priority || 'medium').toLowerCase();

        const task = await JobTask.create({
            jobId,
            companyId: req.user.companyId,
            title,
            description,
            assignedTo,
            assignedRoleType: assignedRoleType || '',
            assignedForeman,
            priority: normalizedPriority,
            status: 'pending', // Always start as pending in JobTask
            dueDate,
            startDate,
            createdBy: req.user._id
        });

        // Generate auto steps if passed via subTasksList (Task Template feature)
        if (subTasksList && Array.isArray(subTasksList) && subTasksList.length > 0) {
            const totalCreated = await createSubTasksRecursive(task._id, 'JobTask', subTasksList, req.user.companyId, req.user._id, null, assignedTo, startDate, dueDate);
            task.subTaskCount = totalCreated;
            await task.save();
        }

        await updateJobProgress(jobId);

        // Fetch job and project details for notification message
        const job = await Job.findById(jobId).populate('projectId', 'name');

        // Create notification for assigned worker
        if (assignedTo) {
            await Notification.create({
                companyId: req.user.companyId,
                userId: assignedTo,
                title: 'New Task Assigned',
                message: `You have been assigned a new task: "${title}" for job ${job?.name || 'Unknown'}.`,
                type: 'task',
                link: `/company-admin/projects/${job?.projectId?._id}/jobs/${jobId}`
            });

            // Emit socket event if io is available
            const io = req.app.get('io');
            if (io) {
                io.to(assignedTo.toString()).emit('notification', {
                    title: 'New Task Assigned',
                    message: `You have been assigned a new task: "${title}".`
                });
            }
        }

        const populatedTask = await JobTask.findById(task._id).populate('assignedTo', 'fullName role');
        res.status(201).json(populatedTask);
    } catch (err) {
        console.error('Error in createJobTask:', err);
        res.status(500).json({ message: err.message });
    }
};

// @desc    Get all tasks for a job
// @route   GET /api/job-tasks/job/:jobId
// @access  Private
const getJobTasks = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const filter = { jobId: req.params.jobId, companyId };

        // For workers, only show their own tasks OR tasks where they have assigned sub-tasks
        if (req.user.role === 'WORKER') {
            const subTaskJobTaskIds = await SubTask.find({ assignedTo: req.user._id, companyId, onModel: 'JobTask' }).distinct('taskId');
            filter.$or = [
                { assignedTo: req.user._id },
                { _id: { $in: subTaskJobTaskIds } }
            ];
        }

        const tasks = await JobTask.find(filter)
            .populate('assignedTo', 'fullName role')
            .sort({ createdAt: -1 })
            .lean();

        // Fetch all sub-tasks for these job tasks
        const taskIds = tasks.map(t => t._id);
        const subTasks = await SubTask.find({ taskId: { $in: taskIds }, companyId })
            .populate('assignedTo', 'fullName role')
            .populate('createdBy', 'fullName')
            .lean();

        // Mapped sub-tasks for UI consistency
        const mappedSubTasks = subTasks.map(st => ({
            ...st,
            isSubTask: true,
            isJobTask: true,
        }));

        const allTasks = [...tasks, ...mappedSubTasks].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(allTasks);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Update a job task
// @route   PATCH /api/job-tasks/:id
// @access  Private
const updateJobTask = async (req, res) => {
    try {
        const task = await JobTask.findById(req.params.id);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        // Workers can only update status
        if (req.user.role === 'WORKER') {
            // Check if task is assigned to them (or they have subtask - but updateJobTask usually for main task)
            if (task.assignedTo?.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Not authorized to update this task' });
            }
            const { status, cancellationReason } = req.body;
            if (status) task.status = status;
            if (cancellationReason) task.cancellationReason = cancellationReason;
        } else {
            // Admin/PM/Foreman can update anything
            
            // Normalize status and priority if they exist in body
            if (req.body.status === 'todo') req.body.status = 'pending';
            if (req.body.priority) req.body.priority = req.body.priority.toLowerCase();
            
            Object.assign(task, req.body);
            if (req.body.assignedTo && req.user.role === 'FOREMAN' && !task.assignedForeman) {
                task.assignedForeman = req.user._id;
            }
        }

        await task.save();

        if (req.body.status) {
            await updateJobProgress(task.jobId);

            // Notify creator if status updated by someone else
            if (task.createdBy.toString() !== req.user._id.toString()) {
                await Notification.create({
                    companyId: req.user.companyId,
                    userId: task.createdBy,
                    title: 'Task Status Updated',
                    message: `Task "${task.title}" status changed to ${task.status} by ${req.user.fullName}.`,
                    type: 'task',
                    link: `/company-admin/projects/all/jobs/${task.jobId}`
                });

                const io = req.app.get('io');
                if (io) {
                    io.to(task.createdBy.toString()).emit('notification', {
                        title: 'Task Status Updated',
                        message: `Task "${task.title}" status changed to ${task.status}.`
                    });
                }
            }
        }

        const populatedTask = await JobTask.findById(task._id).populate('assignedTo', 'fullName role');
        res.json(populatedTask);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// @desc    Delete a job task
// @route   DELETE /api/job-tasks/:id
// @access  Private (Admin/PM)
const deleteJobTask = async (req, res) => {
    try {
        const task = await JobTask.findById(req.params.id);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        if (req.user.role === 'WORKER') {
            if (task.assignedTo?.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Not authorized to delete this task' });
            }
            if (task.status !== 'cancelled') {
                return res.status(400).json({ message: 'Can only delete cancelled tasks' });
            }
        }

        const jobId = task.jobId;
        await JobTask.findByIdAndDelete(req.params.id);

        await updateJobProgress(jobId);

        res.json({ message: 'Task deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Get worker's assigned tasks (across all jobs)
// @route   GET /api/job-tasks/worker
// @access  Private (Worker)
const getWorkerTasks = async (req, res) => {
    try {
        const userId = req.user._id;
        const companyId = req.user.companyId;

        const subTaskJobTaskIds = await SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId');

        const query = {
            companyId,
            $or: [
                { assignedTo: userId },
                { _id: { $in: subTaskJobTaskIds } }
            ]
        };

        if (req.user.role === 'FOREMAN') {
            query.$or.push({ assignedForeman: userId });
        }

        const tasks = await JobTask.find(query)
            .populate({
                path: 'jobId',
                select: 'name projectId',
                populate: { path: 'projectId', select: 'name' }
            })
            .sort({ createdAt: -1 });
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    createJobTask,
    getJobTasks,
    updateJobTask,
    deleteJobTask,
    getWorkerTasks
};

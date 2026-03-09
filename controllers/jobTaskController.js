const JobTask = require('../models/JobTask');
const Job = require('../models/Job');
const User = require('../models/User');
const Notification = require('../models/Notification');

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
        const { jobId, title, description, assignedTo, priority, dueDate } = req.body;

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

        const task = await JobTask.create({
            jobId,
            companyId: req.user.companyId,
            title,
            description,
            assignedTo,
            assignedForeman,
            priority,
            dueDate,
            createdBy: req.user._id
        });

        await updateJobProgress(jobId);

        // Fetch job and project details for notification message
        const job = await Job.findById(jobId).populate('projectId', 'name');

        // Create notification for assigned worker
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

        const populatedTask = await JobTask.findById(task._id).populate('assignedTo', 'fullName role');
        res.status(201).json(populatedTask);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// @desc    Get all tasks for a job
// @route   GET /api/job-tasks/job/:jobId
// @access  Private
const getJobTasks = async (req, res) => {
    try {
        const filter = { jobId: req.params.jobId, companyId: req.user.companyId };

        // For workers, only show their own tasks (as per requirement "Workers should only see their assigned tasks")
        // NOTE: The request said "Workers can only see their assigned tasks", but usually on a job page they might see titles.
        // I will stick to the strict rule for now.
        if (req.user.role === 'WORKER') {
            filter.assignedTo = req.user._id;
        }

        const tasks = await JobTask.find(filter)
            .populate('assignedTo', 'fullName role')
            .sort({ createdAt: -1 });
        res.json(tasks);
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
            // Check if task is assigned to them
            if (task.assignedTo.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Not authorized to update this task' });
            }
            const { status, cancellationReason } = req.body;
            if (status) task.status = status;
            if (cancellationReason) task.cancellationReason = cancellationReason;
        } else {
            // Admin/PM/Foreman can update anything
            Object.assign(task, req.body);
            if (req.body.assignedTo && req.user.role === 'FOREMAN' && !task.assignedForeman) {
                task.assignedForeman = req.user._id;
            }
        }

        await task.save();

        if (req.body.status) {
            await updateJobProgress(task.jobId);

            // Notify creator if status updated by someone else (e.g. worker completes task)
            if (task.createdBy.toString() !== req.user._id.toString()) {
                await Notification.create({
                    companyId: req.user.companyId,
                    userId: task.createdBy,
                    title: 'Task Status Updated',
                    message: `Task "${task.title}" status changed to ${task.status} by ${req.user.fullName}.`,
                    type: 'task',
                    link: `/company-admin/projects/all/jobs/${task.jobId}` // Generic link since we don't have projectId easily here without populating
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

        // Workers can only delete tasks assigned to them that are 'cancelled'
        if (req.user.role === 'WORKER') {
            if (task.assignedTo.toString() !== req.user._id.toString()) {
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
        const query = {
            companyId: req.user.companyId
        };

        if (req.user.role === 'FOREMAN') {
            query.$or = [{ assignedTo: req.user._id }, { assignedForeman: req.user._id }];
        } else {
            query.assignedTo = req.user._id;
        }

        const tasks = await JobTask.find(query)
            .populate({
                path: 'jobId',
                select: 'name projectId',
                populate: { path: 'projectId', select: 'name' }
            })
            .sort({ dueDate: 1 });
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

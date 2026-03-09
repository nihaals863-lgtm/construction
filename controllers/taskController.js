const mongoose = require('mongoose');
const Task = require('../models/Task');
const SubTask = require('../models/SubTask');
const Job = require('../models/Job');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { dispatchNotification } = require('../utils/notificationHelper');

// Helper: Validate if assigner can assign to given assignees based on role hierarchy
const validateAssignmentHierarchy = async (assignerRole, assigneeIds) => {
    if (!assigneeIds || assigneeIds.length === 0) return null; // No assignees is fine
    const assignees = await User.find({ _id: { $in: assigneeIds } }).select('role fullName');
    for (const assignee of assignees) {
        if (assignerRole === 'PM' && assignee.role === 'WORKER') {
            return `Project Manager cannot directly assign tasks to a Worker. Assign to Foreman or Subcontractor first. (Tried to assign to: ${assignee.fullName})`;
        }
        if (['FOREMAN', 'SUBCONTRACTOR'].includes(assignerRole) && !['WORKER'].includes(assignee.role)) {
            return `${assignerRole} can only assign tasks to Workers. (Tried to assign to: ${assignee.fullName} who is ${assignee.role})`;
        }
    }
    return null; // All valid
};

// @desc    Get tasks (role-based)
// @route   GET /api/tasks
// @access  Private
const getTasks = async (req, res, next) => {
    try {
        const { role, _id: userId, companyId } = req.user;
        const query = { companyId };

        if (req.query.projectId) query.projectId = req.query.projectId;
        if (req.query.status) query.status = req.query.status;
        if (req.query.priority) query.priority = req.query.priority;
        if (req.query.assignedRoleType) query.assignedRoleType = req.query.assignedRoleType;

        // WORKER or SUBCONTRACTOR: only own assigned tasks OR tasks where they have sub-tasks
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            const subTaskTaskIds = await SubTask.find({ assignedTo: userId, companyId }).distinct('taskId');
            query.$or = [
                { assignedTo: userId },
                { _id: { $in: subTaskTaskIds } }
            ];
        }
        // FOREMAN: own tasks + tasks assigned to workers in their managed jobs
        else if (role === 'FOREMAN') {
            const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
            const workerIds = managedJobs.flatMap(j => j.assignedWorkers || []);
            const allIds = [userId, ...workerIds];

            // Also include tasks where they have sub-tasks
            const subTaskTaskIds = await SubTask.find({ assignedTo: userId, companyId }).distinct('taskId');

            query.$or = [
                { assignedTo: { $in: allIds } },
                { _id: { $in: subTaskTaskIds } }
            ];
        }
        // PM / COMPANY_OWNER / SUPER_ADMIN / ENGINEER: all company tasks

        const tasks = await Task.find(query)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName email role')
            .populate('createdBy', 'fullName')
            .populate('assignedBy', 'fullName')
            .sort({ dueDate: 1, createdAt: -1 });

        res.json(tasks);
    } catch (error) {
        next(error);
    }
};

// @desc    Get tasks assigned to the logged-in user
// @route   GET /api/tasks/my-tasks
// @access  Private
const getMyTasks = async (req, res, next) => {
    try {
        const subTaskTaskIds = await SubTask.find({ assignedTo: req.user._id, companyId: req.user.companyId }).distinct('taskId');

        const query = {
            companyId: req.user.companyId,
            $or: [
                { assignedTo: req.user._id },
                { _id: { $in: subTaskTaskIds } }
            ]
        };
        if (req.query.status) query.status = req.query.status;

        const tasks = await Task.find(query)
            .populate('projectId', 'name')
            .populate('assignedBy', 'fullName role')
            .populate('createdBy', 'fullName')
            .sort({ dueDate: 1 });

        res.json(tasks);
    } catch (error) {
        next(error);
    }
};

// @desc    Get all tasks for a specific project
// @route   GET /api/tasks/project/:projectId
// @access  Private
const getProjectTasks = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const { role, _id: userId, companyId } = req.user;

        const query = { companyId, projectId };

        // Workers/Subcontractors see only their own tasks for the project (inc. sub-tasks)
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            const subTaskTaskIds = await SubTask.find({ assignedTo: userId, companyId, taskId: { $exists: true } }).distinct('taskId');
            query.$or = [
                { assignedTo: userId },
                { _id: { $in: subTaskTaskIds } }
            ];
        } else if (role === 'FOREMAN') {
            const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
            const workerIds = managedJobs.flatMap(j => j.assignedWorkers || []);
            const allIds = [userId, ...workerIds];
            const subTaskTaskIds = await SubTask.find({ assignedTo: userId, companyId }).distinct('taskId');

            query.$or = [
                { assignedTo: { $in: allIds } },
                { _id: { $in: subTaskTaskIds } }
            ];
        }

        const tasks = await Task.find(query)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName email role')
            .populate('assignedBy', 'fullName role')
            .populate('createdBy', 'fullName')
            .sort({ dueDate: 1 });

        res.json(tasks);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new task
// @route   POST /api/tasks
// @access  Private (Admin, PM, Foreman)
const createTask = async (req, res, next) => {
    try {
        const { title, description, projectId, assignedTo, assignedRoleType, priority, status, dueDate, startDate } = req.body;

        if (!projectId) {
            res.status(400);
            throw new Error('projectId is required');
        }

        const assignedToArr = assignedTo
            ? (Array.isArray(assignedTo) ? assignedTo : [assignedTo]).filter(Boolean)
            : [];

        // --- Role Hierarchy Validation ---
        const hierarchyError = await validateAssignmentHierarchy(req.user.role, assignedToArr);
        if (hierarchyError) {
            return res.status(403).json({ message: hierarchyError });
        }

        const task = await Task.create({
            companyId: req.user.companyId,
            projectId,
            title,
            description: description || '',
            assignedTo: assignedToArr,
            assignedRoleType: assignedRoleType || '',
            assignedBy: assignedToArr.length > 0 ? req.user._id : undefined,
            priority: priority || 'Medium',
            status: status || 'todo',
            dueDate: dueDate || undefined,
            startDate: startDate || undefined,
            createdBy: req.user._id,
            statusHistory: [{ status: status || 'todo', changedBy: req.user._id }]
        });

        // Notify each assigned user
        for (const uid of assignedToArr) {
            await dispatchNotification(req, {
                userId: uid,
                title: 'New Task Assigned',
                message: `You have been assigned: "${title}" by ${req.user.fullName}`,
                link: '/tasks',
                type: 'task'
            });
        }

        // Audit log
        await AuditLog.create({
            userId: req.user._id,
            action: 'TASK_CREATED',
            module: 'TASKS',
            details: `Created task "${title}"`,
            metadata: { taskId: task._id, projectId, assignedTo: assignedToArr }
        });

        // Sync Chat Participants
        try {
            const { syncProjectParticipants } = require('./chatController');
            await syncProjectParticipants(projectId);
        } catch (syncError) {
            console.error('Task Create: Failed to sync chat participants:', syncError);
        }

        const populated = await Task.findById(task._id)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName email role')
            .populate('assignedBy', 'fullName')
            .populate('createdBy', 'fullName');

        res.status(201).json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Assign / reassign task to user(s)
// @route   PUT /api/tasks/:id/assign
// @access  Private (Admin, PM, Foreman)
const assignTask = async (req, res, next) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!task) {
            res.status(404);
            throw new Error('Task not found');
        }

        const { assignedTo, assignedRoleType } = req.body;
        const assignedToArr = assignedTo
            ? (Array.isArray(assignedTo) ? assignedTo : [assignedTo]).filter(Boolean)
            : [];

        // --- Role Hierarchy Validation ---
        const hierarchyError = await validateAssignmentHierarchy(req.user.role, assignedToArr);
        if (hierarchyError) {
            return res.status(403).json({ message: hierarchyError });
        }

        // Track previous assignees to notify new ones only
        const previousIds = task.assignedTo.map(id => id.toString());
        const newlyAssigned = assignedToArr.filter(id => !previousIds.includes(id.toString()));

        task.assignedTo = assignedToArr;
        task.assignedRoleType = assignedRoleType || task.assignedRoleType;
        task.assignedBy = req.user._id;
        task.statusHistory.push({ status: task.status, changedBy: req.user._id, note: `Reassigned by ${req.user.fullName}` });

        await task.save();

        // Notify newly assigned users
        for (const uid of newlyAssigned) {
            await dispatchNotification(req, {
                userId: uid,
                title: 'Task Assigned to You',
                message: `"${task.title}" has been assigned to you by ${req.user.fullName}`,
                link: '/tasks',
                type: 'task'
            });
        }

        await AuditLog.create({
            userId: req.user._id,
            action: 'TASK_ASSIGNED',
            module: 'TASKS',
            details: `Assigned task "${task.title}" to ${assignedToArr.join(', ')}`,
            metadata: { taskId: task._id, assignedTo: assignedToArr }
        });

        // Sync Chat Participants
        try {
            const { syncProjectParticipants } = require('./chatController');
            await syncProjectParticipants(task.projectId);
        } catch (syncError) {
            console.error('Task Assign: Failed to sync chat participants:', syncError);
        }

        const populated = await Task.findById(task._id)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName email role')
            .populate('assignedBy', 'fullName');

        res.json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Update task (status, title, etc.)
// @route   PATCH /api/tasks/:id
// @access  Private
const updateTask = async (req, res, next) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!task) {
            res.status(404);
            throw new Error('Task not found');
        }

        const { role, _id: userId } = req.user;
        const isAdmin = ['SUPER_ADMIN', 'COMPANY_OWNER', 'PM'].includes(role);
        const isForeman = role === 'FOREMAN';
        const isAssigned = task.assignedTo.some(id => id.toString() === userId.toString());

        // Workers/Subcontractors can only update status of their own tasks — not reassign
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            if (!isAssigned) {
                res.status(403);
                throw new Error('You can only update tasks assigned to you');
            }
            // Strip reassignment fields
            delete req.body.assignedTo;
            delete req.body.assignedBy;
            delete req.body.assignedRoleType;
        }

        // Foreman cannot modify tasks owned by admin
        if (isForeman && !isAssigned && !isAdmin) {
            delete req.body.assignedTo;
        }

        // OTP check if completing
        if (req.body.status === 'completed' && task.completionOTP) {
            if (req.body.otp !== task.completionOTP) {
                res.status(400);
                throw new Error('Invalid Completion OTP');
            }
        }

        // Track status change
        if (req.body.status && req.body.status !== task.status) {
            task.statusHistory.push({ status: req.body.status, changedBy: userId });
        }

        Object.assign(task, req.body);
        // Re-resolve assignedTo as array
        if (req.body.assignedTo && !Array.isArray(req.body.assignedTo)) {
            task.assignedTo = [req.body.assignedTo].filter(Boolean);
        }

        await task.save();

        // Sync Chat Participants if assignedTo changed
        if (req.body.assignedTo) {
            try {
                const { syncProjectParticipants } = require('./chatController');
                await syncProjectParticipants(task.projectId);
            } catch (syncError) {
                console.error('Task Update: Failed to sync chat participants:', syncError);
            }
        }

        await AuditLog.create({
            userId: req.user._id,
            action: 'TASK_UPDATED',
            module: 'TASKS',
            details: `Updated task "${task.title}"`,
            metadata: { taskId: task._id, changes: req.body }
        });

        const populated = await Task.findById(task._id)
            .populate('projectId', 'name')
            .populate('assignedTo', 'fullName email role')
            .populate('assignedBy', 'fullName')
            .populate('createdBy', 'fullName');

        // Notify creator if worker marked complete
        if (req.body.status === 'completed' && task.createdBy?.toString() !== userId.toString()) {
            await dispatchNotification(req, {
                userId: task.createdBy,
                title: 'Task Completed',
                message: `"${task.title}" has been marked complete by ${req.user.fullName}`,
                link: '/tasks'
            });
        }

        res.json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:id
// @access  Private (Admin, PM only)
const deleteTask = async (req, res, next) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!task) {
            res.status(404);
            throw new Error('Task not found');
        }

        await Task.findByIdAndDelete(req.params.id);

        await AuditLog.create({
            userId: req.user._id,
            action: 'TASK_DELETED',
            module: 'TASKS',
            details: `Deleted task "${task.title}"`,
            metadata: { taskId: task._id }
        });

        res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// --- Sub-Tasks ---

// @desc    Get sub-tasks for a task
// @route   GET /api/tasks/:id/subtasks
// @access  Private
const getSubTasks = async (req, res, next) => {
    try {
        const { role, _id: userId, companyId } = req.user;
        const isAdminOrPM = ['SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'ADMIN'].includes(role);

        let visibleSubTaskIds = null; // null = no restriction (admin/PM)

        if (!isAdminOrPM) {
            // Collect all subtasks for this task first
            const allForTask = await SubTask.find({ taskId: req.params.id, companyId }).select('_id assignedTo createdBy parentSubTaskId');

            if (role === 'FOREMAN') {
                // Foreman sees subtasks assigned to themselves OR workers in their managed jobs
                const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
                const workerIds = managedJobs.flatMap(j => (j.assignedWorkers || []).map(id => id.toString()));
                const allowedIds = new Set([userId.toString(), ...workerIds]);

                visibleSubTaskIds = allForTask
                    .filter(st => allowedIds.has(st.assignedTo?.toString()) || st.createdBy?.toString() === userId.toString())
                    .map(st => st._id);
            } else {
                // WORKER / SUBCONTRACTOR — only see subtasks directly assigned to them
                visibleSubTaskIds = allForTask
                    .filter(st => st.assignedTo?.toString() === userId.toString() || st.createdBy?.toString() === userId.toString())
                    .map(st => st._id);
            }
        }

        const filter = {
            taskId: req.params.id,
            companyId,
            ...(visibleSubTaskIds !== null && { _id: { $in: visibleSubTaskIds } })
        };

        const subTasks = await SubTask.find(filter)
            .populate('assignedTo', 'fullName role')
            .populate('createdBy', 'fullName')
            .sort({ createdAt: 1 });

        res.json(subTasks);
    } catch (error) {
        next(error);
    }
};


// @desc    Create a sub-task
// @route   POST /api/tasks/:id/subtasks
// @access  Private
// @desc    Create a sub-task
// @route   POST /api/tasks/:id/subtasks
// @access  Private
// Helper: recursively delete a subtask and all its descendants
const deleteSubTaskCascade = async (subTaskId) => {
    const children = await SubTask.find({ parentSubTaskId: subTaskId });
    for (const child of children) {
        await deleteSubTaskCascade(child._id);
    }
    await SubTask.findByIdAndDelete(subTaskId);
};

// Helper: recalculate progress on a parent subtask based on its direct children
const recalcSubTaskProgress = async (parentSubTaskId) => {
    if (!parentSubTaskId) return;
    const children = await SubTask.find({ parentSubTaskId });
    if (children.length === 0) {
        await SubTask.findByIdAndUpdate(parentSubTaskId, { subTaskCount: 0, progress: 0 });
        return;
    }
    const completedCount = children.filter(c => c.status === 'completed').length;
    const progress = Math.round((completedCount / children.length) * 100);
    await SubTask.findByIdAndUpdate(parentSubTaskId, {
        subTaskCount: children.length,
        progress,
        status: progress === 100 ? 'completed' : (progress > 0 ? 'in_progress' : 'todo')
    });
};

const createSubTask = async (req, res, next) => {
    try {
        const { title, assignedTo, dueDate, remarks, priority, parentSubTaskId } = req.body;

        const parentTask = await Task.findById(req.params.id);
        if (!parentTask) {
            res.status(404);
            throw new Error('Main task not found');
        }

        // If nesting under another subtask, validate it exists
        if (parentSubTaskId) {
            const parentSub = await SubTask.findById(parentSubTaskId);
            if (!parentSub) {
                res.status(404);
                throw new Error('Parent subtask not found');
            }
        }

        const subTask = await SubTask.create({
            taskId: req.params.id,
            parentSubTaskId: parentSubTaskId || null,
            companyId: req.user.companyId,
            title,
            assignedTo: assignedTo || null,
            dueDate: dueDate || undefined,
            remarks: remarks || '',
            priority: priority || 'Medium',
            createdBy: req.user._id
        });

        // Update parent subtask counts if nested
        if (parentSubTaskId) {
            await recalcSubTaskProgress(parentSubTaskId);
        }

        // Update root task count and progress (based on top-level subtasks only)
        const topLevelSubTasks = await SubTask.find({ taskId: req.params.id, parentSubTaskId: null });
        const completed = topLevelSubTasks.filter(st => st.status === 'completed').length;
        const progress = topLevelSubTasks.length > 0 ? Math.round((completed / topLevelSubTasks.length) * 100) : 0;

        const updateData = { subTaskCount: topLevelSubTasks.length, progress };

        if (assignedTo) {
            await Task.findByIdAndUpdate(req.params.id, {
                $addToSet: { assignedTo: new mongoose.Types.ObjectId(assignedTo) },
                ...updateData
            });
            await dispatchNotification(req, {
                userId: assignedTo,
                title: 'New Sub-Task Assigned',
                message: `You were assigned a sub-task: "${title}" in "${parentTask.title}"`,
                link: '/tasks',
                type: 'task'
            });
        } else {
            await Task.findByIdAndUpdate(req.params.id, updateData);
        }

        const populated = await SubTask.findById(subTask._id)
            .populate('assignedTo', 'fullName role')
            .populate('createdBy', 'fullName');
        res.status(201).json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Update sub-task status
// @route   PATCH /api/tasks/:id/subtasks/:subTaskId
// @access  Private
const updateSubTask = async (req, res, next) => {
    try {
        const updates = req.body;
        const SubTask = require('../models/SubTask');

        const subTask = await SubTask.findOneAndUpdate(
            { _id: req.params.subTaskId, taskId: req.params.id },
            { $set: updates },
            { new: true }
        );

        if (!subTask) {
            res.status(404);
            throw new Error('Sub-task not found');
        }

        // Recalculate main task progress
        const allSubTasks = await SubTask.find({ taskId: req.params.id });
        const completedCount = allSubTasks.filter(st => st.status === 'completed').length;
        const progress = allSubTasks.length > 0 ? Math.round((completedCount / allSubTasks.length) * 100) : 0;

        const updateData = { progress };
        if (progress === 100 && allSubTasks.length > 0) {
            updateData.status = 'completed';
        }

        await Task.findByIdAndUpdate(req.params.id, updateData);

        const populated = await SubTask.findById(subTask._id).populate('assignedTo', 'fullName role');
        res.json(populated);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete sub-task (+ all nested children)
// @route   DELETE /api/tasks/:id/subtasks/:subTaskId
// @access  Private
const deleteSubTask = async (req, res, next) => {
    try {
        const subTask = await SubTask.findOne({ _id: req.params.subTaskId, taskId: req.params.id });

        if (!subTask) {
            res.status(404);
            throw new Error('Sub-task not found');
        }

        const parentSubTaskId = subTask.parentSubTaskId;

        // Cascade delete this subtask and all its descendants
        await deleteSubTaskCascade(req.params.subTaskId);

        // Recalculate parent subtask progress if nested
        if (parentSubTaskId) {
            await recalcSubTaskProgress(parentSubTaskId);
        }

        // Recalculate root task progress based on top-level subtasks
        const topLevelSubTasks = await SubTask.find({ taskId: req.params.id, parentSubTaskId: null });
        const completedCount = topLevelSubTasks.filter(st => st.status === 'completed').length;
        const progress = topLevelSubTasks.length > 0 ? Math.round((completedCount / topLevelSubTasks.length) * 100) : 0;

        await Task.findByIdAndUpdate(req.params.id, {
            $set: { progress, subTaskCount: topLevelSubTasks.length }
        });

        res.json({ message: 'Sub-task deleted successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTasks,
    getMyTasks,
    getProjectTasks,
    createTask,
    assignTask,
    updateTask,
    deleteTask,
    getSubTasks,
    createSubTask,
    updateSubTask,
    deleteSubTask
};

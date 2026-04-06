const mongoose = require('mongoose');
const Task = require('../models/Task');
const SubTask = require('../models/SubTask');
const Job = require('../models/Job');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const JobTask = require('../models/JobTask');
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

// @desc    Get tasks (role-based)
// @route   GET /api/tasks
// @access  Private
const getTasks = async (req, res, next) => {
    try {
        const { role, _id: userId, companyId } = req.user;
        const query = { companyId };
        const jobTaskQuery = { companyId };

        if (req.query.projectId) {
            query.projectId = req.query.projectId;
            const projectJobs = await Job.find({ projectId: req.query.projectId }).distinct('_id');
            jobTaskQuery.jobId = { $in: projectJobs };
        }
        
        if (req.query.status) {
            query.status = req.query.status;
            const statusMap = { todo: 'pending', in_progress: 'in_progress', completed: 'completed' };
            if (statusMap[req.query.status]) jobTaskQuery.status = statusMap[req.query.status];
        }
        
        if (req.query.priority) {
            query.priority = req.query.priority;
            jobTaskQuery.priority = req.query.priority.toLowerCase();
        }

        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
                SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
                SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
            ]);

            query.$or = [
                { assignedTo: userId },
                { _id: { $in: subTaskTaskIds } }
            ];
            jobTaskQuery.$or = [
                { assignedTo: userId },
                { _id: { $in: subTaskJobTaskIds } }
            ];
        } else if (role === 'FOREMAN') {
            const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
            const workerIds = managedJobs.flatMap(j => j.assignedWorkers || []);
            const allIds = [userId, ...workerIds];
            
            const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
                SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
                SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
            ]);

            query.$or = [
                { assignedTo: { $in: allIds } },
                { _id: { $in: subTaskTaskIds } }
            ];
            jobTaskQuery.$or = [
                { assignedTo: { $in: allIds } },
                { assignedForeman: userId },
                { _id: { $in: subTaskJobTaskIds } }
            ];
        }

        const [tasks, jobTasksData] = await Promise.all([
            Task.find(query)
                .populate('projectId', 'name')
                .populate('assignedTo', 'fullName email role')
                .populate('createdBy', 'fullName')
                .populate('assignedBy', 'fullName')
                .sort({ position: 1, createdAt: -1, dueDate: 1 })
                .lean(),
            JobTask.find(jobTaskQuery)
                .populate({ path: 'jobId', populate: { path: 'projectId', select: 'name' } })
                .populate('assignedTo', 'fullName email role')
                .populate('createdBy', 'fullName')
                .sort({ createdAt: -1, dueDate: 1 })
                .lean()
        ]);

        const mappedJobTasks = jobTasksData.map(jt => ({
            ...jt,
            _id: jt._id,
            projectId: jt.jobId?.projectId,
            jobName: jt.jobId?.name,
            assignedTo: jt.assignedTo ? [jt.assignedTo] : [],
            status: jt.status === 'pending' ? 'todo' : jt.status,
            priority: jt.priority ? (jt.priority.charAt(0).toUpperCase() + jt.priority.slice(1)) : 'Medium',
            category: 'TASK',
            isJobTask: true
        }));

        const allTasks = [...tasks, ...mappedJobTasks].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        res.json(allTasks);
    } catch (error) {
        next(error);
    }
};

// @desc    Get tasks assigned to the logged-in user
// @route   GET /api/tasks/my-tasks
// @access  Private
const getMyTasks = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const companyId = req.user.companyId;

        const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
            SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
            SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
        ]);

        const query = {
            companyId,
            $or: [
                { assignedTo: userId },
                { _id: { $in: subTaskTaskIds } }
            ]
        };
        const jobTaskQuery = {
            companyId,
            $or: [
                { assignedTo: userId },
                { _id: { $in: subTaskJobTaskIds } }
            ]
        };

        if (req.query.status) {
            query.status = req.query.status;
            const statusMap = { todo: 'pending', in_progress: 'in_progress', completed: 'completed' };
            if (statusMap[req.query.status]) jobTaskQuery.status = statusMap[req.query.status];
        }

        const [tasks, jobTasksData] = await Promise.all([
            Task.find(query)
                .populate('projectId', 'name')
                .populate('assignedBy', 'fullName role')
                .populate('createdBy', 'fullName')
                .sort({ position: 1, createdAt: -1, dueDate: 1 })
                .lean(),
            JobTask.find(jobTaskQuery)
                .populate({ path: 'jobId', populate: { path: 'projectId', select: 'name' } })
                .populate('assignedTo', 'fullName email role')
                .sort({ createdAt: -1, dueDate: 1 })
                .lean()
        ]);

        const mappedJobTasks = jobTasksData.map(jt => ({
            ...jt,
            _id: jt._id,
            projectId: jt.jobId?.projectId,
            jobName: jt.jobId?.name,
            assignedTo: jt.assignedTo ? [jt.assignedTo] : [],
            status: jt.status === 'pending' ? 'todo' : jt.status,
            priority: jt.priority ? (jt.priority.charAt(0).toUpperCase() + jt.priority.slice(1)) : 'Medium',
            category: 'TASK',
            isJobTask: true
        }));

        const allTasks = [...tasks, ...mappedJobTasks].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        res.json(allTasks);
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
            .sort({ position: 1, createdAt: -1, dueDate: 1 })
            .lean();

        // Also fetch all sub-tasks for these tasks to show them in the flat list
        const taskIds = tasks.map(t => t._id);
        const subTasks = await SubTask.find({ taskId: { $in: taskIds }, companyId })
            .populate('assignedTo', 'fullName email role')
            .populate('createdBy', 'fullName')
            .lean();

        // Mapped sub-tasks to match Task structure for UI consistency
        const mappedSubTasks = subTasks.map(st => ({
            ...st,
            isSubTask: true,
            assignedTo: st.assignedTo ? [st.assignedTo] : [],
            // Use parent task's priority if not set? (No, SubTask has its own priority)
        }));

        const allTasks = [...tasks, ...mappedSubTasks].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        res.json(allTasks);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new task
// @route   POST /api/tasks
// @access  Private (Admin, PM, Foreman)
const createTask = async (req, res, next) => {
    try {
        const { title, description, projectId, assignedTo, assignedRoleType, priority, status, dueDate, startDate, subTasksList, category } = req.body;

        if (!projectId) {
            res.status(400);
            throw new Error('projectId is required');
        }

        const assignedToArr = (assignedTo
            ? (Array.isArray(assignedTo) ? assignedTo : [assignedTo]).filter(Boolean)
            : []).map(id => id.toString());

        // Default to self if it's a TODO and no one is assigned
        if (category === 'TODO' && assignedToArr.length === 0) {
            assignedToArr.push(req.user._id.toString());
        }

        // --- Role Hierarchy & Permission Validation ---
        // Workers/Subcontractors can ONLY assign to themselves
        if (['WORKER', 'SUBCONTRACTOR'].includes(req.user.role)) {
            if (assignedToArr.length > 1 || (assignedToArr.length === 1 && assignedToArr[0] !== req.user._id.toString())) {
                return res.status(403).json({ message: 'Workers can only create personal tasks assigned to themselves.' });
            }
        } else {
            // Check role hierarchy for management roles
            const hierarchyError = await validateAssignmentHierarchy(req.user.role, assignedToArr);
            if (hierarchyError) {
                return res.status(403).json({ message: hierarchyError });
            }
        }

        const task = await Task.create({
            companyId: req.user.companyId,
            projectId,
            title,
            category: category || 'TASK',
            description: description || '',
            assignedTo: assignedToArr,
            assignedRoleType: assignedRoleType || '',
            assignedBy: req.user._id,
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

        // Generate auto steps if passed via subTasksList (Task Template feature)
        if (subTasksList && Array.isArray(subTasksList) && subTasksList.length > 0) {
            const totalCreated = await createSubTasksRecursive(task._id, 'Task', subTasksList, req.user.companyId, req.user._id, null, assignedToArr[0], startDate, dueDate);
            task.subTaskCount = totalCreated;
            await task.save();
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

        const oldStartDate = task.startDate;
        const oldDueDate = task.dueDate;

        Object.assign(task, req.body);
        // Re-resolve assignedTo as array
        if (req.body.assignedTo && !Array.isArray(req.body.assignedTo)) {
            task.assignedTo = [req.body.assignedTo].filter(Boolean);
        }

        await task.save();

        // Auto-shift logic
        if ((req.body.startDate && String(oldStartDate) !== String(task.startDate)) || 
            (req.body.dueDate && String(oldDueDate) !== String(task.dueDate))) {
            
            const shiftDependencies = async (currentTaskId, newStartDate, newDueDate) => {
                if (!newStartDate || !newDueDate) return;
                
                const deps = await Task.find({ dependencies: currentTaskId, companyId: req.user.companyId });
                for (const dep of deps) {
                    if (!dep.startDate || !dep.dueDate) continue;
                    
                    const depDuration = new Date(dep.dueDate) - new Date(dep.startDate);
                    
                    const shiftedStart = new Date(newDueDate);
                    shiftedStart.setDate(shiftedStart.getDate() + 1);
                    
                    const shiftedDue = new Date(shiftedStart.getTime() + depDuration);
                    
                    dep.startDate = shiftedStart;
                    dep.dueDate = shiftedDue;
                    
                    await dep.save();
                    await shiftDependencies(dep._id, dep.startDate, dep.dueDate);
                }
            };
            
            await shiftDependencies(task._id, task.startDate, task.dueDate);
        }

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

// @desc    Reorder tasks
// @route   PATCH /api/tasks/reorder
// @access  Private
const reorderTasks = async (req, res, next) => {
    try {
        const { tasks } = req.body; // Array of { id, status, position, isJobTask }
        console.log('REORDER_TASKS: Received', tasks ? tasks.length : 0, 'tasks for reordering');

        if (!Array.isArray(tasks)) {
            res.status(400);
            throw new Error('Invalid format: Expected an array of tasks.');
        }

        const taskBulkOps = tasks
            .filter(t => !t.isJobTask)
            .map((task, index) => ({
                updateOne: {
                    filter: { _id: task.id, companyId: req.user.companyId },
                    update: { status: task.status, position: task.position !== undefined ? task.position : index }
                }
            }));

        const jobTaskBulkOps = tasks
            .filter(t => t.isJobTask)
            .map((task, index) => ({
                updateOne: {
                    filter: { _id: task.id, companyId: req.user.companyId },
                    update: { 
                        status: task.status === 'todo' ? 'pending' : task.status, 
                        position: task.position !== undefined ? task.position : index 
                    }
                }
            }));

        const subTaskBulkOps = tasks
            .filter(t => t.isSubTask)
            .map((task, index) => ({
                updateOne: {
                    filter: { _id: task.id, companyId: req.user.companyId },
                    update: { status: task.status, position: task.position !== undefined ? task.position : index }
                }
            }));

        if (taskBulkOps.length > 0) {
            const result = await Task.bulkWrite(taskBulkOps);
            console.log('REORDER_TASKS: Task model bulkWrite updatedCount:', result.modifiedCount);
        }

        if (jobTaskBulkOps.length > 0) {
            const JobTask = require('../models/JobTask');
            const result = await JobTask.bulkWrite(jobTaskBulkOps);
            console.log('REORDER_TASKS: JobTask model bulkWrite updatedCount:', result.modifiedCount);
        }

        if (subTaskBulkOps.length > 0) {
            const SubTask = require('../models/SubTask');
            const result = await SubTask.bulkWrite(subTaskBulkOps);
            console.log('REORDER_TASKS: SubTask model bulkWrite updatedCount:', result.modifiedCount);
        }

        res.json({ message: 'Tasks reordered successfully' });
    } catch (error) {
        console.error('REORDER_TASKS: Error during reorder:', error);
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
        const { title, assignedTo, dueDate, startDate, remarks, priority, parentSubTaskId } = req.body;

        let parentTask = await Task.findById(req.params.id);
        let modelType = 'Task';
        if (!parentTask) {
            const JobTask = require('../models/JobTask');
            parentTask = await JobTask.findById(req.params.id);
            modelType = 'JobTask';
        }

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
            onModel: modelType,
            parentSubTaskId: parentSubTaskId || null,
            companyId: req.user.companyId,
            title,
            assignedTo: assignedTo || null,
            startDate: startDate || undefined,
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
        const isJobTask = subTask.onModel === 'JobTask';
        
        if (progress === 100 && allSubTasks.length > 0) {
            updateData.status = isJobTask ? 'completed' : 'completed';
        }

        if (isJobTask) {
            const JobTask = require('../models/JobTask');
            await JobTask.findByIdAndUpdate(req.params.id, { 
                status: updateData.status || (progress > 0 ? 'in_progress' : 'pending')
            });
        } else {
            await Task.findByIdAndUpdate(req.params.id, updateData);
        }

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

        if (subTask.onModel === 'JobTask') {
            const JobTask = require('../models/JobTask');
            await JobTask.findByIdAndUpdate(req.params.id, {
                status: progress === 100 ? 'completed' : (progress > 0 ? 'in_progress' : 'pending')
            });
        } else {
            await Task.findByIdAndUpdate(req.params.id, {
                $set: { progress, subTaskCount: topLevelSubTasks.length }
            });
        }

        res.json({ message: 'Sub-task deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// @desc    Get schedule data
// @route   GET /api/tasks/schedule
// @access  Private
const getSchedule = async (req, res, next) => {
    try {
        const { role, _id: userId, companyId } = req.user;
        const query = { companyId };
        const jobTaskQuery = { companyId };

        if (req.query.projectId) {
            query.projectId = req.query.projectId;
            const projectJobs = await Job.find({ projectId: req.query.projectId }).distinct('_id');
            jobTaskQuery.jobId = { $in: projectJobs };
        }
        
        if (req.query.status) {
            query.status = req.query.status;
            const statusMap = { todo: 'pending', in_progress: 'in_progress', completed: 'completed' };
            if (statusMap[req.query.status]) jobTaskQuery.status = statusMap[req.query.status];
        }
        
        if (req.query.priority) {
            query.priority = req.query.priority;
            jobTaskQuery.priority = req.query.priority.toLowerCase();
        }
        
        if (req.query.category) query.category = req.query.category;

        // Role-based visibility
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
                SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
                SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
            ]);

            query.$or = [
                { assignedTo: userId },
                { _id: { $in: subTaskTaskIds } }
            ];
            jobTaskQuery.$or = [
                { assignedTo: userId },
                { _id: { $in: subTaskJobTaskIds } }
            ];
        } else if (role === 'FOREMAN') {
            const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
            const workerIds = managedJobs.flatMap(j => j.assignedWorkers || []);
            const allIds = [userId, ...workerIds];
            
            const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
                SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
                SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
            ]);

            query.$or = [
                { assignedTo: { $in: allIds } },
                { _id: { $in: subTaskTaskIds } }
            ];
            jobTaskQuery.$or = [
                { assignedTo: { $in: allIds } },
                { assignedForeman: userId },
                { _id: { $in: subTaskJobTaskIds } }
            ];
        }

        const [tasks, jobTasksData, subTasks] = await Promise.all([
            Task.find(query)
                .select('_id title startDate dueDate status priority assignedTo dependencies position createdAt projectId')
                .populate('assignedTo', 'fullName')
                .populate('projectId', 'name')
                .sort({ position: 1, dueDate: 1, createdAt: -1 })
                .lean(),
            JobTask.find(jobTaskQuery)
                .populate({ path: 'jobId', populate: { path: 'projectId', select: 'name' } })
                .populate('assignedTo', 'fullName')
                .sort({ dueDate: 1, createdAt: -1 })
                .lean(),
            SubTask.find({ companyId })
                .populate('assignedTo', 'fullName role')
                .lean() // Efficient fetch with populated assignees 
        ]);

        const formatted = tasks.map(t => ({
            id: t._id,
            title: t.title,
            startDate: t.startDate,
            endDate: t.dueDate,
            dueDate: t.dueDate,
            status: t.status,
            priority: t.priority,
            assignedTo: t.assignedTo,
            projectId: t.projectId,
            position: t.position,
            createdAt: t.createdAt,
            dependencies: t.dependencies || [],
            subTasks: subTasks.filter(st => st.taskId?.toString() === t._id.toString())
        }));

        const jobFormatted = jobTasksData.map(jt => ({
            id: jt._id,
            title: jt.title,
            startDate: jt.startDate || jt.createdAt, // Use explicit startDate if set, else fallback to createdAt
            endDate: jt.dueDate,
            dueDate: jt.dueDate,
            status: jt.status === 'pending' ? 'todo' : jt.status,
            priority: jt.priority ? (jt.priority.charAt(0).toUpperCase() + jt.priority.slice(1)) : 'Medium',
            assignedTo: jt.assignedTo ? [jt.assignedTo] : [],
            projectId: jt.jobId?.projectId,
            jobName: jt.jobId?.name,
            dependencies: [],
            subTasks: [],
            isJobTask: true
        }));

        const allTasks = [...formatted, ...jobFormatted].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            return new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate);
        });

        res.json(allTasks);
    } catch (error) {
        next(error);
    }
};

// @desc    Add dependency
// @route   POST /api/tasks/:id/dependency
// @access  Private
const addDependency = async (req, res, next) => {
    try {
        const { dependsOnTaskId } = req.body;
        
        if (!dependsOnTaskId) {
            res.status(400);
            throw new Error('dependsOnTaskId is required');
        }
        
        if (dependsOnTaskId === req.params.id) {
            res.status(400);
            throw new Error('A task cannot depend on itself');
        }

        const depTask = await Task.findById(dependsOnTaskId);
        if (!depTask) {
            res.status(404);
            throw new Error('Dependency task not found');
        }

        const checkCircular = async (taskId, targetId) => {
            if (taskId.toString() === targetId.toString()) return true;
            const t = await Task.findById(taskId);
            if (!t) return false;
            for (const dId of (t.dependencies || [])) {
                if (await checkCircular(dId, targetId)) return true;
            }
            return false;
        };
        
        if (await checkCircular(dependsOnTaskId, req.params.id)) {
            res.status(400);
            throw new Error('Circular dependency detected');
        }

        const task = await Task.findOneAndUpdate(
            { _id: req.params.id, companyId: req.user.companyId },
            { $addToSet: { dependencies: dependsOnTaskId } },
            { new: true }
        );

        if (!task) {
            res.status(404);
            throw new Error('Task not found');
        }

        res.json(task);
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
    reorderTasks,
    getSubTasks,
    createSubTask,
    updateSubTask,
    deleteSubTask,
    getSchedule,
    addDependency
};

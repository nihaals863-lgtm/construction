const mongoose = require('mongoose');
const Task = require('../models/Task');
const SubTask = require('../models/SubTask');
const Job = require('../models/Job');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const JobTask = require('../models/JobTask');
const Todo = require('../models/Todo');
const { dispatchNotification } = require('../utils/notificationHelper');

// Helper to normalize dates to UTC midnight to avoid timezone shifts
const normalizeDateToUTC = (date) => {
    if (!date) return date;
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

// Helper: Validate if assigner can assign to given assignees based on role hierarchy
const validateAssignmentHierarchy = async (assignerRole, assigneeIds) => {
    if (!assigneeIds || assigneeIds.length === 0) return null; // No assignees is fine
    const assignees = await User.find({ _id: { $in: assigneeIds } }).select('role fullName');
    for (const assignee of assignees) {
        // PM can assign to anyone (Foreman, Subcontractor, Worker)

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

const buildPathFromParent = (parentPath, taskId) => {
    const base = parentPath && parentPath.trim() ? parentPath : '';
    return `${base}/${taskId}`.replace(/\/+/g, '/');
};

const refreshTaskSubtree = async ({ rootTaskId, companyId, session = null }) => {
    const root = await Task.findOne({ _id: rootTaskId, companyId }).session(session);
    if (!root) return;

    const queue = [root];
    while (queue.length > 0) {
        const current = queue.shift();
        const children = await Task.find({ parentTaskId: current._id, companyId }).session(session);
        for (const child of children) {
            child.level = Number(current.level || 0) + 1;
            child.path = buildPathFromParent(current.path, child._id.toString());
            await child.save(session ? { session } : {});
            queue.push(child);
        }
    }
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

        if (req.query.excludeCompleted === 'true') {
            query.status = { $nin: ['completed', 'cancelled'] };
            jobTaskQuery.status = { $nin: ['completed', 'cancelled'] };
        }

        // Global Search Support
        const searchCondition = req.query.q ? {
            $or: [
                { title: new RegExp(req.query.q, 'i') },
                { description: new RegExp(req.query.q, 'i') }
            ]
        } : null;

        let workerSubTasks = [];
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            // Workers/Subcontractors see tasks if directly assigned OR created by them
            const userFilter = { $or: [ { assignedTo: userId }, { createdBy: userId } ] };
            query.$and = [ userFilter ];
            jobTaskQuery.$and = [ userFilter ];

            // Also fetch sub-tasks specifically assigned to them OR created by them
            const subTaskFilter = { 
                companyId,
                $or: [ { assignedTo: userId }, { createdBy: userId } ]
            };
            if (req.query.status) subTaskFilter.status = req.query.status;
            if (req.query.priority) subTaskFilter.priority = req.query.priority;
            if (req.query.excludeCompleted === 'true') {
                subTaskFilter.status = { $nin: ['completed', 'cancelled'] };
            }
            if (req.query.q) {
                const searchRegex = new RegExp(req.query.q, 'i');
                subTaskFilter.$and = [ { $or: [ { title: searchRegex }, { remarks: searchRegex } ] } ];
            }

            workerSubTasks = await SubTask.find(subTaskFilter)
                .populate('taskId')
                .populate('assignedTo', 'fullName role')
                .populate('createdBy', 'fullName')
                .lean();

            const tasksToPopulate = workerSubTasks.filter(st => st.onModel === 'Task' && st.taskId).map(st => st.taskId);
            const jobTasksToPopulate = workerSubTasks.filter(st => st.onModel === 'JobTask' && st.taskId).map(st => st.taskId);

            if (tasksToPopulate.length > 0) {
                await Task.populate(tasksToPopulate, { path: 'projectId', select: 'name' });
            }
            if (jobTasksToPopulate.length > 0) {
                const JobTask = require('../models/JobTask');
                await JobTask.populate(jobTasksToPopulate, { path: 'jobId', populate: { path: 'projectId', select: 'name' } });
            }

            // Filter sub-tasks by projectId if requested
            if (req.query.projectId) {
                workerSubTasks = workerSubTasks.filter(st => {
                    const pid = st.taskId?.projectId?._id || st.taskId?.jobId?.projectId?._id;
                    return pid && pid.toString() === req.query.projectId;
                });
            }
        } else if (role === 'FOREMAN') {
            const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
            const workerIds = managedJobs.flatMap(j => j.assignedWorkers || []);
            const allIds = [userId, ...workerIds];
            
            const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
                SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
                SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
            ]);

            query.$and = [{
                $or: [
                    { assignedTo: { $in: allIds } },
                    { _id: { $in: subTaskTaskIds } }
                ]
            }];
            jobTaskQuery.$and = [{
                $or: [
                    { assignedTo: { $in: allIds } },
                    { assignedForeman: userId },
                    { _id: { $in: subTaskJobTaskIds } }
                ]
            }];
        } else if (req.query.q) {
            // For Admin/PM search inclusion
            const searchRegex = new RegExp(req.query.q, 'i');
            const subTaskSearchFilter = {
                companyId,
                $or: [ { title: searchRegex }, { remarks: searchRegex } ]
            };

            const matchingSubTasks = await SubTask.find(subTaskSearchFilter)
                .populate('taskId')
                .populate('assignedTo', 'fullName role')
                .populate('createdBy', 'fullName')
                .lean();

            let filteredMatching = matchingSubTasks;
            if (req.query.projectId) {
                const tasksToPopulate = filteredMatching.filter(st => st.onModel === 'Task' && st.taskId).map(st => st.taskId);
                const jobTasksToPopulate = filteredMatching.filter(st => st.onModel === 'JobTask' && st.taskId).map(st => st.taskId);
                if (tasksToPopulate.length > 0) await Task.populate(tasksToPopulate, { path: 'projectId' });
                if (jobTasksToPopulate.length > 0) {
                     const JobTask = require('../models/JobTask');
                     await JobTask.populate(jobTasksToPopulate, { path: 'jobId', populate: { path: 'projectId' } });
                }
                
                filteredMatching = filteredMatching.filter(st => {
                    const pid = st.taskId?.projectId?._id || st.taskId?.jobId?.projectId?._id || st.taskId?.projectId || st.taskId?.jobId?.projectId;
                    return pid && pid.toString() === req.query.projectId;
                });
            }
            workerSubTasks = filteredMatching;
        }

        // Apply searchCondition at the end using $and
        if (searchCondition) {
            if (!query.$and) query.$and = [];
            query.$and.push(searchCondition);
            if (!jobTaskQuery.$and) jobTaskQuery.$and = [];
            jobTaskQuery.$and.push(searchCondition);
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

        const mappedSubTasks = workerSubTasks.map(st => ({
            ...st,
            projectId: st.taskId?.projectId || st.taskId?.jobId?.projectId,
            jobName: st.taskId?.jobId?.name,
            parentTaskTitle: st.taskId?.title,
            assignedTo: st.assignedTo ? [st.assignedTo] : [],
            isSubTask: true,
            category: 'TASK'
        }));

        const allTasks = [...tasks, ...mappedJobTasks, ...mappedSubTasks].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            return new Date(b.createdAt || b.createdAt) - new Date(a.createdAt || a.createdAt);
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
        const role = req.user.role;

        const query = { companyId };
        const jobTaskQuery = { companyId };

        let workerSubTasks = [];
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            const userFilter = { $or: [ { assignedTo: userId }, { createdBy: userId } ] };
            query.$and = [ userFilter ];
            jobTaskQuery.$and = [ userFilter ];

            const subTaskFilter = { 
                companyId,
                $or: [ { assignedTo: userId }, { createdBy: userId } ]
            };
            if (req.query.status) subTaskFilter.status = req.query.status;
            if (req.query.excludeCompleted === 'true') {
                subTaskFilter.status = { $nin: ['completed', 'cancelled'] };
            }

            workerSubTasks = await SubTask.find(subTaskFilter)
                .populate('taskId')
                .populate('assignedTo', 'fullName role')
                .populate('createdBy', 'fullName')
                .lean();

            const tasksToPopulate = workerSubTasks.filter(st => st.onModel === 'Task' && st.taskId).map(st => st.taskId);
            const jobTasksToPopulate = workerSubTasks.filter(st => st.onModel === 'JobTask' && st.taskId).map(st => st.taskId);

            if (tasksToPopulate.length > 0) {
                await Task.populate(tasksToPopulate, { path: 'projectId', select: 'name' });
            }
            if (jobTasksToPopulate.length > 0) {
                const JobTask = require('../models/JobTask');
                await JobTask.populate(jobTasksToPopulate, { path: 'jobId', populate: { path: 'projectId', select: 'name' } });
            }
        } else {
            const [subTaskTaskIds, subTaskJobTaskIds] = await Promise.all([
                SubTask.find({ assignedTo: userId, companyId, onModel: 'Task' }).distinct('taskId'),
                SubTask.find({ assignedTo: userId, companyId, onModel: 'JobTask' }).distinct('taskId')
            ]);

            const userFilter = {
                $or: [
                    { assignedTo: userId },
                    { _id: { $in: subTaskTaskIds } }
                ]
            };
            const jobUserFilter = {
                $or: [
                    { assignedTo: userId },
                    { _id: { $in: subTaskJobTaskIds } }
                ]
            };

            query.$and = [ userFilter ];
            jobTaskQuery.$and = [ jobUserFilter ];
        }

        if (req.query.status) {
            query.status = req.query.status;
            const statusMap = { todo: 'pending', in_progress: 'in_progress', completed: 'completed' };
            if (statusMap[req.query.status]) jobTaskQuery.status = statusMap[req.query.status];
        }

        if (req.query.excludeCompleted === 'true') {
            query.status = { $nin: ['completed', 'cancelled'] };
            jobTaskQuery.status = { $nin: ['completed', 'cancelled'] };
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

        const mappedSubTasks = workerSubTasks.map(st => ({
            ...st,
            projectId: st.taskId?.projectId || st.taskId?.jobId?.projectId,
            jobName: st.taskId?.jobId?.name,
            assignedTo: st.assignedTo ? [st.assignedTo] : [],
            isSubTask: true,
            category: 'TASK'
        }));

        const allTasks = [...tasks, ...mappedJobTasks, ...mappedSubTasks].sort((a, b) => {
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
        const jobTaskQuery = { companyId };
        
        // Find all jobs for this project to fetch their JobTasks
        const projectJobs = await Job.find({ projectId, companyId }).distinct('_id');
        jobTaskQuery.jobId = { $in: projectJobs };

        // Workers/Subcontractors see tasks assigned to them OR created by them
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            const userFilter = { $or: [{ assignedTo: userId }, { createdBy: userId }] };
            query.$and = [userFilter];
            jobTaskQuery.$and = [userFilter];
        } else if (role === 'FOREMAN') {
            const managedJobs = await Job.find({ foremanId: userId, companyId }).select('assignedWorkers');
            const workerIds = managedJobs.flatMap(j => j.assignedWorkers || []);
            const allIds = [userId, ...workerIds];
            
            const subTaskTaskIds = await SubTask.find({ assignedTo: userId, companyId }).distinct('taskId');

            query.$and = [{
                $or: [
                    { assignedTo: { $in: allIds } },
                    { _id: { $in: subTaskTaskIds } }
                ]
            }];
            jobTaskQuery.$and = [{
                $or: [
                    { assignedTo: { $in: allIds } },
                    { assignedForeman: userId }
                ]
            }];
        }

        const [tasks, jobTasks, allSubTasks] = await Promise.all([
            Task.find(query)
                .select('-statusHistory')
                .populate('projectId', 'name')
                .populate('assignedTo', 'fullName role')
                .populate('assignedBy', 'fullName role')
                .populate('createdBy', 'fullName')
                .sort({ position: 1, createdAt: -1 }),
            JobTask.find(jobTaskQuery)
                .populate({ path: 'jobId', populate: { path: 'projectId', select: 'name' } })
                .populate('assignedTo', 'fullName email role')
                .populate('createdBy', 'fullName')
                .sort({ createdAt: -1 }),
            SubTask.find({ companyId }) // We'll filter these by their parent taskId/jobTaskId in the next step
                .populate('assignedTo', 'fullName email role')
                .populate('createdBy', 'fullName')
                .lean()
        ]);

        // Map JobTasks to match Task structure
        const mappedJobTasks = jobTasks.map(jt => ({
            ...jt.toObject ? jt.toObject() : jt,
            projectId: jt.jobId?.projectId,
            jobName: jt.jobId?.name,
            assignedTo: jt.assignedTo ? [jt.assignedTo] : [],
            status: jt.status === 'pending' ? 'todo' : jt.status,
            priority: jt.priority ? (jt.priority.charAt(0).toUpperCase() + jt.priority.slice(1)) : 'Medium',
            category: 'TASK',
            isJobTask: true
        }));

        // Filter subtasks that belong to any of the fetched tasks or jobTasks
        const allMainTaskIds = [...tasks.map(t => t._id.toString()), ...mappedJobTasks.map(jt => jt._id.toString())];
        const finalSubTasks = allSubTasks.filter(st => {
            const tId = st.taskId?._id?.toString() || st.taskId?.toString();
            return allMainTaskIds.includes(tId);
        }).map(st => ({
            ...st,
            isSubTask: true,
            assignedTo: st.assignedTo ? [st.assignedTo] : []
        }));

        const allTasks = [...tasks, ...mappedJobTasks, ...finalSubTasks].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            return new Date(b.createdAt || b.createdAt) - new Date(a.createdAt || a.createdAt);
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
        const { title, description, projectId, assignedTo, assignedRoleType, priority, status, dueDate, startDate, subTasksList, category, parentTaskId, isChild } = req.body;

        let finalProjectId = projectId;
        let parentTask = null;
        let level = 0;
        let path = '';
        const normalizedParentTaskId = parentTaskId ? String(parentTaskId).trim() : '';

        if (isChild && !normalizedParentTaskId) {
            return res.status(400).json({ message: 'Child task requires a valid parentTaskId.' });
        }

        if (normalizedParentTaskId) {
            parentTask = await Task.findOne({ _id: normalizedParentTaskId, companyId: req.user.companyId });
            if (!parentTask) {
                return res.status(404).json({ message: 'Parent task not found' });
            }
            finalProjectId = parentTask.projectId;
            level = Number(parentTask.level || 0) + 1;
            path = parentTask.path || '';
        }

        if (!finalProjectId) {
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
            projectId: finalProjectId,
            parentTaskId: normalizedParentTaskId || null,
            level,
            path,
            title,
            category: category || 'TASK',
            description: description || '',
            assignedTo: assignedToArr,
            assignedRoleType: assignedRoleType || '',
            assignedBy: req.user._id,
            priority: priority || 'Medium',
            status: status || 'todo',
            dueDate: normalizeDateToUTC(dueDate) || undefined,
            startDate: normalizeDateToUTC(startDate) || undefined,
            createdBy: req.user._id,
            statusHistory: [{ status: status || 'todo', changedBy: req.user._id }]
        });

        task.path = buildPathFromParent(path, task._id.toString());
        await task.save();

        // Notify each assigned user
        for (const uid of assignedToArr) {
            await dispatchNotification(req, {
                userId: uid,
                title: 'New Task Assigned',
                message: `You have been assigned: "${title}" by ${req.user.fullName}`,
                link: '/company-admin/tasks',
                type: 'task'
            });
        }

        // Audit log
        await AuditLog.create({
            userId: req.user._id,
            action: 'TASK_CREATED',
            module: 'TASKS',
            details: `Created task "${title}"`,
            metadata: { taskId: task._id, projectId: finalProjectId, assignedTo: assignedToArr }
        });

        // Sync Chat Participants
        try {
            const { syncProjectParticipants } = require('./chatController');
            await syncProjectParticipants(finalProjectId);
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
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: 'Validation Failed', errors: messages });
        }
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
                link: '/company-admin/tasks',
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

// @desc    Update task status/details (Polymorphic: handles Task, JobTask, SubTask, Todo)
// @route   PATCH /api/tasks/:id
// @access  Private
const updateTask = async (req, res, next) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;
        const Todo = require('../models/Todo');

        console.log(`[updateTask] Received update for ${id} in company ${companyId}`);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid task ID format' });
        }

        // --- POLY-LOOKUP SEQUENCE ---
        // We use findOne with companyId for strict multi-tenancy security
        let task = await Task.findOne({ _id: id, companyId });
        let modelType = 'Task';

        if (!task) {
            task = await JobTask.findOne({ _id: id, companyId });
            modelType = 'JobTask';
        }

        if (!task) {
            task = await SubTask.findOne({ _id: id, companyId });
            modelType = 'SubTask';
        }

        if (!task) {
            task = await Todo.findOne({ _id: id, companyId });
            modelType = 'Todo';
        }

        if (!task) {
            console.warn(`[updateTask] Resource NOT FOUND in any collection for ID: ${id}`);
            return res.status(404).json({ message: 'Task, SubTask or Todo not found' });
        }

        console.log(`[updateTask] Found ${modelType} for update: ${task.title || 'Untitled'}`);

        const { role, _id: userId } = req.user;
        const isAdmin = ['SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'ADMIN'].includes(role);
        
        // Authorization Logic
        let isAssigned = false;
        if (modelType === 'Task') {
            isAssigned = Array.isArray(task.assignedTo) && task.assignedTo.some(uid => uid.toString() === userId.toString());
        } else if (modelType === 'SubTask') {
            isAssigned = task.assignedTo?.toString() === userId.toString();
        } else if (modelType === 'JobTask') {
            isAssigned = task.assignedTo?.toString() === userId.toString();
        } else if (modelType === 'Todo') {
            isAssigned = task.userId?.toString() === userId.toString();
        }

        if (['WORKER', 'SUBCONTRACTOR'].includes(role) && !isAssigned && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized to update this resource' });
        }

        // --- Model Specific Normalization ---
        if (modelType === 'JobTask') {
            if (req.body.status === 'todo') req.body.status = 'pending';
            if (req.body.priority) req.body.priority = req.body.priority.toLowerCase();
        } else if (modelType === 'Task' || modelType === 'SubTask') {
            if (req.body.status === 'pending') req.body.status = 'todo';
            if (req.body.priority) {
                req.body.priority = req.body.priority.charAt(0).toUpperCase() + req.body.priority.slice(1).toLowerCase();
            }
        }

        const oldStatus = task.status;
        const oldStartDate = task.startDate;
        const oldDueDate = task.dueDate;
        const oldParentTaskId = String(task.parentTaskId || '');

        const updates = { ...req.body };
        if (updates.startDate) updates.startDate = normalizeDateToUTC(updates.startDate);
        if (updates.dueDate) updates.dueDate = normalizeDateToUTC(updates.dueDate);
        if (updates.assignedTo === "") updates.assignedTo = [];

        Object.assign(task, updates);
        let hierarchyMoved = false;

        if (modelType === 'Task' && updates.parentTaskId !== undefined && String(updates.parentTaskId || '') !== oldParentTaskId) {
            if (updates.parentTaskId && String(updates.parentTaskId) === String(task._id)) {
                return res.status(400).json({ message: 'Task cannot be its own parent' });
            }
            if (updates.parentTaskId) {
                const nextParent = await Task.findOne({ _id: updates.parentTaskId, companyId });
                if (!nextParent) {
                    return res.status(404).json({ message: 'New parent task not found' });
                }
                if (nextParent.path && nextParent.path.includes(`/${task._id.toString()}`)) {
                    return res.status(400).json({ message: 'Cannot move task under one of its descendants' });
                }
                task.parentTaskId = nextParent._id;
                task.projectId = nextParent.projectId;
                task.level = Number(nextParent.level || 0) + 1;
                task.path = buildPathFromParent(nextParent.path, task._id.toString());
            } else {
                task.parentTaskId = null;
                task.level = 0;
                task.path = buildPathFromParent('', task._id.toString());
            }
            hierarchyMoved = true;
        }
        // Re-resolve assignedTo as array
        if (updates.assignedTo && !Array.isArray(updates.assignedTo)) {
            task.assignedTo = [updates.assignedTo].filter(Boolean);
        }

        await task.save();

        if (modelType === 'Task' && hierarchyMoved) {
            await refreshTaskSubtree({ rootTaskId: task._id, companyId });
        }

        // --- Post-Update Logic ---
        if (modelType === 'JobTask') {
            const { updateJobProgress } = require('./jobTaskController');
            await updateJobProgress(task.jobId);
        } else if (modelType === 'SubTask') {
            // Recalculate parent progress if subtask status changed
            if (req.body.status && req.body.status !== oldStatus) {
                if (task.parentSubTaskId) await recalcSubTaskProgress(task.parentSubTaskId);
                
                // Also update main task/jobtask if applicable
                const { taskId, onModel } = task;
                if (taskId) {
                    const children = await SubTask.find({ taskId, companyId });
                    const completed = children.filter(c => c.status === 'completed').length;
                    const progress = Math.round((completed / children.length) * 100);
                    const ParentModel = onModel === 'JobTask' ? JobTask : Task;
                    await ParentModel.findByIdAndUpdate(taskId, { progress });
                    if (onModel === 'JobTask') {
                        const jt = await JobTask.findById(taskId);
                        const { updateJobProgress } = require('./jobTaskController');
                        await updateJobProgress(jt.jobId);
                    }
                }
            }
        } else if (modelType === 'Task') {
             // Dependency shift logic
             if ((req.body.startDate && String(oldStartDate) !== String(task.startDate)) || 
                 (req.body.dueDate && String(oldDueDate) !== String(task.dueDate))) {
                 const shiftDependencies = async (currId, newStart, newDue) => {
                     const deps = await Task.find({ dependencies: currId, companyId });
                     for (const dep of deps) {
                         if (!dep.startDate || !dep.dueDate) continue;
                         const dur = new Date(dep.dueDate) - new Date(dep.startDate);
                         const s = new Date(newDue); s.setDate(s.getDate() + 1);
                         const d = new Date(s.getTime() + dur);
                         dep.startDate = s; dep.dueDate = d;
                         await dep.save();
                         await shiftDependencies(dep._id, s, d);
                     }
                 };
                 await shiftDependencies(task._id, task.startDate, task.dueDate);
             }
        }

        // Sync & Notification
        try {
            const { syncProjectParticipants } = require('./chatController');
            let projId = task.projectId;
            if (modelType === 'JobTask') {
                const job = await Job.findById(task.jobId);
                projId = job?.projectId;
            } else if (modelType === 'SubTask' && task.taskId) {
                const parent = task.onModel === 'JobTask' ? await JobTask.findById(task.taskId) : await Task.findById(task.taskId);
                projId = task.onModel === 'JobTask' ? (await Job.findById(parent?.jobId))?.projectId : parent?.projectId;
            }
            if (projId) await syncProjectParticipants(projId);
        } catch (e) {}

        // Populate and Return
        let resData;
        if (modelType === 'Task') {
            resData = await Task.findById(task._id).populate('projectId assignedTo assignedBy createdBy');
        } else if (modelType === 'JobTask') {
            resData = await JobTask.findById(task._id).populate({ path: 'jobId', populate: { path: 'projectId' } }).populate('assignedTo');
            resData = resData.toObject(); resData.isJobTask = true; resData.projectId = resData.jobId?.projectId;
        } else if (modelType === 'SubTask') {
            resData = await SubTask.findById(task._id).populate('assignedTo createdBy');
            resData = resData.toObject(); resData.isSubTask = true;
        } else {
            resData = task;
        }

        res.json(resData);
    } catch (error) {
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: 'Validation Failed', errors: messages });
        }
        console.error('[updateTask] Critical Error:', error);
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

        const action = req.query.action; // cascade | moveUpward
        if (action === 'moveUpward') {
            const children = await Task.find({ parentTaskId: task._id, companyId: req.user.companyId });
            const newParent = task.parentTaskId
                ? await Task.findOne({ _id: task.parentTaskId, companyId: req.user.companyId })
                : null;
            for (const child of children) {
                child.parentTaskId = task.parentTaskId || null;
                child.level = task.parentTaskId ? Number(task.level || 0) : 0;
                child.path = buildPathFromParent(newParent?.path || '', child._id.toString());
                await child.save();
                await refreshTaskSubtree({ rootTaskId: child._id, companyId: req.user.companyId });
            }
            await Task.findByIdAndDelete(req.params.id);
        } else {
            const escaped = String(task.path || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (escaped) {
                await Task.deleteMany({
                    companyId: req.user.companyId,
                    path: { $regex: new RegExp(`^${escaped}(/|$)`) }
                });
            } else {
                await Task.findByIdAndDelete(req.params.id);
            }
        }

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
            startDate: normalizeDateToUTC(startDate) || undefined,
            dueDate: normalizeDateToUTC(dueDate) || undefined,
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

        if (modelType === 'JobTask') {
            const JobTask = require('../models/JobTask');
            await JobTask.findByIdAndUpdate(req.params.id, {
                ...updateData,
                status: (progress === 100 && topLevelSubTasks.length > 0) ? 'completed' : (progress > 0 ? 'in_progress' : 'pending')
            });
        } else {
            if (assignedTo) {
                await Task.findByIdAndUpdate(req.params.id, {
                    $addToSet: { assignedTo: new mongoose.Types.ObjectId(assignedTo) },
                    ...updateData
                });
            } else {
                await Task.findByIdAndUpdate(req.params.id, updateData);
            }
        }

        if (assignedTo) {
            await dispatchNotification(req, {
                userId: assignedTo,
                title: 'New Sub-Task Assigned',
                message: `You were assigned a sub-task: "${title}" in "${parentTask.title}"`,
                link: '/company-admin/tasks',
                type: 'task'
            });
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
        
        // Handle empty strings for ObjectId fields
        if (updates.assignedTo === "") updates.assignedTo = null;
        if (updates.parentSubTaskId === "") updates.parentSubTaskId = null;

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

        // Update parent subtask progress if nested
        if (subTask.parentSubTaskId) {
            await recalcSubTaskProgress(subTask.parentSubTaskId);
        }

        // Recalculate main task progress (consistent with create/delete)
        const topLevelSubTasks = await SubTask.find({ taskId: req.params.id, parentSubTaskId: null });
        const completedCount = topLevelSubTasks.filter(st => st.status === 'completed').length;
        const progress = topLevelSubTasks.length > 0 ? Math.round((completedCount / topLevelSubTasks.length) * 100) : 0;

        const isJobTask = subTask.onModel === 'JobTask';
        
        if (isJobTask) {
            const JobTask = require('../models/JobTask');
            await JobTask.findByIdAndUpdate(req.params.id, { 
                progress,
                status: (progress === 100 && topLevelSubTasks.length > 0) ? 'completed' : (progress > 0 ? 'in_progress' : 'pending')
            });
        } else {
            await Task.findByIdAndUpdate(req.params.id, { 
                progress,
                status: (progress === 100 && topLevelSubTasks.length > 0) ? 'completed' : undefined
            });
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
                progress,
                subTaskCount: topLevelSubTasks.length,
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

        // Global Search Support for Schedule
        if (req.query.q) {
            const searchRegex = new RegExp(req.query.q, 'i');
            
            // Find IDs of tasks that have matching sub-tasks
            const [matchingSubTaskTaskIds, matchingSubTaskJobTaskIds] = await Promise.all([
                SubTask.find({ companyId, onModel: 'Task', $or: [{ title: searchRegex }, { remarks: searchRegex }] }).distinct('taskId'),
                SubTask.find({ companyId, onModel: 'JobTask', $or: [{ title: searchRegex }, { remarks: searchRegex }] }).distinct('taskId')
            ]);

            const searchCondition = {
                $or: [
                    { title: searchRegex },
                    { description: searchRegex },
                    { _id: { $in: matchingSubTaskTaskIds } }
                ]
            };

            const jobTaskSearchCondition = {
                $or: [
                    { title: searchRegex },
                    { description: searchRegex },
                    { _id: { $in: matchingSubTaskJobTaskIds } }
                ]
            };

            if (query.$or) query.$and = [ { $or: query.$or }, searchCondition ];
            else Object.assign(query, searchCondition);

            if (jobTaskQuery.$or) jobTaskQuery.$and = [ { $or: jobTaskQuery.$or }, jobTaskSearchCondition ];
            else Object.assign(jobTaskQuery, jobTaskSearchCondition);
        }

        // Role-based visibility
        let workerSubTasksForSchedule = [];
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            query.assignedTo = userId;
            jobTaskQuery.assignedTo = userId;

            workerSubTasksForSchedule = await SubTask.find({ assignedTo: userId, companyId })
                .populate('taskId')
                .lean();
            
            // Populate taskId fields
            const tasksToPopulate = workerSubTasksForSchedule.filter(st => st.onModel === 'Task' && st.taskId).map(st => st.taskId);
            const jobTasksToPopulate = workerSubTasksForSchedule.filter(st => st.onModel === 'JobTask' && st.taskId).map(st => st.taskId);
            if (tasksToPopulate.length > 0) await Task.populate(tasksToPopulate, { path: 'projectId' });
            if (jobTasksToPopulate.length > 0) {
                const JobTask = require('../models/JobTask');
                await JobTask.populate(jobTasksToPopulate, { path: 'jobId', populate: { path: 'projectId' } });
            }
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
                .select('_id title startDate dueDate status priority assignedTo dependencies position createdAt projectId')
                .populate('assignedTo', 'fullName')
                .populate('projectId', 'name')
                .sort({ position: 1, dueDate: 1, createdAt: -1 })
                .lean(),
            JobTask.find(jobTaskQuery)
                .populate({ path: 'jobId', populate: { path: 'projectId', select: 'name' } })
                .populate('assignedTo', 'fullName')
                .sort({ dueDate: 1, createdAt: -1 })
                .lean()
        ]);

        const allTaskIds = [...tasks.map(t => t._id), ...jobTasksData.map(jt => jt._id)];
        const subTasks = await SubTask.find({ 
            companyId,
            taskId: { $in: allTaskIds }
        }).populate('assignedTo', 'fullName role').lean();

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
            startDate: jt.startDate,
            endDate: jt.dueDate,
            dueDate: jt.dueDate,
            status: jt.status === 'pending' ? 'todo' : jt.status,
            priority: jt.priority ? (jt.priority.charAt(0).toUpperCase() + jt.priority.slice(1)) : 'Medium',
            assignedTo: jt.assignedTo ? [jt.assignedTo] : [],
            projectId: jt.jobId?.projectId,
            jobName: jt.jobId?.name,
            dependencies: [],
            subTasks: subTasks.filter(st => st.taskId?.toString() === jt._id.toString()),
            isJobTask: true
        }));

        const mappedWorkerSubTasks = workerSubTasksForSchedule.map(st => ({
            id: st._id,
            title: st.title,
            startDate: st.startDate,
            endDate: st.dueDate,
            dueDate: st.dueDate,
            status: st.status,
            priority: st.priority,
            assignedTo: st.assignedTo ? [st.assignedTo] : [],
            projectId: st.taskId?.projectId,
            isSubTask: true,
            dependencies: []
        }));

        const allTasks = [...formatted, ...jobFormatted, ...mappedWorkerSubTasks].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            if (posA !== posB) return posA - posB;
            
            const dateA = new Date(a.startDate || a.createdAt);
            const dateB = new Date(b.startDate || b.createdAt);
            return dateB - dateA;
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

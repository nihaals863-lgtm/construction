const TaskTemplate = require('../models/TaskTemplate');
const JobTask = require('../models/JobTask');
const Task = require('../models/Task');
const SubTask = require('../models/SubTask');

const getTemplates = async (req, res, next) => {
    try {
        const templates = await TaskTemplate.find({ companyId: req.user.companyId })
            .populate('createdBy', 'fullName')
            .sort({ position: 1, createdAt: -1 });
        res.json(templates);
    } catch (error) {
        next(error);
    }
};

const createTemplate = async (req, res, next) => {
    try {
        const { templateName, taskTitle, description, assignedRole, estimatedHours, priority, steps } = req.body;
        
        if (!templateName || !taskTitle || !assignedRole) {
            res.status(400);
            throw new Error('Template name, assigned role, and task title are required');
        }

        const template = await TaskTemplate.create({
            companyId: req.user.companyId,
            templateName,
            taskTitle,
            description,
            assignedRole,
            estimatedHours: estimatedHours || 0,
            priority: priority || 'Medium',
            steps: steps || [],
            createdBy: req.user._id
        });

        res.status(201).json(template);
    } catch (error) {
        next(error);
    }
};

const deleteTemplate = async (req, res, next) => {
    try {
        const template = await TaskTemplate.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!template) {
            res.status(404);
            throw new Error('Template not found');
        }
        await TaskTemplate.findByIdAndDelete(req.params.id);
        res.json({ message: 'Template deleted' });
    } catch (error) {
        next(error);
    }
};

const updateTemplate = async (req, res, next) => {
    try {
        const { templateName, taskTitle, description, assignedRole, estimatedHours, priority, steps } = req.body;
        const template = await TaskTemplate.findOne({ _id: req.params.id, companyId: req.user.companyId });
        
        if (!template) {
            res.status(404);
            throw new Error('Template not found');
        }

        template.templateName = templateName || template.templateName;
        template.taskTitle = taskTitle || template.taskTitle;
        template.description = description !== undefined ? description : template.description;
        template.assignedRole = assignedRole || template.assignedRole;
        template.estimatedHours = estimatedHours !== undefined ? estimatedHours : template.estimatedHours;
        template.priority = priority || template.priority;
        template.steps = steps || template.steps;

        await template.save();
        res.json(template);
    } catch (error) {
        next(error);
    }
};

// Helper function for recursive subtask creation
const createSubTasksFromSteps = async (taskId, onModel, steps, companyId, createdBy, parentId = null, assignedTo = null) => {
    if (!steps || steps.length === 0) return 0;
    let count = 0;

    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        const subTask = await SubTask.create({
            taskId,
            onModel,
            companyId,
            title: step.title,
            remarks: step.remarks || '',
            priority: step.priority,
            createdBy,
            position: index,
            parentSubTaskId: parentId,
            assignedTo: step.assignedTo || assignedTo || undefined,
            status: 'todo'
        });

        count++;

        // Recursively create children
        if (step.steps && step.steps.length > 0) {
            const childCount = await createSubTasksFromSteps(taskId, onModel, step.steps, companyId, createdBy, subTask._id, assignedTo);
            subTask.subTaskCount = childCount;
            await subTask.save();
            count += childCount;
        }
    }
    return count;
};

// Recursive helper to map subtasks to template steps
const mapSubTasksToSteps = async (taskId, parentId = null) => {
    const subTasks = await SubTask.find({ taskId, parentSubTaskId: parentId }).sort({ position: 1 });
    const steps = [];

    for (const st of subTasks) {
        steps.push({
            title: st.title,
            remarks: st.remarks || '',
            priority: st.priority || 'Medium',
            startDate: st.startDate || undefined,
            dueDate: st.dueDate || undefined,
            assignedTo: st.assignedTo || undefined,
            steps: await mapSubTasksToSteps(taskId, st._id)
        });
    }
    return steps;
};

const createTemplateFromTask = async (req, res, next) => {
    try {
        const { taskId, isJobTask } = req.body;
        let task;
        let onModel = isJobTask ? 'JobTask' : 'Task';
        
        // Try searching in root tasks first
        if (onModel === 'JobTask') {
            task = await JobTask.findOne({ _id: taskId, companyId: req.user.companyId });
        } else {
            task = await Task.findOne({ _id: taskId, companyId: req.user.companyId });
        }

        // If not found in root tasks, it might be a subtask
        if (!task) {
            task = await SubTask.findOne({ _id: taskId, companyId: req.user.companyId });
            if (task) {
                // For subtasks, the 'steps' should be gathered relative to this subtask as parent
                const steps = await mapSubTasksToSteps(task.taskId, task._id);
                
                const template = await TaskTemplate.create({
                    companyId: req.user.companyId,
                    templateName: task.title + ' Template',
                    taskTitle: task.title,
                    description: task.description || task.remarks || '',
                    assignedRole: task.assignedRoleType || 'WORKER',
                    estimatedHours: 0,
                    priority: (task.priority || 'Medium').charAt(0).toUpperCase() + (task.priority || 'Medium').slice(1).toLowerCase(),
                    steps,
                    createdBy: req.user._id
                });
                return res.status(201).json(template);
            }
        }

        if (!task) {
            res.status(404);
            throw new Error('Task not found');
        }

        const steps = await mapSubTasksToSteps(taskId);

        const template = await TaskTemplate.create({
            companyId: req.user.companyId,
            templateName: task.title + ' Template',
            taskTitle: task.title,
            description: task.description || '',
            assignedRole: task.assignedRoleType || 'WORKER',
            estimatedHours: 0,
            priority: (task.priority || 'Medium').charAt(0).toUpperCase() + (task.priority || 'Medium').slice(1).toLowerCase(),
            steps,
            createdBy: req.user._id
        });

        res.status(201).json(template);
    } catch (error) {
        next(error);
    }
};

const applyTemplate = async (req, res, next) => {
    try {
        const { jobId, projectId, assignedTo } = req.body;
        const template = await TaskTemplate.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!template) {
            res.status(404);
            throw new Error('Template not found');
        }

        if (!jobId && !projectId) {
            res.status(400);
            throw new Error('Job ID or Project ID is required to apply template');
        }

        let newTask;
        if (jobId) {
            // Apply as JobTask
            newTask = await JobTask.create({
                jobId,
                companyId: req.user.companyId,
                title: template.taskTitle,
                description: template.description,
                priority: template.priority.toLowerCase(),
                assignedRoleType: template.assignedRole || '',
                assignedTo: assignedTo || undefined,
                createdBy: req.user._id,
            });

            // Recursive subtask creation
            if (template.steps && template.steps.length > 0) {
                newTask.subTaskCount = await createSubTasksFromSteps(newTask._id, 'JobTask', template.steps, req.user.companyId, req.user._id, null, assignedTo);
                await newTask.save();
            }
        } else if (projectId) {
            // Apply as Project Task
            newTask = await Task.create({
                projectId,
                companyId: req.user.companyId,
                title: template.taskTitle,
                description: template.description,
                priority: template.priority,
                assignedRoleType: template.assignedRole || '',
                assignedTo: assignedTo ? [assignedTo] : [],
                createdBy: req.user._id,
            });

            // Recursive subtask creation
            if (template.steps && template.steps.length > 0) {
                newTask.subTaskCount = await createSubTasksFromSteps(newTask._id, 'Task', template.steps, req.user.companyId, req.user._id, null, assignedTo);
                await newTask.save();
            }
        }

        res.status(201).json({ message: 'Template applied successfully', task: newTask });
    } catch (error) {
        next(error);
    }
};

const bulkDeleteTemplates = async (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) {
            res.status(400);
            throw new Error('Template IDs are required in an array');
        }
        await TaskTemplate.deleteMany({ _id: { $in: ids }, companyId: req.user.companyId });
        res.json({ message: 'Templates deleted successfully' });
    } catch (error) {
        next(error);
    }
};

const reorderTemplates = async (req, res, next) => {
    try {
        const { templates } = req.body;
        if (!templates || !Array.isArray(templates)) {
            res.status(400);
            throw new Error('Templates array is required');
        }

        const bulkOps = templates.map(t => ({
            updateOne: {
                filter: { _id: t.id, companyId: req.user.companyId },
                update: { $set: { position: t.position } }
            }
        }));

        await TaskTemplate.bulkWrite(bulkOps);
        res.json({ message: 'Templates reordered successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTemplates,
    createTemplate,
    deleteTemplate,
    updateTemplate,
    applyTemplate,
    createTemplateFromTask,
    bulkDeleteTemplates,
    reorderTemplates
};

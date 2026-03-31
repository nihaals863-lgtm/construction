const TaskTemplate = require('../models/TaskTemplate');

const getTemplates = async (req, res, next) => {
    try {
        const templates = await TaskTemplate.find({ companyId: req.user.companyId }).sort({ createdAt: -1 });
        res.json(templates);
    } catch (error) {
        next(error);
    }
};

const createTemplate = async (req, res, next) => {
    try {
        const { templateName, role, title, description, priority, steps } = req.body;
        
        if (!templateName || !title || !role) {
            res.status(400);
            throw new Error('Template name, role, and task title are required');
        }

        const template = await TaskTemplate.create({
            companyId: req.user.companyId,
            templateName,
            role,
            title,
            description,
            priority: priority || 'Medium',
            steps: steps || []
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
        const { templateName, role, title, description, priority, steps } = req.body;
        const template = await TaskTemplate.findOne({ _id: req.params.id, companyId: req.user.companyId });
        
        if (!template) {
            res.status(404);
            throw new Error('Template not found');
        }

        template.templateName = templateName || template.templateName;
        template.role = role || template.role;
        template.title = title || template.title;
        template.description = description !== undefined ? description : template.description;
        template.priority = priority || template.priority;
        template.steps = steps || template.steps;

        await template.save();
        res.json(template);
    } catch (error) {
        next(error);
    }
};

module.exports = { getTemplates, createTemplate, deleteTemplate, updateTemplate };

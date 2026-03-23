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
        const { templateName, title, description, priority, steps } = req.body;
        
        if (!templateName || !title) {
            res.status(400);
            throw new Error('Template name and task title are required');
        }

        const template = await TaskTemplate.create({
            companyId: req.user.companyId,
            templateName,
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

module.exports = { getTemplates, createTemplate, deleteTemplate };

const mongoose = require('mongoose');
const Todo = require('../models/Todo');

// @desc    Get todos for the current user
// @route   GET /api/todos
// @access  Private
const getTodos = async (req, res, next) => {
    try {
        const { _id: userId, companyId } = req.user;
        const query = { companyId, assignedTo: userId };

        if (req.query.status) query.status = req.query.status;

        const todos = await Todo.find(query)
            .sort({ createdAt: -1 })
            .populate('assignedBy', 'fullName role');

        res.json(todos);
    } catch (error) {
        next(error);
    }
};

// @desc    Get todos assigned BY the current user (for admins/PMs)
// @route   GET /api/todos/assigned-by
// @access  Private
const getAssignedByMeTodos = async (req, res, next) => {
    try {
        const { _id: userId, companyId } = req.user;
        const query = { companyId, assignedBy: userId };

        const todos = await Todo.find(query)
            .sort({ createdAt: -1 })
            .populate('assignedTo', 'fullName role');

        res.json(todos);
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new todo
// @route   POST /api/todos
// @access  Private
const createTodo = async (req, res, next) => {
    try {
        const { title, description, assignedTo, priority } = req.body;
        console.log('DEBUG [createTodo] received:', { title, assignedTo });
        if (!req.user) {
            console.error('DEBUG [createTodo]: req.user is null!');
            return res.status(401).json({ message: 'User object missing in request' });
        }
        const { _id: userId, companyId, role } = req.user;
        console.log('DEBUG [createTodo] user info:', { userId, role });

        if (!title) {
            return res.status(400).json({ message: 'Title is required' });
        }

        // Default to self if not provided or if worker is creating
        let finalAssignedTo = assignedTo || userId;
        
        // Workers can only assign to themselves
        if (['WORKER', 'SUBCONTRACTOR'].includes(role)) {
            finalAssignedTo = userId;
        }

        const todo = await Todo.create({
            companyId,
            title,
            description,
            assignedTo: finalAssignedTo,
            assignedBy: userId,
            priority: priority || 'Medium',
            status: 'pending'
        });

        res.status(201).json(todo);
    } catch (error) {
        next(error);
    }
};

// @desc    Update a todo status or details
// @route   PATCH /api/todos/:id
// @access  Private
const updateTodo = async (req, res, next) => {
    try {
        const { title, description, status, priority } = req.body;
        const { _id: userId } = req.user;

        let todo = await Todo.findById(req.params.id);
        if (!todo) {
            return res.status(404).json({ message: 'Todo not found' });
        }

        // Only assigned user or assigner can update
        if (todo.assignedTo.toString() !== userId.toString() && todo.assignedBy.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Not authorized to update this todo' });
        }

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;
        if (priority !== undefined) updates.priority = priority;

        todo = await Todo.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

        res.json(todo);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete a todo
// @route   DELETE /api/todos/:id
// @access  Private
const deleteTodo = async (req, res, next) => {
    try {
        const { _id: userId } = req.user;

        const todo = await Todo.findById(req.params.id);
        if (!todo) {
            return res.status(404).json({ message: 'Todo not found' });
        }

        // Only assigner can delete (or assigned user if they are self-assigned)
        if (todo.assignedBy.toString() !== userId.toString() && todo.assignedTo.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Not authorized to delete this todo' });
        }

        await Todo.findByIdAndDelete(req.params.id);

        res.json({ message: 'Todo removed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTodos,
    getAssignedByMeTodos,
    createTodo,
    updateTodo,
    deleteTodo
};

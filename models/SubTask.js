const mongoose = require('mongoose');

const subTaskSchema = new mongoose.Schema({
    taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true,
        index: true
    },
    // If set, this is a child of another subtask (nested)
    parentSubTaskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubTask',
        default: null,
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    status: {
        type: String,
        enum: ['todo', 'in_progress', 'completed'],
        default: 'todo'
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium'
    },
    startDate: {
        type: Date
    },
    dueDate: {
        type: Date
    },
    remarks: {
        type: String,
        default: ''
    },
    photoUrl: {
        type: String,
        default: ''
    },
    // How many direct children this subtask has
    subTaskCount: {
        type: Number,
        default: 0
    },
    // Progress based on child completion
    progress: {
        type: Number,
        default: 0
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SubTask', subTaskSchema);

const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
    status: { type: String },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    note: { type: String }
}, { _id: false });

const taskSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    scheduleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Schedule'
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    // Primary assignment (single user)
    assignedTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    // Role type of the assigned user(s)
    assignedRoleType: {
        type: String,
        enum: ['WORKER', 'FOREMAN', 'SUBCONTRACTOR', 'PM', 'ENGINEER', ''],
        default: ''
    },
    // Who assigned this task
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    startDate: {
        type: Date
    },
    dueDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['todo', 'in_progress', 'review', 'completed'],
        default: 'todo'
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium'
    },
    attachments: [{
        name: String,
        url: String,
        fileType: String
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    completionOTP: {
        type: String
    },
    // Audit trail for status changes
    statusHistory: [statusHistorySchema],
    progress: {
        type: Number,
        default: 0
    },
    subTaskCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;

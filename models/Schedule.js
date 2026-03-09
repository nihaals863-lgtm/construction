const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
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
    title: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    assignedTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    startDateTime: {
        type: Date,
        required: true
    },
    endDateTime: {
        type: Date,
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        default: 'pending'
    },
    color: {
        type: String,
        default: 'bg-blue-500'
    },
    isMilestone: {
        type: Boolean,
        default: false
    },
    isCritical: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

const Schedule = mongoose.model('Schedule', scheduleSchema);

module.exports = Schedule;

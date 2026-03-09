const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    location: {
        type: String,
        default: ''
    },
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    },
    foremanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    budget: {
        type: Number,
        default: 0
    },
    assignedWorkers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    status: {
        type: String,
        enum: ['planning', 'active', 'on-hold', 'completed'],
        default: 'planning'
    },
    description: {
        type: String,
        default: ''
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    currentPhase: {
        type: String,
        default: 'Scheduled'
    }
}, {
    timestamps: true
});

const Job = mongoose.model('Job', jobSchema);
module.exports = Job;

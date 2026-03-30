const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema({
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
    date: {
        type: Date,
        required: true
    },
    weather: {
        status: String,
        temperature: Number
    },
    manpower: [{
        role: String,
        count: Number,
        hours: Number
    }],
    workPerformed: {
        type: String,
        required: true
    },
    materialsReceived: [String],
    equipmentUsed: [String],
    safetyObservations: String,
    delays: String,
    visitors: [String],
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    photos: [String],
    location: {
        latitude: Number,
        longitude: Number,
        address: String
    },
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Indexes for fast date range and project lookups
dailyLogSchema.index({ companyId: 1, projectId: 1, date: -1 });
dailyLogSchema.index({ companyId: 1, date: -1 });

const DailyLog = mongoose.model('DailyLog', dailyLogSchema);

module.exports = DailyLog;

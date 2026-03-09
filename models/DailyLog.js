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
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

const DailyLog = mongoose.model('DailyLog', dailyLogSchema);

module.exports = DailyLog;

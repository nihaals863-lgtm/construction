const mongoose = require('mongoose');

const timeLogSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job'
    },
    taskId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'taskModel'
    },
    taskModel: {
        type: String,
        enum: ['JobTask', 'Task', 'SubTask'],
        default: 'JobTask'
    },
    clockIn: {
        type: Date,
        required: true
    },
    clockOut: {
        type: Date
    },
    gpsIn: {
        latitude: Number,
        longitude: Number
    },
    gpsOut: {
        latitude: Number,
        longitude: Number
    },
    clockInLatitude: Number,
    clockInLongitude: Number,
    clockInAccuracy: Number,
    clockOutLatitude: Number,
    clockOutLongitude: Number,
    clockOutAccuracy: Number,
    isOutsideGeofence: {
        type: Boolean,
        default: false
    },
    geofenceStatus: {
        type: String,
        enum: ['inside', 'outside', 'unknown'],
        default: 'unknown'
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    isManual: {
        type: Boolean,
        default: false
    },
    reason: {
        type: String
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdByRole: {
        type: String,
        enum: ['SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN', 'SUBCONTRACTOR', 'WORKER', 'SYSTEM'],
        default: 'WORKER'
    },
    deviceInfo: {
        type: String
    },
    offlineSync: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});


timeLogSchema.index({ companyId: 1 });
timeLogSchema.index({ userId: 1 });
timeLogSchema.index({ projectId: 1 });
timeLogSchema.index({ clockIn: 1 });
timeLogSchema.index({ companyId: 1, clockIn: -1 });

const TimeLog = mongoose.model('TimeLog', timeLogSchema);

module.exports = TimeLog;

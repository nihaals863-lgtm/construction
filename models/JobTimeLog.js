const mongoose = require('mongoose');

const jobTimeLogSchema = new mongoose.Schema({
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    workerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    workDate: {
        type: Date,
        required: true
    },
    checkIn: {
        type: Date,
        required: true
    },
    checkOut: {
        type: Date
    },
    totalHours: {
        type: Number,
        default: 0
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Indexing for faster history lookups
jobTimeLogSchema.index({ jobId: 1, workerId: 1, workDate: -1 });

module.exports = mongoose.model('JobTimeLog', jobTimeLogSchema);

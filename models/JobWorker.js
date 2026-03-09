const mongoose = require('mongoose');

const jobWorkerSchema = new mongoose.Schema({
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
    assignedAt: {
        type: Date,
        default: Date.now
    },
    removedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexing for faster history lookups
jobWorkerSchema.index({ jobId: 1, workerId: 1 });

module.exports = mongoose.model('JobWorker', jobWorkerSchema);

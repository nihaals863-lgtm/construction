const mongoose = require('mongoose');

const jobActivityLogSchema = new mongoose.Schema({
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    actionType: {
        type: String,
        enum: ['CREATED', 'STATUS_CHANGED', 'WORKER_ADDED', 'WORKER_REMOVED', 'UPDATED', 'COMPLETED', 'FOREMAN_CHANGED'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Indexing for faster history lookups
jobActivityLogSchema.index({ jobId: 1, createdAt: -1 });

module.exports = mongoose.model('JobActivityLog', jobActivityLogSchema);

const mongoose = require('mongoose');

const correctionRequestSchema = new mongoose.Schema({
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
    timeLogId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TimeLog',
        required: true
    },
    requestedChanges: {
        clockIn: Date,
        clockOut: Date,
        reason: {
            type: String,
            required: true
        }
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewNotes: String
}, {
    timestamps: true
});

const CorrectionRequest = mongoose.model('CorrectionRequest', correctionRequestSchema);

module.exports = CorrectionRequest;

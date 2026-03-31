const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
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
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job'
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'fixed', 'closed', 'in_review', 'resolved'],
        default: 'open'
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    dueDate: Date,
    category: {
        type: String,
        enum: ['safety', 'quality', 'work', 'material', 'other', 'general', 'equipment'],
        default: 'general'
    },
    photoIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Photo'
    }],
    images: [{
        type: String // Cloudinary URLs
    }]
}, {
    timestamps: true
});

const Issue = mongoose.model('Issue', issueSchema);

module.exports = Issue;

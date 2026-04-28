const mongoose = require('mongoose');

const drawingSchema = new mongoose.Schema({
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
    drawingNumber: {
        type: String
    },
    category: {
        type: String,
        enum: ['architectural', 'structural', 'mechanical', 'electrical', 'plumbing', 'civil', 'other'],
        default: 'architectural'
    },
    versions: [{
        versionNumber: Number,
        fileUrl: String,
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        uploadedAt: {
            type: Date,
            default: Date.now
        },
        releaseDate: Date,
        description: String
    }],
    currentVersion: {
        type: Number,
        default: 1
    },
    status: {
        type: String,
        enum: ['active', 'superseded', 'void'],
        default: 'active'
    }
}, {
    timestamps: true
});

// Optimization: Added indexes for faster queries
drawingSchema.index({ companyId: 1 });
drawingSchema.index({ projectId: 1 });
drawingSchema.index({ companyId: 1, createdAt: -1 }); // For list view sorting

const Drawing = mongoose.model('Drawing', drawingSchema);

module.exports = Drawing;

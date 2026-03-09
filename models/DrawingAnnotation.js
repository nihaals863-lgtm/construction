const mongoose = require('mongoose');

const drawingAnnotationSchema = new mongoose.Schema({
    drawingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Drawing',
        required: true
    },
    versionId: {
        type: mongoose.Schema.Types.ObjectId, // References the _id of the version in the Drawing.versions array
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    pageNumber: {
        type: Number,
        required: true,
        default: 1
    },
    type: {
        type: String,
        enum: ['highlight', 'comment', 'arrow', 'box', 'text', 'line'],
        required: true
    },
    coordinates: {
        type: mongoose.Schema.Types.Mixed, // Will store { x1, y1, x2, y2 } or path data
        required: true
    },
    content: {
        type: String // Optional text for comments or text notes
    },
    status: {
        type: String,
        enum: ['open', 'resolved'],
        default: 'open'
    },
    isVisibleToClient: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for faster queries per drawing version
drawingAnnotationSchema.index({ drawingId: 1, versionId: 1 });

const DrawingAnnotation = mongoose.model('DrawingAnnotation', drawingAnnotationSchema);

module.exports = DrawingAnnotation;

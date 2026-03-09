const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: false
    },
    taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task'
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    imageUrl: {
        type: String,
        required: true
    },
    thumbnailUrl: {
        type: String
    },
    location: {
        latitude: Number,
        longitude: Number
    },
    timestampTaken: {
        type: Date,
        default: Date.now
    },
    description: {
        type: String
    },
    issueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Issue'
    },
    offlineUploaded: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const Photo = mongoose.model('Photo', photoSchema);

module.exports = Photo;

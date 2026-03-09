const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
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
    roomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatRoom',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    message: {
        type: String,
        required: true
    },
    attachments: [{
        name: String,
        url: String,
        fileType: String
    }],
    readBy: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

// Index for performance
chatSchema.index({ roomId: 1, createdAt: -1 });

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;

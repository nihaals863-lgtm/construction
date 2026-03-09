const mongoose = require('mongoose');

const chatRoomSchema = new mongoose.Schema({
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
    roomType: {
        type: String,
        enum: ['ADMIN_SUB', 'ADMIN_CLIENT', 'SUB_CLIENT', 'INTERNAL', 'PROJECT_GROUP', 'DIRECT'],
        required: true
    },
    name: {
        type: String,
        trim: true
    },
    isGroup: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    metadata: {
        type: Map,
        of: String
    }
}, {
    timestamps: true
});

// Index for quick lookups
chatRoomSchema.index({ companyId: 1, roomType: 1 });
chatRoomSchema.index({ projectId: 1 });

const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

module.exports = ChatRoom;

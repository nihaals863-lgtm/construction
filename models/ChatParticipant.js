const mongoose = require('mongoose');

const chatParticipantSchema = new mongoose.Schema({
    roomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatRoom',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    roleAtJoining: {
        type: String,
        required: true
    },
    lastReadAt: {
        type: Date,
        default: Date.now
    },
    isMuted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Compound index for unique membership and fast lookups
chatParticipantSchema.index({ roomId: 1, userId: 1 }, { unique: true });
chatParticipantSchema.index({ userId: 1, companyId: 1 });

const ChatParticipant = mongoose.model('ChatParticipant', chatParticipantSchema);

module.exports = ChatParticipant;

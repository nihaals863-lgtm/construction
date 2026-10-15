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

// Prevent adding more than 2 participants to any DIRECT chat room
chatParticipantSchema.pre('save', async function (next) {
    if (this.isNew) {
        try {
            const ChatRoom = mongoose.models.ChatRoom || mongoose.model('ChatRoom');
            const room = await ChatRoom.findById(this.roomId).select('roomType').lean();
            if (room && room.roomType === 'DIRECT') {
                const count = await this.constructor.countDocuments({ roomId: this.roomId });
                if (count >= 2) {
                    const err = new Error('Direct chat room cannot have more than 2 participants.');
                    err.code = 'DIRECT_ROOM_MAX_PARTICIPANTS';
                    return next(err);
                }
            }
        } catch (err) {
            return next(err);
        }
    }
    next();
});

const ChatParticipant = mongoose.model('ChatParticipant', chatParticipantSchema);

module.exports = ChatParticipant;

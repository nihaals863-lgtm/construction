const mongoose = require('mongoose');

const fcmTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    token: {
        type: String,
        required: true,
        unique: true
    },
    platform: {
        type: String,
        enum: ['android', 'ios', 'web'],
        required: true
    },
    provider: {
        type: String,
        enum: ['firebase', 'expo'],
        default: 'firebase'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for fast query by userId and active status
fcmTokenSchema.index({ userId: 1, isActive: 1 });
fcmTokenSchema.index({ token: 1 });

const FcmToken = mongoose.model('FcmToken', fcmTokenSchema);

module.exports = FcmToken;

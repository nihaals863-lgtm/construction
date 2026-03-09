const mongoose = require('mongoose');

const userPermissionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    permissionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Permission',
        required: true
    },
    isAllowed: {
        type: Boolean,
        required: true,
        default: true
    }
}, {
    timestamps: true
});

// One entry per user-permission pair
userPermissionSchema.index({ userId: 1, permissionId: 1 }, { unique: true });

const UserPermission = mongoose.model('UserPermission', userPermissionSchema);
module.exports = UserPermission;

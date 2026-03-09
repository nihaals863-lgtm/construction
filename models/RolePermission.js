const mongoose = require('mongoose');

const rolePermissionSchema = new mongoose.Schema({
    roleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Role',
        required: true
    },
    permissionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Permission',
        required: true
    }
}, {
    timestamps: true
});

// Ensure a role doesn't have duplicate permission assignments
rolePermissionSchema.index({ roleId: 1, permissionId: 1 }, { unique: true });

const RolePermission = mongoose.model('RolePermission', rolePermissionSchema);

module.exports = RolePermission;

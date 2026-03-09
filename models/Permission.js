const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    module: {
        type: String,
        required: true,
        enum: ['TASK', 'RFI', 'PO', 'CHAT', 'EQUIPMENT', 'USER', 'PROJECT', 'FINANCIAL', 'OTHER'],
        default: 'OTHER'
    },
    description: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

const Permission = mongoose.model('Permission', permissionSchema);
module.exports = Permission;

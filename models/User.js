const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    fullName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'CLIENT', 'SUBCONTRACTOR'],
        default: 'WORKER'
    },
    roleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Role'
    },
    phone: {
        type: String
    },
    hourlyRate: {
        type: Number,
        default: 30
    },
    province: {
        type: String,
        default: 'Ontario'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    avatar: {
        type: String
    }
}, {
    timestamps: true
});

// Password Encryption
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Password Verification
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Indexes for querying staff directories quickly
userSchema.index({ companyId: 1, role: 1, isActive: 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;

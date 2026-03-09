const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    logo: {
        type: String
    },
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String
    },
    address: {
        type: String
    },
    subscriptionPlanId: {
        type: String,
        default: 'basic'
    },
    subscriptionStatus: {
        type: String,
        enum: ['active', 'inactive', 'past_due', 'canceled', 'pending'],
        default: 'active'
    },
    storageUsed: {
        type: Number,
        default: 0 // in bytes
    },
    startDate: {
        type: Date
    },
    expireDate: {
        type: Date
    },
    planType: {
        type: String,
        enum: ['Monthly', 'Yearly', 'Custom'],
        default: 'Monthly'
    }
}, {
    timestamps: true
});

const Company = mongoose.model('Company', companySchema);

module.exports = Company;

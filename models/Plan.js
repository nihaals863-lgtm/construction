const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    price: {
        type: Number,
        required: true
    },
    period: {
        type: String,
        enum: ['month', 'year', 'custom'],
        default: 'month'
    },
    features: [{
        type: String
    }],
    maxUsers: {
        type: Number,
        default: 10
    },
    maxProjects: {
        type: Number,
        default: 5
    },
    isPopular: {
        type: Boolean,
        default: false
    },
    rolePermissions: {
        type: Map,
        of: [String], // Keys are Role names (e.g. 'ADMIN'), Values are arrays of permission keys
        default: {}
    }
}, {
    timestamps: true
});

const Plan = mongoose.model('Plan', planSchema);

module.exports = Plan;

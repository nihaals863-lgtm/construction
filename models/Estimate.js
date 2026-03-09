const mongoose = require('mongoose');

const estimateSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    estimateNumber: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    items: [{
        description: String,
        quantity: Number,
        unit: String,
        unitPrice: Number,
        total: Number
    }],
    subtotal: {
        type: Number,
        required: true
    },
    tax: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'sent', 'approved', 'rejected', 'invoiced'],
        default: 'draft'
    },
    notes: String,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

const Estimate = mongoose.model('Estimate', estimateSchema);

module.exports = Estimate;

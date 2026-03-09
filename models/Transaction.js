const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'USD'
    },
    status: {
        type: String,
        enum: ['paid', 'failed', 'refunded', 'pending'],
        required: true
    },
    type: {
        type: String,
        enum: ['subscription', 'top-up', 'adjustment'],
        default: 'subscription'
    },
    paymentMethod: {
        type: String, // e.g., 'card', 'bank_transfer'
    },
    stripePaymentIntentId: String,
    failureReason: String,
    metadata: Object
}, {
    timestamps: true
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;

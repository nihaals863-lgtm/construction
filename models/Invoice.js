const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
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
    invoiceNumber: {
        type: String,
        required: true
    },
    estimateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Estimate'
    },
    items: [{
        description: String,
        quantity: Number,
        unitPrice: Number,
        total: Number
    }],
    totalAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['unpaid', 'partially_paid', 'paid', 'overdue', 'void'],
        default: 'unpaid'
    },
    dueDate: Date,
    paidAt: Date,
    stripeInvoiceId: String,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

module.exports = Invoice;

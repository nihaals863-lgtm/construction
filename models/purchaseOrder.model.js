const mongoose = require('mongoose');

const purchaseOrderSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    poNumber: {
        type: String,
        required: true,
        unique: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job'
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    },
    vendorName: {
        type: String,
        required: true
    },
    vendorEmail: {
        type: String,
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [{
        itemName: { type: String, required: true },
        description: String,
        quantity: { type: Number, required: true, default: 1 },
        unitPrice: { type: Number, required: true, default: 0 },
        total: { type: Number, required: true, default: 0 }
    }],
    subtotal: {
        type: Number,
        required: true,
        default: 0
    },
    tax: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        default: 0
    },
    status: {
        type: String,
        enum: ['Draft', 'Pending Approval', 'Approved', 'Sent', 'Delivered', 'Closed', 'Cancelled'],
        default: 'Draft'
    },
    notesToVendor: String,
    internalNotes: String,
    expectedDeliveryDate: Date,
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Middleware to calculate item totals before saving
purchaseOrderSchema.pre('validate', function (next) {
    if (this.items && this.items.length > 0) {
        let subtotal = 0;
        this.items.forEach(item => {
            item.total = item.quantity * item.unitPrice;
            subtotal += item.total;
        });
        this.subtotal = subtotal;
        this.tax = subtotal * 0.15; // Standard 15% tax
        this.totalAmount = this.subtotal + this.tax;
    }
    next();
});

const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);

module.exports = PurchaseOrder;

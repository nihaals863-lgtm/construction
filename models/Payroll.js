const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    payPeriodStart: {
        type: Date,
        required: true
    },
    payPeriodEnd: {
        type: Date,
        required: true
    },
    totalHours: {
        type: Number,
        required: true
    },
    hourlyRate: {
        type: Number,
        required: true
    },
    grossPay: {
        type: Number,
        required: true
    },
    cpp: {
        type: Number,
        default: 0
    },
    ei: {
        type: Number,
        default: 0
    },
    federalTax: {
        type: Number,
        default: 0
    },
    provincialTax: {
        type: Number,
        default: 0
    },
    wcb: {
        type: Number,
        default: 0
    },
    netPay: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'paid', 'held'],
        default: 'pending'
    },
    paymentDate: {
        type: Date
    },
    referenceId: {
        type: String
    }
}, {
    timestamps: true
});

const Payroll = mongoose.model('Payroll', payrollSchema);

module.exports = Payroll;

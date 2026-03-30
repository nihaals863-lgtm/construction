const mongoose = require('mongoose');

const tradeBidSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    drawingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Drawing',
        required: true
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        required: true
    },
    bidAmount: {
        type: Number,
        required: true
    },
    notes: String,
    attachments: [{
        name: String,
        url: String,
        fileType: String
    }],
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    bidDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const TradeBid = mongoose.model('TradeBid', tradeBidSchema);

module.exports = TradeBid;

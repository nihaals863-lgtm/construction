const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    phone: String,
    address: String,
    contactPerson: String,
    category: String,
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
}, {
    timestamps: true
});

const Vendor = mongoose.model('Vendor', vendorSchema);

module.exports = Vendor;

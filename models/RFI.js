const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const rfiSchema = new mongoose.Schema({
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
    rfiNumber: {
        type: String
    },
    subject: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    location: {
        type: String
    },
    category: {
        type: String,
        enum: ['design', 'structural', 'mechanical', 'electrical', 'civil', 'safety', 'material', 'other'],
        default: 'other'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in_review', 'answered', 'closed'],
        default: 'open'
    },
    raisedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    dueDate: {
        type: Date
    },
    officialResponse: {
        type: String
    },
    attachments: [{
        name: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now }
    }],
    comments: [commentSchema]
}, {
    timestamps: true
});

// Auto-generate RFI number per company
rfiSchema.pre('save', async function (next) {
    if (this.isNew) {
        const count = await this.constructor.countDocuments({ companyId: this.companyId });
        this.rfiNumber = `RFI-${String(count + 1).padStart(4, '0')}`;
    }
    next();
});

// Virtual: isOverdue
rfiSchema.virtual('isOverdue').get(function () {
    if (!this.dueDate) return false;
    return this.status !== 'closed' && new Date(this.dueDate) < new Date();
});

rfiSchema.set('toJSON', { virtuals: true });
rfiSchema.set('toObject', { virtuals: true });

const RFI = mongoose.model('RFI', rfiSchema);
module.exports = RFI;

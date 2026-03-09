const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in-progress', 'resolved', 'closed'],
        default: 'open'
    },
    category: {
        type: String,
        enum: ['billing', 'technical', 'feature-request', 'bug', 'other'],
        default: 'technical'
    },
    messages: [{
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        senderRole: {
            type: String,
            enum: ['SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'ENGINEER', 'CLIENT']
        },
        text: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

module.exports = SupportTicket;

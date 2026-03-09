const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true // e.g., 'LOGIN', 'PLAN_CREATED', 'COMPANY_APPROVED'
    },
    module: {
        type: String,
        required: true // e.g., 'AUTH', 'BILLING', 'COMPANIES'
    },
    details: {
        type: String
    },
    ipAddress: String,
    userAgent: String,
    metadata: Object
}, {
    timestamps: true
});

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;

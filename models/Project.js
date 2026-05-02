const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User' // References a user with role CLIENT
    },
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    },
    budget: {
        type: Number,
        default: 0
    },
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    status: {
        type: String,
        enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
        default: 'planning'
    },
    location: {
        address: String,
        latitude: Number,
        longitude: Number
    },
    siteLatitude: Number,
    siteLongitude: Number,
    allowedRadiusMeters: {
        type: Number,
        default: 100
    },
    geofenceRadius: {
        type: Number,
        default: 200 // in meters
    },
    strictGeofence: {
        type: Boolean,
        default: false
    },
    image: {
        type: String // Base64 or URL
    },
    pmId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    currentPhase: {
        type: String,
        default: 'Planning'
    },
    contacts: [{
        name: { type: String, required: true },
        email: { type: String },
        phone: { type: String },
        role: { type: String }
    }]
}, {
    timestamps: true
});

// Indexes for quick filtering
projectSchema.index({ companyId: 1, status: 1 });
projectSchema.index({ companyId: 1, pmId: 1 });
projectSchema.index({ companyId: 1, clientId: 1 });

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;

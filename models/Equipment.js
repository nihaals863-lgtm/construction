const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    category: {
        type: String, // 'Heavy Equipment' or 'Small Tools'
        required: true,
        default: 'Heavy Equipment'
    },
    type: {
        type: String, // 'Excavator', 'Power Tool', 'Ladder', etc.
        required: true
    },
    serialNumber: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['operational', 'maintenance', 'idle', 'out_of_service'],
        default: 'operational'
    },
    assignedJob: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        default: null
    },
    assignedDate: {
        type: Date,
        default: null
    },
    lastServiceDate: {
        type: Date
    },
    location: {
        type: String,
        default: 'Warehouse'
    },
    notes: {
        type: String,
        default: ''
    },
    imageUrl: {
        type: String,
        default: ''
    },
    costPerHour: {
        type: Number,
        default: 0
    },
    assignmentHistory: [
        {
            jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
            jobName: { type: String, default: '' },
            projectName: { type: String, default: '' },
            assignedDate: { type: Date },
            returnedDate: { type: Date, default: null },
            notes: { type: String, default: '' }
        }
    ]
}, {
    timestamps: true
});

const Equipment = mongoose.model('Equipment', equipmentSchema);
module.exports = Equipment;

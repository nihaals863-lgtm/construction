const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
    title: { type: String, required: true },
    remarks: { type: String, default: '' },
    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    startDate: { type: Date },
    dueDate: { type: Date },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

// Add recursive steps to the schema
stepSchema.add({
    steps: [stepSchema]
});

const taskTemplateSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    templateName: { type: String, required: true },
    taskTitle: { type: String, required: true },
    description: { type: String, default: '' },
    assignedRole: { type: String, required: true }, // Electrician, Plumber, etc.
    estimatedHours: { type: Number, default: 0 },
    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    steps: [stepSchema],
    position: { type: Number, default: 0 },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('TaskTemplate', taskTemplateSchema);

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Role = require('../models/Role');

dotenv.config();

const updateRoles = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const roleMappings = [
            { name: 'PM', description: 'Project Manager' },
            { name: 'FOREMAN', description: 'Foreman' },
            { name: 'WORKER', description: 'Worker' },
            { name: 'SUBCONTRACTOR', description: 'Subcontractor' },
            { name: 'CLIENT', description: 'Client' }
        ];

        for (const mapping of roleMappings) {
            await Role.findOneAndUpdate(
                { name: mapping.name },
                { description: mapping.description },
                { upsert: true, new: true }
            );
            console.log(`Updated role ${mapping.name} with description: ${mapping.description}`);
        }

        // Optional: Deactivate or hide other roles if needed, 
        // but for now we'll just filter them in the frontend.

        console.log('Role updates completed.');
        process.exit(0);
    } catch (error) {
        console.error('Update failed:', error);
        process.exit(1);
    }
};

updateRoles();

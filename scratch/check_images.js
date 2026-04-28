const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Project = require('../models/Project');

const checkProjectImages = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const projects = await Project.find({}).select('name image').limit(10).lean();
        
        console.log('--- Project Image Data ---');
        projects.forEach(p => {
            console.log(`Project: ${p.name}`);
            console.log(`Image: ${p.image ? (p.image.substring(0, 50) + '...') : 'NULL'}`);
            console.log('---------------------------');
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkProjectImages();

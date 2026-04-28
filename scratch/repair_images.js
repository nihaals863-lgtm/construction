const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Project = require('../models/Project');
const Photo = require('../models/Photo');

const repairProjectImages = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB for Repair');

        const projects = await Project.find({ image: null });
        console.log(`Found ${projects.length} projects without images.`);

        let repairCount = 0;
        for (const project of projects) {
            // Find the latest photo for this project
            const latestPhoto = await Photo.findOne({ projectId: project._id }).sort({ createdAt: -1 }).lean();
            
            if (latestPhoto && latestPhoto.imageUrl) {
                console.log(`Repairing ${project.name} with photo: ${latestPhoto.imageUrl.substring(0, 50)}...`);
                await Project.findByIdAndUpdate(project._id, { image: latestPhoto.imageUrl });
                repairCount++;
            }
        }

        console.log(`Successfully repaired ${repairCount} project thumbnails!`);
        process.exit(0);
    } catch (error) {
        console.error('Error during repair:', error);
        process.exit(1);
    }
};

repairProjectImages();

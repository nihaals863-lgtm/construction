const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Project = require('../models/Project');
const User = require('../models/User');

const cleanData = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB for Cleaning');

        console.log('Searching for Base64 images in Projects...');
        const resultProject = await Project.updateMany(
            { image: { $regex: /^data:image/ } },
            { $set: { image: null } }
        );
        console.log(`Projects updated: ${resultProject.modifiedCount}`);

        console.log('Searching for Base64 avatars in Users...');
        const resultUser = await User.updateMany(
            { avatar: { $regex: /^data:image/ } },
            { $set: { avatar: null } }
        );
        console.log(`Users updated: ${resultUser.modifiedCount}`);

        console.log('Cleanup Complete! Now fetching optimized counts...');
        const projectCount = await Project.countDocuments();
        const userCount = await User.countDocuments();
        console.log(`Total Projects: ${projectCount}, Total Users: ${userCount}`);

        process.exit(0);
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
};

cleanData();

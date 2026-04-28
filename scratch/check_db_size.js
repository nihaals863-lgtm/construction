const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Project = require('../models/Project');
const User = require('../models/User');

const checkDataSize = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const projects = await Project.find().select('name image').lean();
        console.log(`Total Projects: ${projects.length}`);
        
        let totalImageSize = 0;
        let base64Count = 0;

        projects.forEach(p => {
            if (p.image && p.image.startsWith('data:image')) {
                base64Count++;
                totalImageSize += p.image.length;
            }
        });

        console.log(`Projects with Base64 images: ${base64Count}`);
        console.log(`Total Base64 data in Projects: ${(totalImageSize / (1024 * 1024)).toFixed(2)} MB`);

        const users = await User.find().select('fullName avatar').lean();
        let totalAvatarSize = 0;
        let avatarBase64Count = 0;

        users.forEach(u => {
            if (u.avatar && u.avatar.startsWith('data:image')) {
                avatarBase64Count++;
                totalAvatarSize += u.avatar.length;
            }
        });

        console.log(`Users with Base64 avatars: ${avatarBase64Count}`);
        console.log(`Total Base64 data in Users: ${(totalAvatarSize / (1024 * 1024)).toFixed(2)} MB`);

        if (base64Count > 0 || avatarBase64Count > 0) {
            console.log('CLEANING DATA...');
            
            // OPTIONAL: Uncomment to actually clean
            /*
            await Project.updateMany(
                { image: { $regex: /^data:image/ } },
                { $set: { image: null } }
            );
            await User.updateMany(
                { avatar: { $regex: /^data:image/ } },
                { $set: { avatar: null } }
            );
            console.log('Data Cleaned!');
            */
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkDataSize();

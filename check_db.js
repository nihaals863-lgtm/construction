const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const Photo = require('./models/Photo');

const check = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const photos = await Photo.find({}).sort({ createdAt: -1 }).limit(5);
        console.log('Latest 5 photos:');
        console.log(JSON.stringify(photos, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

check();

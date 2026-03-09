const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');

const createEngineer = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const existing = await User.findOne({ email: 'engineer@kaal.ca' });
        if (existing) {
            console.log('Engineer user already exists. Updating password...');
            existing.password = '123456';
            await existing.save();
            console.log('Password updated.');
        } else {
            const engineer = await User.create({
                companyId: '69943f0fe2e8450ab883bdfb',
                fullName: 'Engineer User',
                email: 'engineer@kaal.ca',
                password: '123456',
                role: 'ENGINEER'
            });
            console.log('Engineer user created:', engineer.email);
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

createEngineer();

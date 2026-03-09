const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');

const check = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const engineers = await User.find({ role: 'ENGINEER' });
        console.log('Engineers found:');
        console.log(JSON.stringify(engineers.map(u => ({ email: u.email, fullName: u.fullName, role: u.role })), null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

check();

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Company = require('./models/Company');

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find KAAL company
    const company = await Company.findOne();
    if (!company) {
        console.log('No company found');
        process.exit(1);
    }
    console.log('Using company:', company.name, company._id);

    // Check if subcontractor already exists
    const existing = await User.findOne({ email: 'subcontractor@kaal.ca' });
    if (existing) {
        console.log('Subcontractor user already exists:', existing.email);
        process.exit(0);
    }

    // Create subcontractor user
    const user = await User.create({
        fullName: 'Sam Subcontractor',
        email: 'subcontractor@kaal.ca',
        password: '123456',
        role: 'SUBCONTRACTOR',
        companyId: company._id,
        phone: '+1-555-0199',
        isActive: true
    });

    console.log('✅ Subcontractor user created successfully!');
    console.log('Email:', user.email);
    console.log('Password: 123456');
    console.log('Role:', user.role);

    process.exit(0);
};

run().catch(err => {
    console.error(err);
    process.exit(1);
});

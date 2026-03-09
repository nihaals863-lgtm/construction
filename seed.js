require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

const seedData = async () => {
    try {
        await connectDB();

        const RolePermission = require('./models/RolePermission');

        // Clear existing data
        await User.deleteMany();
        await RolePermission.deleteMany();

        console.log('Data cleared...');

        const companyId = new mongoose.Types.ObjectId(); // Mock Company ID

        // Seed Role Permissions
        const rolePermissions = [
            {
                role: 'SUPER_ADMIN',
                permissions: ['ALL']
            },
            {
                role: 'COMPANY_OWNER',
                permissions: ['MANAGE_PROJECTS', 'MANAGE_TASKS', 'VIEW_FINANCIALS', 'MANAGE_FINANCIALS', 'MANAGE_TEAM', 'VIEW_REPORTS', 'ACCESS_CHAT', 'CLOCK_IN_OUT']
            },
            {
                role: 'PM',
                permissions: ['MANAGE_PROJECTS', 'MANAGE_TASKS', 'VIEW_FINANCIALS', 'MANAGE_TEAM', 'VIEW_REPORTS', 'ACCESS_CHAT', 'CLOCK_IN_OUT']
            },
            {
                role: 'FOREMAN',
                permissions: ['VIEW_PROJECTS', 'MANAGE_TASKS', 'VIEW_REPORTS', 'ACCESS_CHAT', 'CLOCK_IN_OUT', 'MANAGE_DAILY_LOGS']
            },
            {
                role: 'WORKER',
                permissions: ['VIEW_PROJECTS', 'VIEW_MY_TASKS', 'ACCESS_CHAT', 'CLOCK_IN_OUT']
            },
            {
                role: 'ENGINEER',
                permissions: ['VIEW_PROJECTS', 'VIEW_TASKS', 'MANAGE_DRAWINGS', 'ACCESS_CHAT']
            },
            {
                role: 'CLIENT',
                permissions: ['VIEW_PROJECTS', 'VIEW_PHOTOS', 'VIEW_INVOICES', 'ACCESS_CHAT']
            }
        ];

        await RolePermission.create(rolePermissions);
        console.log('Role Permissions seeded!');

        const users = [
            {
                fullName: 'Super Admin',
                email: 'super@admin.com',
                password: '123456',
                role: 'SUPER_ADMIN',
                companyId,
            },
            {
                fullName: 'John Admin',
                email: 'company@admin.com',
                password: '123456',
                role: 'COMPANY_OWNER',
                companyId,
            },
            {
                fullName: 'Project Manager',
                email: 'pm@kaal.ca',
                password: '123456',
                role: 'PM',
                companyId,
            },
            {
                fullName: 'Site Foreman',
                email: 'foreman@kaal.ca',
                password: '123456',
                role: 'FOREMAN',
                companyId,
            },
            {
                fullName: 'Construction Worker',
                email: 'worker@kaal.ca',
                password: '123456',
                role: 'WORKER',
                companyId,
            },
            {
                fullName: 'Site Engineer',
                email: 'engineer@kaal.ca',
                password: '123456',
                role: 'ENGINEER',
                companyId,
            },
            {
                fullName: 'Valued Client',
                email: 'client@kaal.ca',
                password: '123456',
                role: 'CLIENT',
                companyId,
            },
        ];

        // Password hashing is handled by the User model's pre-save middleware
        await User.create(users);

        console.log('Seed Data Created!');
        process.exit();
    } catch (error) {
        console.error('Error seeding data:', error);
        process.exit(1);
    }
};

seedData();

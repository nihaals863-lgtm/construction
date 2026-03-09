const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Role = require('../models/Role');
const Permission = require('../models/Permission');
const RolePermission = require('../models/RolePermission');
const User = require('../models/User');

dotenv.config();

const rolesData = [
    { name: 'SUPER_ADMIN', description: 'System Administrator' },
    { name: 'COMPANY_OWNER', description: 'Business Owner' },
    { name: 'PM', description: 'Project Manager' },
    { name: 'FOREMAN', description: 'Forman' },
    { name: 'WORKER', description: 'Worker' },
    { name: 'CLIENT', description: 'Client' },
    { name: 'SUBCONTRACTOR', description: 'Subcontractor' }
];

const permissionsData = [
    // General
    { key: 'VIEW_DASHBOARD', module: 'GENERAL', description: 'Can view dashboard' },
    { key: 'VIEW_TEAM', module: 'GENERAL', description: 'Can view team/users' },
    { key: 'ACCESS_SETTINGS', module: 'GENERAL', description: 'Can access settings' },

    // Project Permissions
    { key: 'VIEW_PROJECTS', module: 'PROJECT', description: 'Can view projects' },
    { key: 'CREATE_PROJECT', module: 'PROJECT', description: 'Can create projects' },
    { key: 'EDIT_PROJECT', module: 'PROJECT', description: 'Can edit projects' },

    // RFI Permissions
    { key: 'VIEW_RFI', module: 'RFI', description: 'Can view RFIs' },
    { key: 'CREATE_RFI', module: 'RFI', description: 'Can create RFIs' },
    { key: 'EDIT_RFI', module: 'RFI', description: 'Can edit RFIs' },
    { key: 'DELETE_RFI', module: 'RFI', description: 'Can delete RFIs' },
    { key: 'APPROVE_RFI', module: 'RFI', description: 'Can approve RFIs' },

    // Task Permissions
    { key: 'VIEW_TASKS', module: 'TASK', description: 'Can view tasks' },
    { key: 'CREATE_TASK', module: 'TASK', description: 'Can create tasks' },
    { key: 'EDIT_TASK', module: 'TASK', description: 'Can edit tasks' },

    // Attendance/Clocking
    { key: 'CLOCK_IN_OUT', module: 'ATTENDANCE', description: 'Can clock in/out (My Clock)' },
    { key: 'CLOCK_IN_CREW', module: 'ATTENDANCE', description: 'Can clock in crew members' },
    { key: 'VIEW_TIMESHEETS', module: 'ATTENDANCE', description: 'Can view timesheets' },

    // Content/Field Data
    { key: 'VIEW_DAILY_LOGS', module: 'FIELD_DATA', description: 'Can view daily logs' },
    { key: 'VIEW_DRAWINGS', module: 'FIELD_DATA', description: 'Can view drawings' },
    { key: 'VIEW_PHOTOS', module: 'FIELD_DATA', description: 'Can view photos' },
    { key: 'VIEW_ISSUES', module: 'FIELD_DATA', description: 'Can view issues' },
    { key: 'VIEW_GPS', module: 'FIELD_DATA', description: 'Can view GPS tracking' },

    // Financial/Admin
    { key: 'VIEW_PO', module: 'FINANCIAL', description: 'Can view Purchase Orders' },
    { key: 'APPROVE_PO', module: 'FINANCIAL', description: 'Can approve Purchase Orders' },
    { key: 'VIEW_INVOICES', module: 'FINANCIAL', description: 'Can view invoices' },
    { key: 'VIEW_PAYROLL', module: 'FINANCIAL', description: 'Can view payroll' },

    // Others
    { key: 'VIEW_CHAT', module: 'COMMUNICATION', description: 'Can access chat' },
    { key: 'VIEW_EQUIPMENT', module: 'RESOURCES', description: 'Can view equipment' },
    { key: 'VIEW_REPORTS', module: 'GENERAL', description: 'Can view reports' },
    { key: 'VIEW_PROFILE', module: 'USER', description: 'Can view own profile' }
];

const seedPermissions = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Drop old RolePermission collection to clear old indexes and data
        try {
            await mongoose.connection.db.dropCollection('rolepermissions');
            console.log('Dropped old rolepermissions collection');
        } catch (e) {
            console.log('rolepermissions collection did not exist or could not be dropped');
        }

        // Upsert Roles
        const createdRoles = {};
        for (const roleData of rolesData) {
            const role = await Role.findOneAndUpdate(
                { name: roleData.name },
                roleData,
                { upsert: true, new: true }
            );
            createdRoles[role.name] = role._id;
            console.log(`Role seeded: ${role.name}`);
        }

        // Upsert Permissions
        const createdPermissions = {};
        for (const permData of permissionsData) {
            const perm = await Permission.findOneAndUpdate(
                { key: permData.key },
                permData,
                { upsert: true, new: true }
            );
            createdPermissions[perm.key] = perm._id;
            console.log(`Permission seeded: ${perm.key}`);
        }

        // Default Role Permissions
        const rolePermMappings = {
            'SUPER_ADMIN': permissionsData.map(p => p.key),
            'COMPANY_OWNER': permissionsData.map(p => p.key),
            'PM': ['VIEW_DASHBOARD', 'VIEW_PROJECTS', 'VIEW_TASKS', 'VIEW_DAILY_LOGS', 'VIEW_PHOTOS', 'VIEW_CHAT', 'VIEW_RFI', 'VIEW_EQUIPMENT', 'VIEW_PO', 'VIEW_DRAWINGS', 'VIEW_ISSUES', 'VIEW_REPORTS'],
            'FOREMAN': ['VIEW_DASHBOARD', 'VIEW_PROJECTS', 'VIEW_TASKS', 'VIEW_DAILY_LOGS', 'VIEW_PHOTOS', 'VIEW_CHAT', 'VIEW_RFI', 'VIEW_EQUIPMENT', 'VIEW_DRAWINGS', 'VIEW_ISSUES', 'CLOCK_IN_CREW', 'VIEW_PROFILE'],
            'WORKER': ['VIEW_DASHBOARD', 'VIEW_TASKS', 'VIEW_CHAT', 'CLOCK_IN_OUT', 'VIEW_PHOTOS', 'VIEW_PROFILE'],
            'CLIENT': ['VIEW_DASHBOARD', 'VIEW_PROJECTS', 'VIEW_RFI', 'VIEW_PHOTOS', 'VIEW_DRAWINGS', 'VIEW_INVOICES', 'VIEW_PROFILE'],
            'SUBCONTRACTOR': ['VIEW_DASHBOARD', 'VIEW_PROJECTS', 'VIEW_TASKS', 'VIEW_RFI', 'VIEW_PHOTOS', 'VIEW_CHAT']
        };

        for (const [roleName, permissionKeys] of Object.entries(rolePermMappings)) {
            const roleId = createdRoles[roleName];
            for (const key of permissionKeys) {
                const permissionId = createdPermissions[key];
                if (roleId && permissionId) {
                    await RolePermission.findOneAndUpdate(
                        { roleId, permissionId },
                        { roleId, permissionId },
                        { upsert: true }
                    );
                }
            }
            console.log(`Permissions mapped for role: ${roleName}`);
        }

        console.log('Seeding completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
};

seedPermissions();

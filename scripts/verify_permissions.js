const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Role = require('../models/Role');
const Permission = require('../models/Permission');
const RolePermission = require('../models/RolePermission');
const UserPermission = require('../models/UserPermission');
const RFI = require('../models/RFI');
const Project = require('../models/Project');

dotenv.config();

const verify = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // 1. Create a test Project
        let companyId = new mongoose.Types.ObjectId(); // Temporary or find existing
        // For testing, let's find an existing company if any
        const existingUser = await User.findOne();
        if (existingUser) companyId = existingUser.companyId;

        const project = await Project.create({
            name: 'Test Permission Project',
            companyId,
            createdBy: existingUser?._id || new mongoose.Types.ObjectId()
        });
        console.log(`Project created: ${project.name}`);

        // 2. Create a Client user
        const clientRole = await Role.findOne({ name: 'CLIENT' });
        const clientUser = await User.create({
            fullName: 'Test Client',
            email: `client_${Date.now()}@test.com`,
            password: 'password123',
            role: 'CLIENT',
            roleId: clientRole._id,
            companyId,
            isActive: true
        });
        console.log(`Client user created: ${clientUser.email}`);

        // Update project with client
        project.clientId = clientUser._id;
        await project.save();

        // 3. Create an RFI for this project
        const rfi1 = await RFI.create({
            companyId,
            projectId: project._id,
            subject: 'Test RFI for Project 1',
            description: 'Visible to client',
            raisedBy: existingUser?._id || new mongoose.Types.ObjectId(),
            status: 'open'
        });
        console.log(`RFI 1 created for Project 1`);

        // 4. Create another project and RFI NOT for this client
        const project2 = await Project.create({
            name: 'Other Project',
            companyId,
            createdBy: existingUser?._id || new mongoose.Types.ObjectId()
        });
        const rfi2 = await RFI.create({
            companyId,
            projectId: project2._id,
            subject: 'Other RFI',
            description: 'NOT visible to client',
            raisedBy: existingUser?._id || new mongoose.Types.ObjectId(),
            status: 'open'
        });
        console.log(`RFI 2 created for Other Project`);

        console.log('\n--- VERIFICATION STEPS ---');
        console.log('1. Verify checkPermission for VIEW_RFI (Default Rolle)');
        const viewRfiPerm = await Permission.findOne({ key: 'VIEW_RFI' });
        const hasRolePerm = await RolePermission.findOne({ roleId: clientRole._id, permissionId: viewRfiPerm._id });
        console.log(`Client role has VIEW_RFI: ${!!hasRolePerm}`);

        console.log('2. Verify User Override (Revoke)');
        await UserPermission.create({
            userId: clientUser._id,
            permissionId: viewRfiPerm._id,
            isAllowed: false
        });
        console.log('Revoked VIEW_RFI for specific client user');

        // Cleanup
        console.log('\nCleanup: Deleting test data...');
        // await Project.findByIdAndDelete(project._id);
        // await Project.findByIdAndDelete(project2._id);
        // await RFI.findByIdAndDelete(rfi1._id);
        // await RFI.findByIdAndDelete(rfi2._id);
        // await User.findByIdAndDelete(clientUser._id);

        console.log('Done.');
        process.exit(0);
    } catch (error) {
        console.error('Verification failed:', error);
        process.exit(1);
    }
};

verify();

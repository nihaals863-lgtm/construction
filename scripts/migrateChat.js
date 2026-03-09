require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const ChatRoom = require('../models/ChatRoom');
const ChatParticipant = require('../models/ChatParticipant');
const connectDB = require('../config/db');

const migrate = async () => {
    try {
        await connectDB();
        console.log('Connected to DB for migration...');

        // 1. Create PROJECT_GROUP rooms for all projects
        const projects = await Project.find();
        console.log(`Found ${projects.length} projects to migrate.`);

        for (const project of projects) {
            // Check if room already exists
            let room = await ChatRoom.findOne({ projectId: project._id, roomType: 'PROJECT_GROUP' });
            if (!room) {
                room = await ChatRoom.create({
                    companyId: project.companyId,
                    projectId: project._id,
                    roomType: 'PROJECT_GROUP',
                    name: project.name,
                    isGroup: true
                });
                console.log(`Created group room for project: ${project.name}`);
            }

            // Add Participants (PM and Creator for now)
            const members = new Set();
            if (project.pmId) members.add(project.pmId.toString());
            if (project.createdBy) members.add(project.createdBy.toString());

            // Also add all Company Owners/Admins
            const staff = await User.find({
                companyId: project.companyId,
                role: { $in: ['COMPANY_OWNER', 'SUPER_ADMIN'] }
            });
            staff.forEach(s => members.add(s._id.toString()));

            for (const userId of members) {
                const user = await User.findById(userId);
                if (user) {
                    await ChatParticipant.findOneAndUpdate(
                        { roomId: room._id, userId: user._id },
                        {
                            companyId: project.companyId,
                            roleAtJoining: user.role,
                            lastReadAt: new Date(0)
                        },
                        { upsert: true }
                    );
                }
            }
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

migrate();

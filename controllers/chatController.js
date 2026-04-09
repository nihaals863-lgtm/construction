const Chat = require('../models/Chat');
const ChatRoom = require('../models/ChatRoom');
const ChatParticipant = require('../models/ChatParticipant');
const Project = require('../models/Project');
const User = require('../models/User');
const mongoose = require('mongoose');

// @desc    Get chat rooms for the current user
// @route   GET /api/chat
// @access  Private
const getChatRooms = async (req, res, next) => {
    try {
        const { _id, role } = req.user;

        // Fetch rooms where user is a participant
        const participants = await ChatParticipant.find({ userId: _id })
            .populate({
                path: 'roomId',
                populate: {
                    path: 'projectId',
                    select: 'name'
                }
            });

        const rooms = await Promise.all(participants.map(async (p) => {
            const room = p.roomId;
            if (!room) return null;

            // Get last message for preview
            const lastMessage = await Chat.findOne({ roomId: room._id })
                .sort({ createdAt: -1 })
                .populate('sender', 'fullName');

            // Count unread messages
            const unreadCount = await Chat.countDocuments({
                roomId: room._id,
                createdAt: { $gt: p.lastReadAt },
                sender: { $ne: _id }
            });

            // For Direct messages, get the other user's name
            let roomName = room.name || 'Chat Room';
            let avatar = null;
            let otherRole = null;
            let otherUserId = null;
            let hasClient = false;
            let hasSub = false;

            const allRoomParticipants = await ChatParticipant.find({ roomId: room._id });

            if (room.roomType === 'DIRECT') {
                const currentUserIdStr = _id.toString();
                const other = allRoomParticipants.find(p => p.userId.toString() !== currentUserIdStr);

                if (other) {
                    const otherUser = await User.findById(other.userId).select('fullName role avatar');
                    if (otherUser) {
                        roomName = otherUser.fullName;
                        avatar = otherUser.avatar;
                        otherRole = otherUser.role;
                        otherUserId = otherUser._id;
                    }
                }
            } else {
                // Check if group/project has client or sub
                hasClient = allRoomParticipants.some(p => p.roleAtJoining === 'CLIENT');
                hasSub = allRoomParticipants.some(p => p.roleAtJoining === 'SUBCONTRACTOR');
            }

            return {
                id: room._id,
                name: roomName,
                isGroup: room.isGroup,
                roomType: room.roomType,
                projectId: room.projectId?._id,
                projectName: room.projectId?.name,
                otherRole,
                otherUserId,
                hasClient,
                hasSub,
                lastMessage: lastMessage ? {
                    text: lastMessage.message,
                    sender: lastMessage.sender ? lastMessage.sender.fullName : 'Deleted User',
                    time: lastMessage.createdAt
                } : null,
                unreadCount,
                avatar
            };
        }));

        const sortedRooms = rooms
            .filter(r => r !== null)
            .sort((a, b) => {
                const timeA = a.lastMessage ? new Date(a.lastMessage.time) : new Date(0);
                const timeB = b.lastMessage ? new Date(b.lastMessage.time) : new Date(0);
                return timeB - timeA;
            });

        res.json(sortedRooms);
    } catch (error) {
        next(error);
    }
};

// @desc    Get messages for a specific room
// @route   GET /api/chat/:roomId
// @access  Private
const getRoomMessages = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const { _id } = req.user;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            res.status(400);
            return next(new Error('Invalid Room ID'));
        }

        // Verify participation
        const participant = await ChatParticipant.findOne({ roomId, userId: _id });
        if (!participant) {
            res.status(403);
            return next(new Error('You are not authorized to view this room'));
        }

        const messages = await Chat.find({ roomId })
            .sort({ createdAt: 1 })
            .populate('sender', 'fullName role avatar');

        res.json(messages);
    } catch (error) {
        next(error);
    }
};

// @desc    Send message to a room
// @route   POST /api/chat
// @access  Private
const sendMessage = async (req, res, next) => {
    try {
        const { roomId, message, attachments } = req.body;
        const { _id, companyId } = req.user;

        // Verify participation
        const participant = await ChatParticipant.findOne({ roomId, userId: _id });
        if (!participant) {
            res.status(403);
            return next(new Error('You are not authorized to send messages to this room'));
        }

        const chat = await Chat.create({
            companyId,
            sender: _id,
            roomId,
            message,
            attachments
        });

        const fullChat = await Chat.findById(chat._id).populate('sender', 'fullName role avatar');

        // Update sender's lastReadAt
        participant.lastReadAt = new Date();
        await participant.save();

        // Emit to room IMMEDIATELY for responsiveness
        const io = req.app.get('io');
        if (io) {
            io.to(roomId.toString()).emit('new_message', fullChat);
        }

        // Notify participants who/what room has a new message (Background)
        const notifyOthers = async () => {
            const allParticipants = await ChatParticipant.find({ roomId, userId: { $ne: _id } });
            allParticipants.forEach(p => {
                const targetUid = p.userId.toString();
                io.to(targetUid).emit('new_notification', {
                    type: 'chat',
                    roomId,
                    senderName: req.user.fullName
                });
            });
        };

        if (io) notifyOthers().catch(err => console.error('Notification sync error:', err));

        res.status(201).json(fullChat);
    } catch (error) {
        next(error);
    }
};

// @desc    Get total unread count for user
// @route   GET /api/chat/unread-count
// @access  Private
const getUnreadCount = async (req, res, next) => {
    try {
        const { _id } = req.user;
        const participants = await ChatParticipant.find({ userId: _id });

        let totalUnread = 0;
        for (const p of participants) {
            const count = await Chat.countDocuments({
                roomId: p.roomId,
                createdAt: { $gt: p.lastReadAt },
                sender: { $ne: _id }
            });
            totalUnread += count;
        }

        res.json({ count: totalUnread });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark room as read
// @route   PUT /api/chat/mark-read/:roomId
// @access  Private
const markAsRead = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const { _id } = req.user;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            res.status(400);
            return next(new Error('Invalid Room ID'));
        }

        const participant = await ChatParticipant.findOneAndUpdate(
            { roomId, userId: _id },
            { lastReadAt: new Date() },
            { new: true }
        );

        if (!participant) {
            res.status(404);
            return next(new Error('Participant record not found'));
        }

        res.json({ success: true, lastReadAt: participant.lastReadAt });
    } catch (error) {
        next(error);
    }
};

// @desc    Helper to create or get a direct chat room
// @route   POST /api/chat/direct
// @access  Private
const getOrCreateDirectRoom = async (req, res, next) => {
    try {
        const { targetUserId } = req.body;
        const { _id, companyId, role } = req.user;

        // Check if direct room already exists
        const existingParticipants = await ChatParticipant.aggregate([
            { $match: { userId: { $in: [new mongoose.Types.ObjectId(_id), new mongoose.Types.ObjectId(targetUserId)] } } },
            { $group: { _id: "$roomId", count: { $sum: 1 } } },
            { $match: { count: 2 } }
        ]);

        if (existingParticipants.length > 0) {
            for (const ep of existingParticipants) {
                const room = await ChatRoom.findOne({ _id: ep._id, roomType: 'DIRECT' });
                if (room) {
                    const targetUser = await User.findById(targetUserId).select('fullName role avatar');
                    return res.json({
                        id: room._id,
                        name: targetUser?.fullName || 'Chat',
                        roomType: 'DIRECT',
                        isGroup: false,
                        otherRole: targetUser?.role,
                        otherUserId: targetUser?._id,
                        avatar: targetUser?.avatar,
                        unreadCount: 0,
                        lastMessage: null
                    });
                }
            }
        }

        // Create new room
        const targetUser = await User.findById(targetUserId);
        if (!targetUser) return next(new Error('User not found'));

        // Restriction: Admins message anyone. 
        // PMs message Staff and Subs (NOT Clients).
        // Foreman/Workers message only internal.
        // Client/Subs message only Admins.
        const admins = ['COMPANY_OWNER', 'SUPER_ADMIN'];
        const internalRoles = ['COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'SUPER_ADMIN'];

        if (admins.includes(role)) {
            // Admin can message anyone
        } else if (role === 'PM') {
            // PM cannot message Clients
            if (targetUser.role === 'CLIENT') {
                res.status(403);
                return next(new Error('Project Managers are not permitted to initiate direct chats with Clients.'));
            }
        } else if (['FOREMAN', 'WORKER'].includes(role)) {
            // Foremen and Workers can only message internal team members
            if (!internalRoles.includes(targetUser.role)) {
                res.status(403);
                return next(new Error('Foreman and Workers are restricted to internal coordination only.'));
            }
        } else {
            // Requester is Client or Subcontractor
            if (!admins.includes(targetUser.role)) {
                res.status(403);
                return next(new Error('Clients and Subcontractors are only permitted to initiate direct chats with administrators.'));
            }
        }

        const room = await ChatRoom.create({
            companyId,
            roomType: 'DIRECT',
            isGroup: false
        });

        await ChatParticipant.create([
            { roomId: room._id, userId: _id, companyId, roleAtJoining: role },
            { roomId: room._id, userId: targetUserId, companyId, roleAtJoining: targetUser.role }
        ]);

        res.status(201).json({
            id: room._id,
            name: targetUser.fullName,
            roomType: 'DIRECT',
            isGroup: false,
            otherRole: targetUser.role,
            avatar: targetUser.avatar,
            otherUserId: targetUser._id,
            unreadCount: 0,
            lastMessage: null
        });
    } catch (error) {
        next(error);
    }
}

// @desc    Get all users in company for chat directory
// @route   GET /api/chat/users
// @access  Private
const getChatUsers = async (req, res, next) => {
    try {
        const { companyId, _id, role } = req.user;

        const admins = ['COMPANY_OWNER', 'SUPER_ADMIN'];
        const internalRoles = ['COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'SUPER_ADMIN'];
        let roleFilter = {};

        if (admins.includes(role)) {
            // Admins can see everyone
            roleFilter = {};
        } else if (role === 'PM') {
            // PMs can see everyone EXCEPT Clients
            roleFilter = { role: { $ne: 'CLIENT' } };
        } else if (['FOREMAN', 'WORKER'].includes(role)) {
            // Foreman/Worker only see internal
            roleFilter = { role: { $in: internalRoles } };
        } else {
            // Client/Sub only see Admins
            roleFilter = { role: { $in: admins } };
        }

        const users = await User.find({
            companyId,
            _id: { $ne: _id },
            isActive: true,
            ...roleFilter
        }).select('fullName role avatar email');

        res.json(users);
    } catch (error) {
        next(error);
    }
};

/**
 * Syncs all relevant project users into the project's chat room.
 * Including PM, Client, Creator, Foremen, and Workers.
 */
const syncProjectParticipants = async (projectId) => {
    try {
        const ChatRoom = require('../models/ChatRoom');
        const ChatParticipant = require('../models/ChatParticipant');
        const Project = require('../models/Project');
        const Job = require('../models/Job');
        const Task = require('../models/Task');
        const User = require('../models/User');

        const project = await Project.findById(projectId);
        if (!project) return;

        // Find or Create the PROJECT_GROUP room
        let room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
        if (!room) {
            room = await ChatRoom.create({
                companyId: project.companyId,
                projectId,
                roomType: 'PROJECT_GROUP',
                name: project.name,
                isGroup: true
            });
            console.log(`Created missing PROJECT_GROUP room for project: ${project.name}`);
        }

        // Collect all target user IDs
        const userIds = new Set();
        if (project.pmId) userIds.add(project.pmId.toString());
        if (project.clientId) userIds.add(project.clientId.toString());
        if (project.createdBy) userIds.add(project.createdBy.toString());

        // Add all Company Owners
        const owners = await User.find({
            companyId: project.companyId,
            role: 'COMPANY_OWNER',
            isActive: true
        }).select('_id');
        owners.forEach(o => userIds.add(o._id.toString()));

        // Jobs (Foremen & Workers)
        const jobs = await Job.find({ projectId }).select('foremanId assignedWorkers');
        jobs.forEach(j => {
            if (j.foremanId) userIds.add(j.foremanId.toString());
            if (j.assignedWorkers && Array.isArray(j.assignedWorkers)) {
                j.assignedWorkers.forEach(w => {
                    if (w) userIds.add(w.toString());
                });
            }
        });

        // Tasks (AssignedTo)
        const tasks = await Task.find({ projectId }).select('assignedTo');
        tasks.forEach(t => {
            if (t.assignedTo && Array.isArray(t.assignedTo)) {
                t.assignedTo.forEach(u => {
                    if (u) userIds.add(u.toString());
                });
            }
        });

        // Current participants
        const existingParticipants = await ChatParticipant.find({ roomId: room._id }).select('userId');
        const existingUserIds = new Set(existingParticipants.map(p => p.userId.toString()));

        // Users to add
        const toAddIds = [...userIds].filter(id => !existingUserIds.has(id));

        if (toAddIds.length > 0) {
            const users = await User.find({ _id: { $in: toAddIds } }).select('role fullName');
            const participantsToAdd = users.map(u => ({
                roomId: room._id,
                userId: u._id,
                companyId: project.companyId,
                roleAtJoining: u.role
            }));

            await ChatParticipant.insertMany(participantsToAdd);
            console.log(`Synced ${participantsToAdd.length} new participants to project room ${room.name}`);

            // Send a "System Message" to the room to announce new members (Optional beauty)
            const Chat = require('../models/Chat');
            const systemMsg = await Chat.create({
                companyId: project.companyId,
                roomId: room._id,
                sender: project.createdBy || users[0]._id, // Fallback to creator or first added
                message: `📢 Project Update: ${users.length} new member(s) joined the coordination frequency. Welcome ${users.map(u => u.fullName).join(', ')}!`,
                roomType: 'PROJECT_GROUP',
                isSystemMessage: true // We can add this flag to schema or just use a special sender if needed
            });

            // Emit via socket if io is available (optional, sync runs in background mostly)
            // But if triggered by a user action, we might have req.app.get('io')
            // For now, we rely on the next frontend fetch to see the message
        }
    } catch (error) {
        console.error('Error in syncProjectParticipants:', error);
    }
};

module.exports = {
    getChatRooms,
    getRoomMessages,
    sendMessage,
    getUnreadCount,
    markAsRead,
    getOrCreateDirectRoom,
    getChatUsers,
    syncProjectParticipants
};

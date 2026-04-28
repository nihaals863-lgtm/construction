const Chat = require('../models/Chat');
const ChatRoom = require('../models/ChatRoom');
const ChatParticipant = require('../models/ChatParticipant');
const Project = require('../models/Project');
const User = require('../models/User');
const mongoose = require('mongoose');

/** Find existing DIRECT room between two users, or null */
async function findExistingDirectRoomId(userIdA, userIdB) {
    const a = new mongoose.Types.ObjectId(userIdA);
    const b = new mongoose.Types.ObjectId(userIdB);
    const existingParticipants = await ChatParticipant.aggregate([
        { $match: { userId: { $in: [a, b] } } },
        { $group: { _id: '$roomId', count: { $sum: 1 } } },
        { $match: { count: 2 } }
    ]);
    for (const ep of existingParticipants) {
        const room = await ChatRoom.findOne({ _id: ep._id, roomType: 'DIRECT' });
        if (room) return room._id;
    }
    return null;
}

function assertDirectMessagingAllowed(role, targetUser) {
    const admins = ['COMPANY_OWNER', 'SUPER_ADMIN'];
    const internalRoles = ['COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'SUPER_ADMIN'];
    if (admins.includes(role)) return;
    if (role === 'PM') {
        // PMs may DM clients and internal staff (project coordination, photos, RFIs)
        return;
    }
    if (['FOREMAN', 'WORKER'].includes(role)) {
        if (!internalRoles.includes(targetUser.role)) {
            const e = new Error('Foreman and Workers are restricted to internal coordination only.');
            e.statusCode = 403;
            throw e;
        }
        return;
    }
    // Client or Subcontractor initiating — allow company admins and PMs
    const allowedTargetsForExternal = ['COMPANY_OWNER', 'SUPER_ADMIN', 'PM'];
    if (!allowedTargetsForExternal.includes(targetUser.role)) {
        const e = new Error('Clients and Subcontractors are only permitted to initiate direct chats with administrators or project managers.');
        e.statusCode = 403;
        throw e;
    }
}

/** Find or create DIRECT room; returns ChatRoom _id */
async function resolveDirectChatRoomId(req, peerUserId) {
    const { _id, companyId, role } = req.user;
    const existing = await findExistingDirectRoomId(_id, peerUserId);
    if (existing) return existing;

    const targetUser = await User.findById(peerUserId);
    if (!targetUser) {
        const e = new Error('User not found');
        e.statusCode = 404;
        throw e;
    }
    assertDirectMessagingAllowed(role, targetUser);

    const room = await ChatRoom.create({
        companyId,
        roomType: 'DIRECT',
        isGroup: false
    });
    await ChatParticipant.create([
        { roomId: room._id, userId: _id, companyId, roleAtJoining: role },
        { roomId: room._id, userId: peerUserId, companyId, roleAtJoining: targetUser.role }
    ]);
    return room._id;
}

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
        let { roomId } = req.params;
        const { _id, companyId, role } = req.user;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            res.status(400);
            return next(new Error('Invalid Room ID'));
        }

        // Mobile sends peer user id for DMs; resolve to DIRECT ChatRoom id
        let roomDoc = await ChatRoom.findById(roomId);
        if (!roomDoc) {
            const isProject = await Project.exists({ _id: roomId });
            if (!isProject) {
                const peerUser = await User.findById(roomId).select('_id');
                if (peerUser && peerUser._id.toString() !== _id.toString()) {
                    try {
                        const resolved = await resolveDirectChatRoomId(req, peerUser._id);
                        roomId = resolved.toString();
                    } catch (err) {
                        res.status(err.statusCode || 403);
                        return next(err);
                    }
                }
            }
        }

        // Verify participation — auto-join if legitimately assigned
        let participant = await ChatParticipant.findOne({ roomId, userId: _id });

        if (!participant) {
            // Attempt auto-join based on room type
            const room = await ChatRoom.findById(roomId);
            let shouldJoin = false;

            if (room) {
                if (room.roomType === 'DIRECT') {
                    const otherExists = await ChatParticipant.findOne({ roomId, userId: { $ne: _id } });
                    if (otherExists) shouldJoin = true;
                }

                if (room.roomType === 'PROJECT_GROUP' && room.projectId) {
                    const project = await Project.findById(room.projectId);
                    if (project) {
                        const isAdmin = ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(role);
                        const isPM = project.pmId?.toString() === _id.toString() || role === 'PM';
                        const isClient = project.clientId?.toString() === _id.toString();
                        const isCreator = project.createdBy?.toString() === _id.toString();

                        if (isAdmin || isPM || isClient || isCreator) {
                            shouldJoin = true;
                        } else {
                            const [Task, Job] = [require('../models/Task'), require('../models/Job')];
                            const taskAssigned = await Task.exists({ projectId: room.projectId, assignedTo: _id });
                            if (taskAssigned) {
                                shouldJoin = true;
                            } else {
                                const jobAssigned = await Job.exists({
                                    projectId: room.projectId,
                                    $or: [{ foremanId: _id }, { assignedWorkers: _id }, { subcontractorId: _id }]
                                });
                                if (jobAssigned) shouldJoin = true;
                            }
                        }
                    }
                }

                const internalRoles = ['COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'SUPER_ADMIN', 'ADMIN'];
                if (room.roomType === 'INTERNAL' && internalRoles.includes(role)) {
                    shouldJoin = true;
                }

                if (!shouldJoin && room.createdBy?.toString() === _id.toString()) {
                    shouldJoin = true;
                }

                if (shouldJoin) {
                    try {
                        participant = await ChatParticipant.create({
                            roomId, userId: _id, companyId,
                            roleAtJoining: role, lastReadAt: new Date()
                        });
                        console.log(`[Auto-Join Read] User ${_id} (${role}) joined room ${roomId} (${room.roomType})`);
                    } catch (syncErr) {
                        if (syncErr.code !== 11000) console.error('[Auto-Join Read Error]', syncErr.message);
                    }
                }
            }

            if (!participant && !shouldJoin) {
                res.status(403);
                return next(new Error('You are not authorized to view this room'));
            }
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
        let { roomId, message, attachments, projectId, receiverId } = req.body;
        const { _id, companyId, role } = req.user;

        // 1. SMART RESOLUTION (Project -> Room)
        if (roomId && !projectId && mongoose.Types.ObjectId.isValid(roomId)) {
            const projectExists = await Project.exists({ _id: roomId });
            if (projectExists) projectId = roomId;
        }

        // 2. SMART RESOLUTION (User -> Direct Room)
        // If frontend passes receiverId OR if roomId is actually a userId
        let targetUserId = receiverId;
        if (roomId && !targetUserId && mongoose.Types.ObjectId.isValid(roomId)) {
            const userExists = await User.exists({ _id: roomId });
            if (userExists) targetUserId = roomId;
        }

        let actualRoomId = roomId;

        // Resolve Project Group Room
        if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
            const room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
            if (room) actualRoomId = room._id;
        }

        // Resolve or Create Direct Room
        if (targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)) {
            const existingParticipants = await ChatParticipant.aggregate([
                { $match: { userId: { $in: [new mongoose.Types.ObjectId(_id), new mongoose.Types.ObjectId(targetUserId)] } } },
                { $group: { _id: "$roomId", count: { $sum: 1 } } },
                { $match: { count: 2 } }
            ]);

            let directRoom = null;
            if (existingParticipants.length > 0) {
                for (const ep of existingParticipants) {
                    directRoom = await ChatRoom.findOne({ _id: ep._id, roomType: 'DIRECT' });
                    if (directRoom) break;
                }
            }

            if (!directRoom) {
                // Check if internal roles can message each other
                const targetUser = await User.findById(targetUserId);
                if (targetUser) {
                    directRoom = await ChatRoom.create({ companyId, roomType: 'DIRECT', isGroup: false });
                    await ChatParticipant.create([
                        { roomId: directRoom._id, userId: _id, companyId, roleAtJoining: role },
                        { roomId: directRoom._id, userId: targetUserId, companyId, roleAtJoining: targetUser.role }
                    ]);
                }
            }

            if (directRoom) actualRoomId = directRoom._id;
        }

        if (!actualRoomId || !mongoose.Types.ObjectId.isValid(actualRoomId)) {
            res.status(400);
            return next(new Error('Valid Room ID, Project ID, or Receiver ID is required'));
        }

        // 2b. DIRECT: app lists team members by user id — roomId/receiverId may be peer user id, not ChatRoom id
        const preliminaryRoom = await ChatRoom.findById(actualRoomId);
        if (!preliminaryRoom) {
            const peerCandidate =
                receiverId && mongoose.Types.ObjectId.isValid(receiverId)
                    ? receiverId
                    : actualRoomId;
            if (peerCandidate && peerCandidate.toString() !== _id.toString()) {
                const isProject = await Project.exists({ _id: peerCandidate });
                if (!isProject) {
                    const peerUser = await User.findById(peerCandidate).select('_id');
                    if (peerUser) {
                        try {
                            actualRoomId = await resolveDirectChatRoomId(req, peerUser._id);
                        } catch (err) {
                            res.status(err.statusCode || 400);
                            return next(err);
                        }
                    }
                }
            }
        }

        // 3. AUTHORIZATION CHECK (Comprehensive — handles ALL room types)
        let isAuthorized = false;

        // A. Check explicit participation first (fastest path)
        let participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
        if (participant) {
            isAuthorized = true;
        }

        // B. If not a participant yet, attempt smart auto-join based on room type
        if (!isAuthorized) {
            const room = await ChatRoom.findById(actualRoomId);

            if (room) {
                // --- DIRECT ROOMS ---
                // If user was supposed to be in a direct room but participant record is missing,
                // re-add them. This handles edge cases where records were lost or not created.
                if (room.roomType === 'DIRECT') {
                    // For direct rooms, check if any other participant exists
                    const otherParticipant = await ChatParticipant.findOne({
                        roomId: actualRoomId,
                        userId: { $ne: _id }
                    });
                    // If room has another participant, this user should also be in it
                    if (otherParticipant) {
                        isAuthorized = true;
                    }
                }

                // --- PROJECT GROUP ROOMS ---
                if (room.roomType === 'PROJECT_GROUP' && room.projectId) {
                    const project = await Project.findById(room.projectId);
                    if (project) {
                        const isAdmin = ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(role);
                        const isPM = project.pmId?.toString() === _id.toString() || role === 'PM';
                        const isClient = project.clientId?.toString() === _id.toString();
                        const isCreator = project.createdBy?.toString() === _id.toString();

                        if (isAdmin || isPM || isClient || isCreator) {
                            isAuthorized = true;
                        } else {
                            // Check via tasks, jobs, or subcontractor assignment
                            const [Task, Job] = [require('../models/Task'), require('../models/Job')];
                            const taskAssigned = await Task.exists({ projectId: room.projectId, assignedTo: _id });
                            if (taskAssigned) {
                                isAuthorized = true;
                            } else {
                                const jobAssigned = await Job.exists({
                                    projectId: room.projectId,
                                    $or: [
                                        { foremanId: _id },
                                        { assignedWorkers: _id },
                                        { subcontractorId: _id }
                                    ]
                                });
                                if (jobAssigned) isAuthorized = true;
                            }
                        }
                    }
                }

                // --- INTERNAL COMPANY ROOMS ---
                const internalRoles = ['COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'SUPER_ADMIN', 'ADMIN'];
                if (room.roomType === 'INTERNAL' && internalRoles.includes(role)) {
                    isAuthorized = true;
                }

                // --- GENERIC ROOMS (custom groups, etc.) ---
                // If the user created the room, they should be authorized
                if (!isAuthorized && room.createdBy?.toString() === _id.toString()) {
                    isAuthorized = true;
                }

                // AUTO-JOIN: If authorized but not a participant, create the record now
                if (isAuthorized && !participant) {
                    try {
                        participant = await ChatParticipant.create({
                            roomId: actualRoomId,
                            userId: _id,
                            companyId,
                            roleAtJoining: role,
                            lastReadAt: new Date()
                        });
                        console.log(`[Auto-Join] User ${_id} (${role}) added to room ${actualRoomId} (${room.roomType})`);
                    } catch (syncErr) {
                        if (syncErr.code === 11000) {
                            participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
                        } else {
                            console.error('[Auto-Join Error]', syncErr.message);
                        }
                    }
                }
            }
        }

        if (!isAuthorized) {
            console.error(`[Chat Auth Failure] User ${_id} (${role}) unauthorized for room ${actualRoomId}`);
            res.status(403);
            return next(new Error('You are not authorized to send messages to this room'));
        }

        const roomForChat = await ChatRoom.findById(actualRoomId).select('roomType');
        const effectiveProjectId =
            roomForChat?.roomType === 'DIRECT' ? null : (projectId || null);

        // 4. CREATE MESSAGE
        const chat = await Chat.create({
            companyId,
            sender: _id,
            roomId: actualRoomId,
            projectId: effectiveProjectId,
            message,
            attachments
        });

        const fullChat = await Chat.findById(chat._id).populate('sender', 'fullName role avatar');

        if (!participant) {
            participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
        }

        // Update sender's lastReadAt if they are a participant
        if (participant) {
            participant.lastReadAt = new Date();
            await participant.save();
        }

        // 5. REAL-TIME EMISSION
        const io = req.app.get('io');
        if (io) {
            io.to(actualRoomId.toString()).emit('new_message', fullChat);

            // Background notifications
            const notifyOthers = async () => {
                const others = await ChatParticipant.find({ roomId: actualRoomId, userId: { $ne: _id } });
                others.forEach(p => {
                    io.to(p.userId.toString()).emit('new_notification', {
                        type: 'chat',
                        roomId: actualRoomId,
                        senderName: req.user.fullName
                    });
                });
            };
            notifyOthers().catch(err => console.error('Notification error:', err));
        }

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
        const { _id } = req.user;

        if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
            res.status(400);
            return next(new Error('Valid target user ID is required'));
        }

        const existingId = await findExistingDirectRoomId(_id, targetUserId);
        if (existingId) {
            const room = await ChatRoom.findById(existingId);
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

        let roomId;
        try {
            roomId = await resolveDirectChatRoomId(req, targetUserId);
        } catch (err) {
            res.status(err.statusCode || 403);
            return next(err);
        }

        const room = await ChatRoom.findById(roomId);
        const targetUser = await User.findById(targetUserId).select('fullName role avatar');
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
};

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
            // PMs can message anyone in the company (including clients)
            roleFilter = {};
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

        // Add all Company Admins and Owners
        const admins = await User.find({
            companyId: project.companyId,
            role: { $in: ['COMPANY_OWNER', 'ADMIN', 'SUPER_ADMIN'] },
            isActive: true
        }).select('_id');
        admins.forEach(a => userIds.add(a._id.toString()));

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

const Chat = require('../models/Chat');
const ChatRoom = require('../models/ChatRoom');
const ChatParticipant = require('../models/ChatParticipant');
const Project = require('../models/Project');
const User = require('../models/User');
const Task = require('../models/Task');
const Job = require('../models/Job');
const mongoose = require('mongoose');

const ADMIN_ROLES = ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN'];
const INTERNAL_ROLES = ['COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER', 'SUPER_ADMIN', 'ADMIN'];

/** Find existing DIRECT room between two users, or null */
async function findExistingDirectRoomId(userIdA, userIdB) {
    const a = new mongoose.Types.ObjectId(userIdA);
    const b = new mongoose.Types.ObjectId(userIdB);
    const existingParticipants = await ChatParticipant.aggregate([
        { $match: { userId: { $in: [a, b] } } },
        { $group: { _id: '$roomId', count: { $sum: 1 } } },
        { $match: { count: 2 } }
    ]);
    const directRooms = [];
    for (const ep of existingParticipants) {
        const room = await ChatRoom.findOne({ _id: ep._id, roomType: 'DIRECT', isActive: { $ne: false } });
        if (room) directRooms.push(room);
    }
    if (directRooms.length === 0) return null;

    directRooms.sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
    const canonical = directRooms[0];

    const pairKey = [String(userIdA), String(userIdB)].sort().join(':');
    if (!canonical.metadata || canonical.metadata.get('directPair') !== pairKey) {
        canonical.metadata = canonical.metadata || new Map();
        canonical.metadata.set('directPair', pairKey);
        await canonical.save();
    }
    return canonical._id;
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

    const pairKey = [String(_id), String(peerUserId)].sort().join(':');
    let room;
    try {
        room = await ChatRoom.create({
            companyId,
            roomType: 'DIRECT',
            isGroup: false,
            metadata: { directPair: pairKey }
        });
    } catch (createErr) {
        if (createErr?.code === 11000) {
            const existingByPair = await ChatRoom.findOne({
                companyId,
                roomType: 'DIRECT',
                isActive: { $ne: false },
                'metadata.directPair': pairKey
            }).select('_id');
            if (existingByPair?._id) return existingByPair._id;
        }
        throw createErr;
    }
    await ChatParticipant.create([
        { roomId: room._id, userId: _id, companyId, roleAtJoining: role },
        { roomId: room._id, userId: peerUserId, companyId, roleAtJoining: targetUser.role }
    ]);
    return room._id;
}

async function getPmScopedData(companyId, pmUserId) {
    const pmProjects = await Project.find({
        companyId,
        $or: [{ pmIds: pmUserId }, { pmId: pmUserId }, { createdBy: pmUserId }]
    }).select('_id');
    const projectIds = pmProjects.map((p) => p._id);
    const projectIdSet = new Set(projectIds.map((id) => id.toString()));

    if (projectIds.length === 0) {
        return { projectIds, projectIdSet, userIdSet: new Set() };
    }

    const [taskAssignedUsers, jobAssignments] = await Promise.all([
        Task.find({
            companyId,
            projectId: { $in: projectIds },
            assignedBy: pmUserId
        }).select('assignedTo'),
        Job.find({
            companyId,
            projectId: { $in: projectIds },
            createdBy: pmUserId
        }).select('foremanId assignedWorkers')
    ]);

    const userIdSet = new Set();
    taskAssignedUsers.forEach((task) => {
        (task.assignedTo || []).forEach((uid) => {
            if (uid) userIdSet.add(uid.toString());
        });
    });
    jobAssignments.forEach((job) => {
        if (job.foremanId) userIdSet.add(job.foremanId.toString());
        (job.assignedWorkers || []).forEach((uid) => {
            if (uid) userIdSet.add(uid.toString());
        });
    });

    return { projectIds, projectIdSet, userIdSet };
}

async function getUserChatScope(reqUser) {
    const companyId = reqUser.companyId;
    const userId = String(reqUser._id);
    const role = reqUser.role;
    const isAdmin = ADMIN_ROLES.includes(role);

    if (isAdmin) {
        const [projects, users] = await Promise.all([
            Project.find({ companyId }).select('_id').lean(),
            User.find({ companyId, _id: { $ne: reqUser._id }, isActive: true }).select('_id').lean()
        ]);
        return {
            isAdmin,
            hideInternal: false,
            projectIdSet: new Set(projects.map((p) => String(p._id))),
            directUserIdSet: new Set(users.map((u) => String(u._id)))
        };
    }

    if (role === 'PM') {
        const pmProjects = await Project.find({ 
            companyId, 
            $or: [{ pmIds: reqUser._id }, { pmId: reqUser._id }, { createdBy: reqUser._id }] 
        }).select('_id clientId').lean();
        
        const assignedClientIds = pmProjects.map(p => String(p.clientId)).filter(id => id && id !== 'undefined');
        const assignedProjectIds = pmProjects.map(p => String(p._id));

        const scopeUsers = await User.find({ 
            companyId, 
            isActive: true, 
            $or: [
                { role: { $in: ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN', 'PM', 'FOREMAN', 'WORKER', 'SUBCONTRACTOR'] } },
                { _id: { $in: assignedClientIds } }
            ]
        }).select('_id').lean();
        
        return {
            isAdmin: false,
            hideInternal: false,
            projectIdSet: new Set(assignedProjectIds),
            directUserIdSet: new Set(scopeUsers.map((u) => String(u._id)))
        };
    }

    const assignedProjectIds = new Set();
    const [ownedProjects, taskProjects, jobProjects] = await Promise.all([
        Project.find({ companyId, $or: [{ createdBy: reqUser._id }, { pmIds: reqUser._id }, { pmId: reqUser._id }, { clientId: reqUser._id }] }).select('_id').lean(),
        Task.find({ companyId, assignedTo: reqUser._id }).select('projectId').lean(),
        Job.find({
            companyId,
            $or: [{ foremanId: reqUser._id }, { assignedWorkers: reqUser._id }, { subcontractorId: reqUser._id }, { createdBy: reqUser._id }]
        }).select('projectId').lean()
    ]);
    ownedProjects.forEach((p) => p?._id && assignedProjectIds.add(String(p._id)));
    taskProjects.forEach((t) => t?.projectId && assignedProjectIds.add(String(t.projectId)));
    jobProjects.forEach((j) => j?.projectId && assignedProjectIds.add(String(j.projectId)));

    let directUsersQuery = { companyId, _id: { $ne: reqUser._id }, isActive: true };
    if (['FOREMAN', 'WORKER'].includes(role)) {
        directUsersQuery = { ...directUsersQuery, role: { $in: INTERNAL_ROLES } };
    } else if (role === 'SUBCONTRACTOR') {
        directUsersQuery = { ...directUsersQuery, role: { $in: ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN', 'PM'] } };
    } else if (role === 'CLIENT') {
        // Client only sees Admins + PMs assigned to their projects
        const clientProjects = await Project.find({ companyId, clientId: reqUser._id }).select('pmIds pmId createdBy').lean();
        const allowedPMIds = new Set();
        clientProjects.forEach(p => {
            if (p.pmIds && Array.isArray(p.pmIds)) {
                p.pmIds.forEach(id => allowedPMIds.add(String(id)));
            }
            if (p.pmId) allowedPMIds.add(String(p.pmId));
            if (p.createdBy) allowedPMIds.add(String(p.createdBy));
        });

        directUsersQuery = { 
            ...directUsersQuery, 
            $or: [
                { role: { $in: ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN'] } },
                { _id: { $in: Array.from(allowedPMIds) } }
            ]
        };
    }
    const directUsers = await User.find(directUsersQuery).select('_id').lean();

    return {
        isAdmin: false,
        hideInternal: false,
        projectIdSet: assignedProjectIds,
        directUserIdSet: new Set(directUsers.map((u) => String(u._id)))
    };
}

async function canUserAccessRoom(room, reqUser, scope) {
    if (!room) return false;
    const userId = String(reqUser._id);
    const role = reqUser.role;

    if (scope.isAdmin) return true;

    if (room.roomType === 'INTERNAL') return !scope.hideInternal && INTERNAL_ROLES.includes(role);

    if (room.roomType === 'PROJECT_GROUP') {
        const pid = room.projectId ? String(room.projectId) : null;
        return !!pid && scope.projectIdSet.has(pid);
    }

    if (room.roomType === 'DIRECT') {
        const participants = await ChatParticipant.find({ roomId: room._id }).select('userId');
        const other = participants.find((p) => String(p.userId) !== userId);
        return !!other && scope.directUserIdSet.has(String(other.userId));
    }

    return false;
}

// @desc    Get chat rooms for the current user
// @route   GET /api/chat
// @access  Private
const getChatRooms = async (req, res, next) => {
    try {
        const { _id, role } = req.user;
        const scope = await getUserChatScope(req.user);
        const userIdObj = new mongoose.Types.ObjectId(_id);

        const rooms = await ChatParticipant.aggregate([
            { $match: { userId: userIdObj } },
            {
                $lookup: {
                    from: 'chatrooms',
                    localField: 'roomId',
                    foreignField: '_id',
                    as: 'roomInfo'
                }
            },
            { $unwind: '$roomInfo' },
            {
                $lookup: {
                    from: 'projects',
                    localField: 'roomInfo.projectId',
                    foreignField: '_id',
                    as: 'projectInfo'
                }
            },
            {
                $addFields: {
                    project: { $arrayElemAt: ['$projectInfo', 0] }
                }
            },
            {
                $lookup: {
                    from: 'chatparticipants',
                    localField: 'roomId',
                    foreignField: 'roomId',
                    as: 'allParticipants'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    let: { 
                        participants: '$allParticipants',
                        me: userIdObj,
                        roomType: '$roomInfo.roomType'
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$$roomType', 'DIRECT'] },
                                        { $in: ['$_id', '$$participants.userId'] },
                                        { $ne: ['$_id', '$$me'] }
                                    ]
                                }
                            }
                        },
                        { $project: { fullName: 1, role: 1, avatar: 1 } },
                        { $limit: 1 }
                    ],
                    as: 'otherUserArr'
                }
            },
            {
                $addFields: {
                    otherUserDoc: { $arrayElemAt: ['$otherUserArr', 0] }
                }
            },
            {
                $lookup: {
                    from: 'chats',
                    let: { rId: '$roomId', lra: '$lastReadAt', me: userIdObj },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$roomId', '$$rId'] },
                                        { $gt: ['$createdAt', '$$lra'] },
                                        { $ne: ['$sender', '$$me'] }
                                    ]
                                }
                            }
                        },
                        { $count: 'count' }
                    ],
                    as: 'unreadCountArr'
                }
            },
            {
                $lookup: {
                    from: 'chats',
                    let: { rId: '$roomId' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$roomId', '$$rId'] } } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'sender',
                                foreignField: '_id',
                                as: 'senderInfo'
                            }
                        },
                        { $unwind: { path: '$senderInfo', preserveNullAndEmptyArrays: true } }
                    ],
                    as: 'lastMessageArr'
                }
            },
            {
                $addFields: {
                    lastMessageDoc: { $arrayElemAt: ['$lastMessageArr', 0] }
                }
            },
            {
                $project: {
                    id: '$roomId',
                    roomType: '$roomInfo.roomType',
                    isGroup: '$roomInfo.isGroup',
                    name: {
                        $cond: {
                            if: { $eq: ['$roomInfo.roomType', 'DIRECT'] },
                            then: { $ifNull: ['$otherUserDoc.fullName', 'Direct Chat'] },
                            else: { $ifNull: ['$roomInfo.name', 'Chat Room'] }
                        }
                    },
                    avatar: '$otherUserDoc.avatar',
                    otherRole: '$otherUserDoc.role',
                    otherUserId: '$otherUserDoc._id',
                    unreadCount: { $ifNull: [{ $arrayElemAt: ['$unreadCountArr.count', 0] }, 0] },
                    lastMessage: {
                        $cond: {
                            if: { $gt: [{ $size: '$lastMessageArr' }, 0] },
                            then: {
                                text: '$lastMessageDoc.message',
                                sender: '$lastMessageDoc.senderInfo.fullName',
                                time: '$lastMessageDoc.createdAt'
                            },
                            else: null
                        }
                    },
                    projectName: '$project.name',
                    projectId: '$project._id',
                    hasClient: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: '$allParticipants',
                                        as: 'part',
                                        cond: { $eq: ['$$part.roleAtJoining', 'CLIENT'] }
                                    }
                                }
                            },
                            0
                        ]
                    },
                    hasSub: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: '$allParticipants',
                                        as: 'part',
                                        cond: { $eq: ['$$part.roleAtJoining', 'SUBCONTRACTOR'] }
                                    }
                                }
                            },
                            0
                        ]
                    }
                }
            }
        ]);

        let filteredRooms = rooms.filter((room) => {
            if (!room) return false;
            if (room.roomType === 'INTERNAL' && scope.hideInternal) return false;
            if (room.roomType === 'PROJECT_GROUP') return room.projectId && scope.projectIdSet.has(String(room.projectId));
            if (room.roomType === 'DIRECT') return room.otherUserId && scope.directUserIdSet.has(String(room.otherUserId));
            return scope.isAdmin;
        });

        // VIRTUAL ROOMS FOR PM: Show all clients even if no active room exists
        if (role === 'PM') {
            const accessibleClientIds = Array.from(scope.directUserIdSet);
            const allClients = await User.find({ 
                _id: { $in: accessibleClientIds }, 
                role: 'CLIENT', 
                isActive: true 
            }).select('fullName role avatar').lean();

            for (const client of allClients) {
                const alreadyIn = filteredRooms.some(r => r.roomType === 'DIRECT' && String(r.otherUserId) === String(client._id));
                if (!alreadyIn) {
                    filteredRooms.push({
                        id: client._id,
                        name: client.fullName,
                        isGroup: false,
                        roomType: 'DIRECT',
                        otherRole: 'CLIENT',
                        otherUserId: client._id,
                        lastMessage: null,
                        unreadCount: 0,
                        avatar: client.avatar,
                        virtual: true
                    });
                }
            }
        }

        const sortedRooms = filteredRooms.sort((a, b) => {
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

        // 1. Parallel execution of baseline checks to minimize DB roundtrips
        const [roomDoc, participantDoc, isProject] = await Promise.all([
            ChatRoom.findById(roomId).lean(),
            ChatParticipant.findOne({ roomId, userId: _id }).lean(),
            Project.exists({ _id: roomId })
        ]);

        let finalRoomId = roomId;
        let participant = participantDoc;

        if (isProject) {
            const projectRoom = await ChatRoom.findOne({ projectId: roomId, roomType: 'PROJECT_GROUP' }).lean();
            if (projectRoom) {
                finalRoomId = projectRoom._id.toString();
                participant = await ChatParticipant.findOne({ roomId: finalRoomId, userId: _id }).lean();
            }
        } else if (!roomDoc) {
            // Check if it's a peer user ID (DM resolving)
            const peerUser = await User.findById(roomId).select('_id').lean();
            if (peerUser && peerUser._id.toString() !== _id.toString()) {
                try {
                    const resolved = await resolveDirectChatRoomId(req, peerUser._id);
                    finalRoomId = resolved.toString();
                    // Fetch participant for the newly resolved room
                    participant = await ChatParticipant.findOne({ roomId: finalRoomId, userId: _id }).lean();
                } catch (err) {
                    res.status(err.statusCode || 403);
                    return next(err);
                }
            }
        }

        // 2. Access control and auto-join
        if (!participant) {
            const scope = await getUserChatScope(req.user);
            const room = roomDoc || await ChatRoom.findById(finalRoomId).lean();
            let shouldJoin = false;

            if (room) {
                shouldJoin = await canUserAccessRoom(room, req.user, scope);
                if (shouldJoin) {
                    try {
                        participant = await ChatParticipant.create({
                            roomId: finalRoomId, userId: _id, companyId,
                            roleAtJoining: role, lastReadAt: new Date()
                        });
                        console.log(`[Auto-Join Read] User ${_id} (${role}) joined room ${finalRoomId} (${room.roomType})`);
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

        const limitVal = parseInt(req.query.limit) || 20;
        const beforeVal = req.query.before;
        const afterVal = req.query.after;

        const query = { roomId: finalRoomId };
        if (beforeVal) {
            query.createdAt = { $lt: new Date(beforeVal) };
        } else if (afterVal) {
            query.createdAt = { $gt: new Date(afterVal) };
        }

        const messages = await Chat.find(query)
            .sort({ createdAt: -1 })
            .limit(limitVal)
            .populate('sender', 'fullName role avatar')
            .lean(); // Speed up response processing

        res.json(messages.reverse());
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
            const resolvedDirectRoomId = await resolveDirectChatRoomId(req, targetUserId);
            if (resolvedDirectRoomId) actualRoomId = resolvedDirectRoomId;
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
        let roomType = 'DIRECT';
        let resolvedProjectId = projectId;

        // A. Check explicit participation first (fastest path — avoids 4-5 expensive database queries)
        let participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id })
            .populate('roomId', 'roomType projectId');

        if (participant) {
            isAuthorized = true;
            if (participant.roomId) {
                roomType = participant.roomId.roomType;
                resolvedProjectId = participant.roomId.projectId || resolvedProjectId;
            }
        }

        // B. If not a participant yet, attempt smart auto-join based on room type
        if (!isAuthorized) {
            const scope = await getUserChatScope(req.user);
            const room = await ChatRoom.findById(actualRoomId);

            if (room) {
                isAuthorized = await canUserAccessRoom(room, req.user, scope);
                roomType = room.roomType;
                resolvedProjectId = room.projectId || resolvedProjectId;

                // AUTO-JOIN: If authorized but not a participant, create the record now
                if (isAuthorized) {
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

        const effectiveProjectId = roomType === 'DIRECT' ? null : (resolvedProjectId || null);

        // 4. CREATE MESSAGE
        const chat = await Chat.create({
            companyId,
            sender: _id,
            roomId: actualRoomId,
            projectId: effectiveProjectId,
            message,
            attachments
        });

        // Construct full chat payload in-memory using req.user details to save another MongoDB lookup
        const fullChat = {
            ...chat.toObject(),
            sender: {
                _id: req.user._id,
                fullName: req.user.fullName,
                role: req.user.role,
                avatar: req.user.avatar
            }
        };

        // Update sender's lastReadAt asynchronously (non-blocking for HTTP response)
        if (participant) {
            participant.lastReadAt = new Date();
            participant.save().catch(err => console.error('[lastReadAt Update Error]', err.message));
        }

        // 5. REAL-TIME EMISSION
        const io = req.app.get('io');
        if (io) {
            io.to(actualRoomId.toString()).emit('new_message', fullChat);

            // Background notifications
            const notifyOthers = async () => {
                const others = await ChatParticipant.find({ roomId: actualRoomId, userId: { $ne: _id } });
                
                // Real-time socket notification
                others.forEach(p => {
                    io.to(p.userId.toString()).emit('new_notification', {
                        type: 'chat',
                        roomId: actualRoomId,
                        senderName: req.user.fullName
                    });
                });

                // Send Firebase push notifications for offline/closed clients
                const otherUserIds = others.map(p => p.userId);
                if (otherUserIds.length > 0) {
                    const senderName = req.user.fullName || 'Someone';
                    const notificationTitle = `New message from ${senderName}`;
                    const notificationBody = message || 'Sent an attachment';
                    
                    try {
                        const { sendPushNotification } = require('../utils/fcmHelper');
                        await sendPushNotification(
                            otherUserIds,
                            notificationTitle,
                            notificationBody,
                            {
                                roomId: actualRoomId.toString(),
                                type: 'chat',
                                senderId: _id.toString(),
                                senderName
                            },
                            io
                        );
                    } catch (fcmErr) {
                        console.error('[FCM chatController Error]', fcmErr.message);
                    }
                }
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
        const { _id, role } = req.user;
        const scope = await getUserChatScope(req.user);
        const participants = await ChatParticipant.find({ userId: _id }).populate('roomId');

        let totalUnread = 0;
        for (const p of participants) {
            const room = p.roomId;
            if (!room || !room.isActive) continue;

            // Scoping logic to match getChatRooms
            let isAuthorized = false;
            if (scope.isAdmin) {
                isAuthorized = true;
            } else if (room.roomType === 'INTERNAL') {
                isAuthorized = !scope.hideInternal && INTERNAL_ROLES.includes(role);
            } else if (room.roomType === 'PROJECT_GROUP') {
                isAuthorized = room.projectId && scope.projectIdSet.has(String(room.projectId));
            } else if (room.roomType === 'DIRECT') {
                const pair = room.metadata?.get ? room.metadata.get('directPair') : room.metadata?.directPair;
                if (pair) {
                    const otherId = pair.split(':').find(id => id !== String(_id));
                    if (otherId && scope.directUserIdSet.has(otherId)) {
                        isAuthorized = true;
                    }
                } else {
                    const others = await ChatParticipant.findOne({ roomId: room._id, userId: { $ne: _id } });
                    if (others && scope.directUserIdSet.has(String(others.userId))) {
                        isAuthorized = true;
                    }
                }
            }

            if (isAuthorized) {
                const count = await Chat.countDocuments({
                    roomId: room._id,
                    createdAt: { $gt: p.lastReadAt },
                    sender: { $ne: _id }
                });
                totalUnread += count;
            }
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

        // Notify the user to refresh their sidebar/navbar badges
        const io = req.app.get('io');
        if (io) {
            io.to(_id.toString()).emit('unread_count_updated');
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
        const scope = await getUserChatScope(req.user);

        if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
            res.status(400);
            return next(new Error('Valid target user ID is required'));
        }

        if (!scope.isAdmin && !scope.directUserIdSet.has(String(targetUserId))) {
            res.status(403);
            return next(new Error('You are not allowed to chat with this user'));
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
        const { companyId, _id } = req.user;
        const scope = await getUserChatScope(req.user);

        const usersQuery = {
            companyId,
            _id: { $ne: _id },
            isActive: true
        };

        if (!scope.isAdmin) {
            usersQuery._id = { $in: Array.from(scope.directUserIdSet) };
        }

        const users = await User.find(usersQuery).select('fullName role avatar email');
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
        if (project.pmIds && Array.isArray(project.pmIds)) {
            project.pmIds.forEach(id => userIds.add(id.toString()));
        }
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

// @desc    Update message attachments (e.g. resolve upload placeholder)
// @route   PATCH /api/chat/:messageId/attachments
// @access  Private
const updateMessageAttachments = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const { attachments } = req.body;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            res.status(400);
            return next(new Error('Invalid Message ID'));
        }

        const chat = await Chat.findById(messageId);
        if (!chat) {
            res.status(404);
            return next(new Error('Message not found'));
        }

        // Verify authorization (only sender can update their message attachments)
        if (chat.sender.toString() !== userId.toString()) {
            res.status(403);
            return next(new Error('You are not authorized to update this message'));
        }

        // Update attachments
        chat.attachments = attachments || [];
        await chat.save();

        const fullChat = await Chat.findById(chat._id).populate('sender', 'fullName role avatar');

        // Real-time Socket.IO emission
        const io = req.app.get('io');
        if (io) {
            io.to(chat.roomId.toString()).emit('message_updated', fullChat);
        }

        res.json(fullChat);
    } catch (error) {
        next(error);
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
    syncProjectParticipants,
    getUserChatScope,
    updateMessageAttachments
};

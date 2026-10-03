const Chat = require('../models/Chat');
const ChatRoom = require('../models/ChatRoom');
const ChatParticipant = require('../models/ChatParticipant');
const Project = require('../models/Project');
const User = require('../models/User');
const Task = require('../models/Task');
const Job = require('../models/Job');
const mongoose = require('mongoose');
const {
    resolveCanonicalUserId,
    getClusterUserIds,
    isAliasUser,
    resolveCanonicalContacts
} = require('../services/chatIdentityService');

const ADMIN_ROLES = ['COMPANY_OWNER', 'SUPER_ADMIN', 'ADMIN'];
const HIERARCHY_RANKS = {
    'SUPER_ADMIN': 6,
    'COMPANY_OWNER': 5,
    'ADMIN': 5,
    'PM': 4,
    'ENGINEER': 3.5,
    'FOREMAN': 3,
    'SUBCONTRACTOR': 2,
    'WORKER': 1,
    'CLIENT': 0
};

// Recent message idempotency cache to prevent duplicate inserts on quick retries or concurrent clicks (TTL: 60s)
const recentMessageIdempotencyMap = new Map();
const dedupCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [key, entry] of recentMessageIdempotencyMap.entries()) {
        const ts = entry?.timestamp || entry;
        if (ts < cutoff) recentMessageIdempotencyMap.delete(key);
    }
}, 30000);
if (dedupCleanupTimer && typeof dedupCleanupTimer.unref === 'function') {
    dedupCleanupTimer.unref();
}

/**
 * Dynamically resolves all active project IDs and names associated with a user
 */
async function getUserProjectScope(userId, companyId, role) {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const companyIdObj = new mongoose.Types.ObjectId(companyId);
    const isAdmin = ADMIN_ROLES.includes(role);

    if (isAdmin) {
        return { isAdmin: true, projectIdSet: new Set(), projectNamesMap: new Map() };
    }

    if (role === 'PM') {
        const pmProjects = await Project.find({
            companyId: companyIdObj,
            $or: [{ pmIds: userIdObj }, { pmId: userIdObj }, { createdBy: userIdObj }]
        }).select('_id name').lean();
        const projectIdSet = new Set(pmProjects.map(p => String(p._id)));
        const projectNamesMap = new Map(pmProjects.map(p => [String(p._id), p.name || 'Untitled Project']));
        return { isAdmin: false, projectIdSet, projectNamesMap };
    }

    const projectIdSet = new Set();
    const projectNamesMap = new Map();

    const [ownedProjects, taskDocs, jobDocs] = await Promise.all([
        Project.find({
            companyId: companyIdObj,
            $or: [{ createdBy: userIdObj }, { pmIds: userIdObj }, { pmId: userIdObj }, { clientId: userIdObj }]
        }).select('_id name').lean(),
        Task.find({ companyId: companyIdObj, assignedTo: userIdObj }).select('projectId').populate('projectId', 'name').lean(),
        Job.find({
            companyId: companyIdObj,
            $or: [{ foremanId: userIdObj }, { assignedWorkers: userIdObj }, { subcontractorId: userIdObj }, { createdBy: userIdObj }]
        }).select('projectId').populate('projectId', 'name').lean()
    ]);

    ownedProjects.forEach(p => {
        if (p?._id) {
            const sid = String(p._id);
            projectIdSet.add(sid);
            if (p.name) projectNamesMap.set(sid, p.name);
        }
    });

    taskDocs.forEach(t => {
        if (t?.projectId?._id) {
            const sid = String(t.projectId._id);
            projectIdSet.add(sid);
            if (t.projectId.name) projectNamesMap.set(sid, t.projectId.name);
        } else if (t?.projectId) {
            projectIdSet.add(String(t.projectId));
        }
    });

    jobDocs.forEach(j => {
        if (j?.projectId?._id) {
            const sid = String(j.projectId._id);
            projectIdSet.add(sid);
            if (j.projectId.name) projectNamesMap.set(sid, j.projectId.name);
        } else if (j?.projectId) {
            projectIdSet.add(String(j.projectId));
        }
    });

    return { isAdmin: false, projectIdSet, projectNamesMap };
}

/**
 * Helper to get user chat scope object from user request object
 */
async function getUserChatScope(userObj) {
    if (!userObj) return { isAdmin: false, projectIdSet: new Set(), projectNamesMap: new Map() };
    const { _id, companyId, role } = userObj;
    return await getUserProjectScope(_id, companyId, role);
}

/**
 * Validates role-to-role and project-scoped hierarchy rules
 * Server-authoritative permission resolver
 */
async function assertHierarchyMessagingAllowed(initiator, targetUser, initiatorScope = null) {
    if (!targetUser) {
        return { allowed: false, reason: 'Target user does not exist.' };
    }

    if (String(initiator._id) === String(targetUser._id)) {
        return { allowed: false, reason: 'Cannot initiate a private conversation with yourself.' };
    }

    // Tenant Boundary check (Super Admin restricted to explicit company scope)
    if (String(initiator.companyId) !== String(targetUser.companyId)) {
        return { allowed: false, reason: 'Cross-tenant private messaging is strictly prohibited.' };
    }

    if (!targetUser.isActive) {
        return { allowed: false, reason: 'Target user account is inactive.' };
    }

    const initRole = initiator.role;
    const targRole = targetUser.role;

    // 1. COMPANY ADMIN / COMPANY OWNER: Company-wide authority over all roles
    if (ADMIN_ROLES.includes(initRole)) {
        return { allowed: true, sharedProjectIds: [], sharedProjectNames: [] };
    }

    // Target is an Admin: All staff may communicate upward with company leadership
    if (ADMIN_ROLES.includes(targRole)) {
        return { allowed: true, sharedProjectIds: [], sharedProjectNames: [] };
    }

    // Resolve initiator project scope if not supplied
    const initScope = initiatorScope || await getUserProjectScope(initiator._id, initiator.companyId, initRole);

    // Resolve target project scope
    const targetScope = await getUserProjectScope(targetUser._id, targetUser.companyId, targRole);

    // Calculate shared projects
    const sharedProjectIds = [...initScope.projectIdSet].filter(pid => targetScope.projectIdSet.has(pid));
    const sharedProjectNames = sharedProjectIds
        .map(pid => initScope.projectNamesMap.get(pid) || targetScope.projectNamesMap.get(pid))
        .filter(Boolean);

    // 2. PROJECT MANAGER (PM)
    if (initRole === 'PM') {
        // PM to PM (Lateral in same company)
        if (targRole === 'PM') {
            return { allowed: true, sharedProjectIds, sharedProjectNames };
        }
        // PM to subordinates (Engineer, Foreman, Subcontractor, Worker)
        if (['ENGINEER', 'FOREMAN', 'SUBCONTRACTOR', 'WORKER'].includes(targRole)) {
            if (sharedProjectIds.length > 0) {
                return { allowed: true, sharedProjectIds, sharedProjectNames };
            }
            return { allowed: false, reason: 'Project Managers may only message staff assigned to their active projects.' };
        }
    }

    // 3. ENGINEER
    if (initRole === 'ENGINEER') {
        if (['PM', 'FOREMAN'].includes(targRole)) {
            if (sharedProjectIds.length > 0) {
                return { allowed: true, sharedProjectIds, sharedProjectNames };
            }
            return { allowed: false, reason: 'Engineers may only message PMs and Foremen assigned to their shared projects.' };
        }
    }

    // 4. FOREMAN
    if (initRole === 'FOREMAN') {
        if (['PM', 'FOREMAN', 'SUBCONTRACTOR', 'WORKER'].includes(targRole)) {
            if (sharedProjectIds.length > 0) {
                return { allowed: true, sharedProjectIds, sharedProjectNames };
            }
            return { allowed: false, reason: 'Foremen may only message team members assigned to their shared projects.' };
        }
    }

    // 5. SUBCONTRACTOR
    if (initRole === 'SUBCONTRACTOR') {
        if (targRole === 'SUBCONTRACTOR') {
            return { allowed: false, reason: 'Subcontractors cannot message other subcontractors.' };
        }
        if (['PM', 'FOREMAN', 'WORKER'].includes(targRole)) {
            if (sharedProjectIds.length > 0) {
                return { allowed: true, sharedProjectIds, sharedProjectNames };
            }
            return { allowed: false, reason: 'Subcontractors may only message assigned supervisors or workers on their shared projects.' };
        }
    }

    // 6. WORKER
    if (initRole === 'WORKER') {
        if (targRole === 'WORKER') {
            return { allowed: false, reason: 'Workers cannot initiate private chats with other workers. Please use the Project Group Chat.' };
        }
        if (['PM', 'FOREMAN', 'SUBCONTRACTOR'].includes(targRole)) {
            if (sharedProjectIds.length > 0) {
                return { allowed: true, sharedProjectIds, sharedProjectNames };
            }
            return { allowed: false, reason: 'Workers may only message Foremen, Subcontractors, and PMs assigned to their active projects.' };
        }
    }

    // 7. CLIENT
    if (initRole === 'CLIENT') {
        if (targRole === 'PM') {
            if (sharedProjectIds.length > 0) {
                return { allowed: true, sharedProjectIds, sharedProjectNames };
            }
        }
        return { allowed: false, reason: 'Clients may only communicate with company leadership or assigned project managers.' };
    }

    return { allowed: false, reason: 'Communication between these roles is not permitted under organizational hierarchy policy.' };
}

/**
 * Checks whether user can access a specific room
 */
async function canUserAccessRoom(room, reqUser, scope) {
    if (!room) return false;
    if (scope.isAdmin) return true;

    if (room.roomType === 'PROJECT_GROUP') {
        const pid = room.projectId ? String(room.projectId) : null;
        return !!pid && scope.projectIdSet.has(pid);
    }

    if (room.roomType === 'DIRECT') {
        const isParticipant = await ChatParticipant.exists({
            roomId: room._id,
            userId: reqUser._id
        });
        return !!isParticipant;
    }

    return false;
}

// @desc    Search authorized users in hierarchy for private messaging
// @route   GET /api/chat/hierarchy-users
// @access  Private
const getHierarchyUsers = async (req, res, next) => {
    try {
        const { q, page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
        const io = req.app.get('io');

        const initiatorScope = await getUserProjectScope(req.user._id, req.user.companyId, req.user.role);

        const candidateFilter = {
            companyId: req.user.companyId,
            isActive: { $ne: false },
            _id: { $ne: req.user._id }
        };

        if (q && q.trim()) {
            const sanitized = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(sanitized, 'i');
            candidateFilter.$or = [
                { fullName: regex },
                { email: regex },
                { phone: regex },
                { role: regex }
            ];
        }

        const candidates = await User.find(candidateFilter)
            .select('_id fullName email role avatar phone companyId isActive')
            .lean();

        const authorizedUsers = [];

        for (const candidate of candidates) {
            const check = await assertHierarchyMessagingAllowed(req.user, candidate, initiatorScope);
            if (check.allowed) {
                let isOnline = false;
                if (io) {
                    const sockets = io.sockets.adapter.rooms.get(candidate._id.toString());
                    isOnline = sockets && sockets.size > 0;
                }

                authorizedUsers.push({
                    _id: candidate._id,
                    fullName: candidate.fullName,
                    role: candidate.role,
                    avatar: candidate.avatar || null,
                    email: candidate.email || null,
                    phone: candidate.phone || null,
                    sharedProjects: check.sharedProjectNames || [],
                    isOnline: !!isOnline
                });
            }
        }

        // Resolve canonical identities across verified duplicate clusters within company boundaries
        const uniqueAuthorizedUsers = resolveCanonicalContacts(authorizedUsers, req.user.companyId);

        // Sort authorized users by hierarchy rank descending, then alphabetical
        uniqueAuthorizedUsers.sort((a, b) => {
            const rankDiff = (HIERARCHY_RANKS[b.role] || 0) - (HIERARCHY_RANKS[a.role] || 0);
            if (rankDiff !== 0) return rankDiff;
            return a.fullName.localeCompare(b.fullName);
        });

        const total = uniqueAuthorizedUsers.length;
        const startIndex = (pageNum - 1) * limitNum;
        const paginatedUsers = uniqueAuthorizedUsers.slice(startIndex, startIndex + limitNum);

        res.json({
            users: paginatedUsers,
            total,
            page: pageNum,
            limit: limitNum,
            hasMore: startIndex + limitNum < total
        });
    } catch (error) {
        next(error);
    }
};

// Concurrency-safe in-flight promise cache for direct room creation
const inFlightDirectRoomPromises = new Map();

// @desc    Find or create canonical DIRECT chat room between authorized users
// @route   POST /api/chat/direct
// @access  Private
const getOrCreateDirectRoom = async (req, res, next) => {
    try {
        const { targetUserId } = req.body;
        if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ message: 'Valid target user ID is required.' });
        }

        // Authoritatively resolve target user ID to canonical user ID within company boundaries
        const canonicalTargetId = resolveCanonicalUserId(targetUserId, req.user.companyId);

        const targetUser = await User.findById(canonicalTargetId).lean();
        if (!targetUser) {
            return res.status(404).json({ message: 'Target user not found.' });
        }

        const check = await assertHierarchyMessagingAllowed(req.user, targetUser);
        if (!check.allowed) {
            return res.status(403).json({ message: check.reason });
        }

        const pairKey = [String(req.user._id), String(canonicalTargetId)].sort().join(':');

        // Concurrency Lock: If already creating this direct pair in-flight, await the same promise
        if (inFlightDirectRoomPromises.has(pairKey)) {
            const room = await inFlightDirectRoomPromises.get(pairKey);
            const io = req.app?.get ? req.app.get('io') : null;
            const isOnline = io ? (io.sockets.adapter.rooms.get(canonicalTargetId.toString())?.size > 0) : false;
            return res.status(200).json({
                id: room._id,
                _id: room._id,
                roomType: 'DIRECT',
                name: targetUser.fullName,
                avatar: targetUser.avatar || null,
                otherUserId: targetUser._id,
                otherRole: targetUser.role,
                isOnline: !!isOnline,
                sharedProjects: check.sharedProjectNames || []
            });
        }

        const creationPromise = (async () => {
            // 1. Search by directPair key with canonical pair
            let room = await ChatRoom.findOne({
                companyId: req.user.companyId,
                roomType: 'DIRECT',
                isActive: { $ne: false },
                'metadata.directPair': pairKey
            }).sort({ createdAt: 1 });

            // 2. Fallback for historical rooms where metadata.directPair was not stamped
            if (!room) {
                const u1 = new mongoose.Types.ObjectId(req.user._id);
                // Also search across any cluster IDs for historical backward compatibility
                const clusterIds = getClusterUserIds(canonicalTargetId, req.user.companyId).map(id => new mongoose.Types.ObjectId(id));
                const commonRooms = await ChatParticipant.aggregate([
                    { $match: { userId: { $in: [u1, ...clusterIds] } } },
                    { $group: { _id: '$roomId', count: { $sum: 1 } } },
                    { $match: { count: 2 } }
                ]);
                if (commonRooms.length > 0) {
                    const cIds = commonRooms.map(r => r._id);
                    room = await ChatRoom.findOne({
                        _id: { $in: cIds },
                        companyId: req.user.companyId,
                        roomType: 'DIRECT',
                        isActive: { $ne: false }
                    }).sort({ createdAt: 1 });
                    if (room) {
                        if (!room.metadata) room.metadata = new Map();
                        room.metadata.set('directPair', pairKey);
                        await room.save().catch(() => {});
                    }
                }
            }

            // 3. Create if truly does not exist
            if (!room) {
                try {
                    room = await ChatRoom.create({
                        companyId: req.user.companyId,
                        roomType: 'DIRECT',
                        name: targetUser.fullName,
                        isGroup: false,
                        metadata: { directPair: pairKey }
                    });

                    await ChatParticipant.create([
                        { roomId: room._id, userId: req.user._id, companyId: req.user.companyId, roleAtJoining: req.user.role },
                        { roomId: room._id, userId: targetUser._id, companyId: req.user.companyId, roleAtJoining: targetUser.role }
                    ]);
                } catch (createErr) {
                    if (createErr.code === 11000) {
                        room = await ChatRoom.findOne({
                            companyId: req.user.companyId,
                            roomType: 'DIRECT',
                            isActive: { $ne: false },
                            'metadata.directPair': pairKey
                        });
                    } else {
                        throw createErr;
                    }
                }
            }

            return room;
        })();

        inFlightDirectRoomPromises.set(pairKey, creationPromise);
        let room;
        try {
            room = await creationPromise;
        } finally {
            inFlightDirectRoomPromises.delete(pairKey);
        }

        // Ensure both participant records exist
        const p1 = await ChatParticipant.findOne({ roomId: room._id, userId: req.user._id });
        if (!p1) {
            await ChatParticipant.create({ roomId: room._id, userId: req.user._id, companyId: req.user.companyId, roleAtJoining: req.user.role });
        }
        const p2 = await ChatParticipant.findOne({ roomId: room._id, userId: targetUser._id });
        if (!p2) {
            await ChatParticipant.create({ roomId: room._id, userId: targetUser._id, companyId: req.user.companyId, roleAtJoining: targetUser.role });
        }

        const io = req.app?.get ? req.app.get('io') : null;
        let isOnline = false;
        if (io) {
            const sockets = io.sockets.adapter.rooms.get(targetUserId.toString());
            isOnline = sockets && sockets.size > 0;
            const reqSockets = io.sockets.adapter.rooms.get(req.user._id.toString());
            if (reqSockets) {
                reqSockets.forEach(sid => {
                    const s = io.sockets.sockets.get(sid);
                    if (s) s.join(room._id.toString());
                });
            }
        }

        res.status(200).json({
            id: room._id,
            _id: room._id,
            roomType: 'DIRECT',
            name: targetUser.fullName,
            avatar: targetUser.avatar || null,
            otherUserId: targetUser._id,
            otherRole: targetUser.role,
            isOnline: !!isOnline,
            sharedProjects: check.sharedProjectNames || []
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get authorized chat rooms (Both PROJECT_GROUP and DIRECT)
// @route   GET /api/chat/rooms
// @access  Private
const getChatRooms = async (req, res, next) => {
    try {
        const { _id, companyId } = req.user;
        const io = req.app ? req.app.get('io') : null;
        const scope = await getUserProjectScope(_id, companyId, req.user.role);
        const clusterUserIds = getClusterUserIds(_id, companyId);
        const clusterUserObjIds = clusterUserIds.map(id => new mongoose.Types.ObjectId(id));

        const participants = await ChatParticipant.find({ userId: { $in: clusterUserObjIds } }).lean();
        const roomIds = participants.map(p => p.roomId);

        const roomsData = await ChatRoom.find({
            _id: { $in: roomIds },
            isActive: { $ne: false }
        }).populate('projectId', 'name').lean();

        // Batch query participants for all PROJECT_GROUP rooms in a single query
        const projectGroupRoomIds = roomsData.filter(r => r.roomType === 'PROJECT_GROUP').map(r => r._id);
        const allGroupParticipants = await ChatParticipant.find({ roomId: { $in: projectGroupRoomIds } })
            .populate('userId', 'fullName role avatar email isActive')
            .lean();

        const participantsByRoomId = new Map();
        for (const p of allGroupParticipants) {
            const ridStr = p.roomId.toString();
            if (!participantsByRoomId.has(ridStr)) {
                participantsByRoomId.set(ridStr, []);
            }
            if (p.userId && p.userId.isActive !== false) {
                participantsByRoomId.get(ridStr).push({
                    id: p._id,
                    participantId: p._id,
                    userId: p.userId._id,
                    fullName: p.userId.fullName || 'User',
                    role: p.userId.role || p.roleAtJoining || 'MEMBER',
                    avatar: p.userId.avatar || null,
                    email: p.userId.email || null,
                    isOnline: io ? (io.sockets.adapter.rooms.get(p.userId._id.toString())?.size > 0) : false,
                    joinedAt: p.createdAt
                });
            }
        }

        const roomResults = await Promise.all(roomsData.map(async (room) => {
            const participantRecords = participants.filter(p => String(p.roomId) === String(room._id));
            const lastRead = participantRecords.reduce((maxTime, p) => {
                const t = p.lastReadAt ? new Date(p.lastReadAt).getTime() : 0;
                return t > maxTime ? t : maxTime;
            }, 0);

            // Fetch unread count excluding any message sent by current user's cluster IDs
            const unreadCountPromise = Chat.countDocuments({
                roomId: room._id,
                sender: { $nin: clusterUserObjIds },
                createdAt: { $gt: new Date(lastRead) }
            });

            // Fetch latest message
            const lastMsgDocPromise = Chat.findOne({ roomId: room._id })
                .sort({ createdAt: -1 })
                .populate('sender', 'fullName')
                .lean();

            const [unreadCount, lastMsgDoc] = await Promise.all([unreadCountPromise, lastMsgDocPromise]);

            let lastMessage = null;
            if (lastMsgDoc) {
                lastMessage = {
                    text: lastMsgDoc.message,
                    sender: lastMsgDoc.sender?.fullName || 'User',
                    time: lastMsgDoc.createdAt
                };
            }

            if (room.roomType === 'PROJECT_GROUP') {
                const pidStr = room.projectId ? String(room.projectId._id || room.projectId) : null;
                const hasActiveAccess = pidStr && scope.projectIdSet.has(pidStr);
                const rawParticipants = participantsByRoomId.get(room._id.toString()) || [];
                const validParticipants = resolveCanonicalContacts(rawParticipants, req.user.companyId);

                return {
                    id: room._id,
                    _id: room._id,
                    roomType: 'PROJECT_GROUP',
                    isGroup: true,
                    name: room.name || room.projectId?.name || 'Project Coordination',
                    projectName: room.projectId?.name || room.name || 'Project',
                    projectId: pidStr,
                    unreadCount,
                    lastMessage,
                    isArchived: !hasActiveAccess,
                    readOnly: !hasActiveAccess,
                    participants: validParticipants,
                    participantCount: validParticipants.length
                };
            } else if (room.roomType === 'DIRECT') {
                // 1. Fetch room participants to verify membership and participant count
                const allRoomParticipants = await ChatParticipant.find({ roomId: room._id }).populate('userId', 'fullName role avatar isActive email companyId').lean();
                const isAuthorizedParticipant = allRoomParticipants.some(p => p.userId && clusterUserIds.includes(String(p.userId._id || p.userId)));
                if (!isAuthorizedParticipant) return null;

                // 2. Resolve intended peer from metadata.directPair if present and valid
                let targetPeerId = null;
                let isPairMember = false;
                const directPairStr = (room.metadata instanceof Map ? room.metadata.get('directPair') : room.metadata?.directPair);

                if (typeof directPairStr === 'string' && directPairStr.includes(':')) {
                    const rawPairIds = directPairStr.split(':').map(s => s.trim());
                    // Validate metadata.directPair contains exactly two valid user IDs
                    if (rawPairIds.length === 2 && mongoose.Types.ObjectId.isValid(rawPairIds[0]) && mongoose.Types.ObjectId.isValid(rawPairIds[1])) {
                        const currentUserIdStr = String(req.user._id);
                        const canonicalCurrentUserId = resolveCanonicalUserId(currentUserIdStr, req.user.companyId);
                        const canon0 = resolveCanonicalUserId(rawPairIds[0], req.user.companyId);
                        const canon1 = resolveCanonicalUserId(rawPairIds[1], req.user.companyId);

                        const isMember0 = (rawPairIds[0] === currentUserIdStr || canon0 === canonicalCurrentUserId);
                        const isMember1 = (rawPairIds[1] === currentUserIdStr || canon1 === canonicalCurrentUserId);

                        if (isMember0) {
                            targetPeerId = rawPairIds[1];
                            isPairMember = true;
                        } else if (isMember1) {
                            targetPeerId = rawPairIds[0];
                            isPairMember = true;
                        }
                    }
                }

                // 3. Backward-compatible fallback for legacy rooms without directPair or participants outside directPair
                if (!targetPeerId) {
                    const otherP = allRoomParticipants.find(p => p.userId && !clusterUserIds.includes(String(p.userId._id || p.userId)));
                    if (otherP?.userId) {
                        targetPeerId = otherP.userId._id || otherP.userId;
                    }
                }

                if (!targetPeerId) return null;

                // 4. Resolve canonical identity of peer (aliases -> canonical account)
                const canonicalOtherId = resolveCanonicalUserId(targetPeerId, req.user.companyId);
                const otherUser = await User.findById(canonicalOtherId).select('_id fullName role avatar isActive email companyId').lean();
                if (!otherUser) return null;

                // 5. Tenant isolation check: ensure peer belongs to same company
                if (String(otherUser.companyId) !== String(req.user.companyId)) return null;

                // 6. Handle multi-party legacy direct rooms (e.g. legacy Site Foreman participant)
                let roomDisplayName = otherUser.fullName;
                const isMultiPartyLegacy = allRoomParticipants.length > 2;

                if (isMultiPartyLegacy && !isPairMember) {
                    const peerNames = allRoomParticipants
                        .filter(p => p.userId && !clusterUserIds.includes(String(p.userId._id || p.userId)))
                        .map(p => p.userId.fullName || 'User')
                        .join(' & ');
                    roomDisplayName = peerNames ? `${peerNames} (Legacy Discussion)` : `${otherUser.fullName} (Legacy Discussion)`;
                }

                // Dynamic permission check: is relationship still active?
                const check = await assertHierarchyMessagingAllowed(req.user, otherUser, scope);
                const isOnline = io ? (io.sockets.adapter.rooms.get(otherUser._id.toString())?.size > 0) : false;

                return {
                    id: room._id,
                    _id: room._id,
                    roomType: 'DIRECT',
                    isGroup: false,
                    isMultiParty: isMultiPartyLegacy,
                    participantCount: allRoomParticipants.length,
                    name: roomDisplayName,
                    avatar: otherUser.avatar || null,
                    otherUserId: otherUser._id,
                    otherRole: otherUser.role,
                    email: otherUser.email || null,
                    otherUser: {
                        _id: otherUser._id,
                        id: otherUser._id,
                        fullName: otherUser.fullName,
                        email: otherUser.email || null,
                        role: otherUser.role,
                        avatar: otherUser.avatar || null,
                        isOnline: !!isOnline
                    },
                    isOnline: !!isOnline,
                    sharedProjects: check.sharedProjectNames || [],
                    unreadCount,
                    lastMessage,
                    isArchived: !check.allowed,
                    readOnly: !check.allowed
                };
            }
            return null;
        }));

        const formattedRooms = roomResults.filter(Boolean);

        // Sort by last activity descending
        formattedRooms.sort((a, b) => {
            const timeA = a.lastMessage?.time ? new Date(a.lastMessage.time).getTime() : 0;
            const timeB = b.lastMessage?.time ? new Date(b.lastMessage.time).getTime() : 0;
            return timeB - timeA;
        });

        res.json(formattedRooms);
    } catch (error) {
        next(error);
    }
};

// @desc    Get messages for a room with participant authorization
// @route   GET /api/chat/:roomId
// @access  Private
const getRoomMessages = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        if (roomId === 'hierarchy-users') return getHierarchyUsers(req, res, next);
        if (roomId === 'rooms') return getChatRooms(req, res, next);
        if (roomId === 'unread-count') return getUnreadCount(req, res, next);
        if (roomId === 'users') return getChatUsers(req, res, next);

        const { _id, companyId, role } = req.user;

        let finalRoomId = roomId;

        // Smart project ID resolution
        if (mongoose.Types.ObjectId.isValid(roomId)) {
            const isProject = await Project.exists({ _id: roomId });
            if (isProject) {
                let projectRoom = await ChatRoom.findOne({ projectId: roomId, roomType: 'PROJECT_GROUP' });
                if (!projectRoom) {
                    await syncProjectParticipants(roomId);
                    projectRoom = await ChatRoom.findOne({ projectId: roomId, roomType: 'PROJECT_GROUP' });
                }
                if (projectRoom) finalRoomId = projectRoom._id;
            }
        }

        if (!finalRoomId || !mongoose.Types.ObjectId.isValid(finalRoomId)) {
            return res.status(400).json({ message: 'Invalid room ID' });
        }

        const room = await ChatRoom.findById(finalRoomId);
        if (!room) {
            return res.status(404).json({ message: 'Chat room not found' });
        }

        // Authorization check: User must be a participant in this room
        const isParticipant = await ChatParticipant.exists({
            roomId: finalRoomId,
            userId: _id
        });

        if (!isParticipant && !ADMIN_ROLES.includes(role)) {
            return res.status(403).json({ message: 'You are not authorized to view messages in this conversation.' });
        }

        const limitVal = parseInt(req.query.limit, 10) || 50;
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
            .lean();

        res.json(messages.reverse());
    } catch (error) {
        next(error);
    }
};

// @desc    Get participants for a room (reflects actual group membership)
// @route   GET /api/chat/:roomId/participants
// @access  Private
const getRoomParticipants = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const { _id, role } = req.user;

        let finalRoomId = roomId;
        let resolvedProjectId = null;

        // Smart project ID resolution
        if (mongoose.Types.ObjectId.isValid(roomId)) {
            const project = await Project.findById(roomId).select('_id');
            if (project) {
                resolvedProjectId = project._id;
                let projectRoom = await ChatRoom.findOne({ projectId: project._id, roomType: 'PROJECT_GROUP' });
                if (!projectRoom) {
                    await syncProjectParticipants(project._id);
                    projectRoom = await ChatRoom.findOne({ projectId: project._id, roomType: 'PROJECT_GROUP' });
                }
                if (projectRoom) finalRoomId = projectRoom._id;
            }
        }

        if (!finalRoomId || !mongoose.Types.ObjectId.isValid(finalRoomId)) {
            return res.status(400).json({ message: 'Invalid room ID' });
        }

        const room = await ChatRoom.findById(finalRoomId);
        if (!room) {
            return res.status(404).json({ message: 'Chat room not found' });
        }

        if (room.projectId) {
            resolvedProjectId = room.projectId;
        }

        // If it's a project group, synchronize participants BEFORE authorization check
        // so newly assigned PMs/workers are immediately recognized as participants
        if (room.roomType === 'PROJECT_GROUP' && resolvedProjectId) {
            await syncProjectParticipants(resolvedProjectId);
        }

        // Authorization check: User must be a participant or an admin
        const isParticipant = await ChatParticipant.exists({
            roomId: finalRoomId,
            userId: _id
        });

        if (!isParticipant && !ADMIN_ROLES.includes(role)) {
            return res.status(403).json({ message: 'You are not authorized to view participants in this conversation.' });
        }

        const participantsDocs = await ChatParticipant.find({ roomId: finalRoomId })
            .populate('userId', 'fullName role avatar email phone isActive')
            .sort({ createdAt: 1 })
            .lean();

        const io = req.app.get('io');

        // Build set of legitimately authorized project users if PROJECT_GROUP
        let legitimateUserIds = null;
        if (room.roomType === 'PROJECT_GROUP' && resolvedProjectId) {
            const project = await Project.findById(resolvedProjectId).lean();
            if (project) {
                legitimateUserIds = new Set();
                if (project.pmIds && Array.isArray(project.pmIds)) {
                    project.pmIds.forEach(id => legitimateUserIds.add(id.toString()));
                }
                if (project.pmId) legitimateUserIds.add(project.pmId.toString());
                if (project.clientId) legitimateUserIds.add(project.clientId.toString());
                if (project.createdBy) legitimateUserIds.add(project.createdBy.toString());

                const primaryOwner = await User.findOne({
                    companyId: project.companyId,
                    role: 'COMPANY_OWNER',
                    isActive: true
                }).sort({ createdAt: 1 }).select('_id');
                if (primaryOwner) {
                    legitimateUserIds.add(primaryOwner._id.toString());
                }

                // Current user if authorized
                legitimateUserIds.add(_id.toString());

                const [jobs, tasks] = await Promise.all([
                    Job.find({ projectId: resolvedProjectId }).select('foremanId assignedWorkers subcontractorId').lean(),
                    Task.find({ projectId: resolvedProjectId }).select('assignedTo').lean()
                ]);

                jobs.forEach(j => {
                    if (j.foremanId) legitimateUserIds.add(j.foremanId.toString());
                    if (j.subcontractorId) legitimateUserIds.add(j.subcontractorId.toString());
                    if (j.assignedWorkers && Array.isArray(j.assignedWorkers)) {
                        j.assignedWorkers.forEach(w => {
                            if (w) legitimateUserIds.add(w.toString());
                        });
                    }
                });

                tasks.forEach(t => {
                    if (t.assignedTo && Array.isArray(t.assignedTo)) {
                        t.assignedTo.forEach(u => {
                            if (u) legitimateUserIds.add(u.toString());
                        });
                    }
                });
            }
        }

        const rawParticipants = participantsDocs
            .filter(p => {
                if (!p.userId || p.userId.isActive === false) return false;
                if (legitimateUserIds) {
                    return legitimateUserIds.has(p.userId._id.toString());
                }
                return true;
            })
            .map(p => {
                const u = p.userId;
                const isOnline = io ? (io.sockets.adapter.rooms.get(u._id.toString())?.size > 0) : false;
                return {
                    id: p._id,
                    participantId: p._id,
                    userId: u._id,
                    _id: u._id,
                    fullName: u.fullName || 'User',
                    role: u.role || p.roleAtJoining || 'MEMBER',
                    avatar: u.avatar || null,
                    email: u.email || null,
                    phone: u.phone || null,
                    isOnline: !!isOnline,
                    joinedAt: p.createdAt
                };
            });

        const participants = resolveCanonicalContacts(rawParticipants, req.user.companyId);

        res.json({
            roomId: finalRoomId,
            roomType: room.roomType,
            count: participants.length,
            participants
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Send message to an authorized room with dynamic validation and idempotency
// @route   POST /api/chat
// @access  Private
const sendMessage = async (req, res, next) => {
    let idempotencyKey = null;
    let resolveInFlight = null;
    let rejectInFlight = null;
    try {
        let { roomId, message, attachments, projectId, clientMsgId } = req.body;
        const { _id, companyId, role } = req.user;

        // Idempotency check: if client sent clientMsgId, or rapid duplicate submission within 1000ms
        const cleanMsg = (message || '').trim();
        idempotencyKey = clientMsgId 
            ? `msg_${_id}_${clientMsgId}` 
            : `dedup_${_id}_${roomId || projectId}_${cleanMsg}`;
        
        const cached = recentMessageIdempotencyMap.get(idempotencyKey);
        if (cached) {
            if (cached.result) {
                return res.status(200).json(cached.result);
            }
            if (cached.promise) {
                try {
                    const resolved = await cached.promise;
                    if (resolved) return res.status(200).json(resolved);
                } catch (e) {
                    // if previous in-flight failed, proceed with retry
                }
            }
        }

        // Set up in-flight promise tracker for concurrent requests
        const inFlightPromise = new Promise((resolve, reject) => {
            resolveInFlight = resolve;
            rejectInFlight = reject;
        });
        recentMessageIdempotencyMap.set(idempotencyKey, {
            timestamp: Date.now(),
            promise: inFlightPromise,
            result: null
        });

        let actualRoomId = roomId;
        let room = null;
        let participant = null;

        if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
            room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
            if (!room) {
                await syncProjectParticipants(projectId);
                room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
            }
            if (room) {
                actualRoomId = room._id;
                participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
            }
        } else if (roomId && mongoose.Types.ObjectId.isValid(roomId)) {
            // Concurrent lookup of room and participant for normal ChatRoom IDs
            [room, participant] = await Promise.all([
                ChatRoom.findById(roomId),
                ChatParticipant.findOne({ roomId: roomId, userId: _id })
            ]);

            // Lazy Project fallback: only query Project collection if roomId was not found as a ChatRoom
            if (!room) {
                const projectExists = await Project.exists({ _id: roomId });
                if (projectExists) {
                    projectId = roomId;
                    room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
                    if (!room) {
                        await syncProjectParticipants(projectId);
                        room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
                    }
                    if (room) {
                        actualRoomId = room._id;
                        participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
                    }
                }
            }
        }

        if (!actualRoomId || !mongoose.Types.ObjectId.isValid(actualRoomId)) {
            return res.status(400).json({ message: 'Valid Room ID is required.' });
        }

        if (!room) {
            return res.status(404).json({ message: 'Room not found.' });
        }

        // Dynamic Authorization
        const scope = await getUserProjectScope(_id, companyId, role);

        if (room.roomType === 'PROJECT_GROUP') {
            const canAccess = await canUserAccessRoom(room, req.user, scope);
            if (!canAccess) {
                return res.status(403).json({ message: 'You are no longer assigned to this project. Room is read-only.' });
            }
            if (!participant) {
                participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
            }
        } else if (room.roomType === 'DIRECT') {
            // SENDER AUTHORIZATION: User must already be an authorized participant of this direct conversation
            if (!participant) {
                participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
            }
            if (!participant) {
                return res.status(403).json({ message: 'You are not a participant in this direct conversation.' });
            }

            const otherP = await ChatParticipant.findOne({
                roomId: actualRoomId,
                userId: { $ne: _id }
            });
            if (!otherP) {
                return res.status(403).json({ message: 'Direct conversation recipient not found.' });
            }
            const otherUser = await User.findById(otherP.userId).lean();
            const check = await assertHierarchyMessagingAllowed(req.user, otherUser, scope);
            if (!check.allowed) {
                return res.status(403).json({ message: check.reason || 'Assignment has changed. Direct conversation is archived.' });
            }
        }

        // Ensure participant record exists (only auto-created for authorized project groups)
        if (!participant) {
            if (room.roomType === 'DIRECT') {
                return res.status(403).json({ message: 'Cannot add third participant to a direct conversation.' });
            }
            try {
                participant = await ChatParticipant.create({
                    roomId: actualRoomId,
                    userId: _id,
                    companyId,
                    roleAtJoining: role,
                    lastReadAt: new Date()
                });
            } catch (syncErr) {
                if (syncErr.code === 11000) {
                    participant = await ChatParticipant.findOne({ roomId: actualRoomId, userId: _id });
                }
            }
        } else {
            ChatParticipant.updateOne({ _id: participant._id }, { lastReadAt: new Date() }).catch(() => {});
        }

        // Create Message
        const chat = await Chat.create({
            companyId,
            sender: _id,
            roomId: actualRoomId,
            projectId: room.projectId,
            message: message || '',
            attachments: attachments || []
        });

        const fullChat = {
            ...chat.toObject(),
            clientMsgId: clientMsgId || undefined,
            sender: {
                _id: req.user._id,
                fullName: req.user.fullName,
                role: req.user.role,
                avatar: req.user.avatar
            }
        };

        if (idempotencyKey) {
            recentMessageIdempotencyMap.set(idempotencyKey, {
                timestamp: Date.now(),
                result: fullChat,
                promise: null
            });
        }
        if (resolveInFlight) resolveInFlight(fullChat);

        const io = req.app.get('io');
        if (io) {
            // Broadcast new message to the room
            io.to(actualRoomId.toString()).emit('new_message', fullChat);

            // Handle in-app and push notifications for other participants
            const notifyOthers = async () => {
                const participantsList = await ChatParticipant.find({ roomId: actualRoomId }).lean();
                const otherParticipants = participantsList.filter(p => String(p.userId) !== String(_id));
                const otherUserIds = otherParticipants.map(p => p.userId);

                if (otherUserIds.length === 0) return;

                const senderName = req.user.fullName || 'Someone';
                const isDirect = room.roomType === 'DIRECT';
                const notificationTitle = isDirect
                    ? `New message from ${senderName}`
                    : `[${room.name || 'Project'}] New message from ${senderName}`;
                const notificationBody = message || (attachments?.length > 0 ? 'Sent an attachment' : 'New transmission');

                // In-app notifications
                otherParticipants.forEach(p => {
                    io.to(p.userId.toString()).emit('new_notification', {
                        type: isDirect ? 'private' : 'group',
                        roomId: actualRoomId.toString(),
                        senderId: _id.toString(),
                        senderName,
                        role: req.user.role,
                        projectName: room.name || ''
                    });
                });

                // FCM Push Notification for offline or background users
                try {
                    const { sendPushNotification } = require('../utils/fcmHelper');
                    await sendPushNotification(
                        otherUserIds,
                        notificationTitle,
                        notificationBody,
                        {
                            roomId: actualRoomId.toString(),
                            projectId: room.projectId?.toString() || '',
                            projectName: room.name || '',
                            type: isDirect ? 'private' : 'group',
                            senderId: _id.toString(),
                            senderName,
                            role: req.user.role
                        },
                        io
                    );
                } catch (fcmErr) {
                    console.error('[FCM push error]', fcmErr.message);
                }
            };

            notifyOthers().catch(err => console.error('Notification error:', err));
        }

        res.status(201).json(fullChat);
    } catch (error) {
        if (idempotencyKey) {
            recentMessageIdempotencyMap.delete(idempotencyKey);
        }
        if (rejectInFlight) rejectInFlight(error);
        next(error);
    }
};

// @desc    Mark room as read
// @route   PUT /api/chat/mark-read/:roomId
// @access  Private
const markAsRead = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const { _id, companyId } = req.user;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ message: 'Invalid Room ID' });
        }

        const clusterUserIds = getClusterUserIds(_id, companyId);
        const clusterUserObjIds = clusterUserIds.map(id => new mongoose.Types.ObjectId(id));
        const now = new Date();

        await ChatParticipant.updateMany(
            { roomId, userId: { $in: clusterUserObjIds } },
            { $set: { lastReadAt: now } }
        );

        const io = req.app.get('io');
        if (io) {
            clusterUserIds.forEach(uId => {
                io.to(uId).emit('unread_count_updated');
            });
        }

        res.json({ success: true, lastReadAt: now });
    } catch (error) {
        next(error);
    }
};

// @desc    Get unread counts segregated by group and private
// @route   GET /api/chat/unread-count
// @access  Private
const getUnreadCount = async (req, res, next) => {
    try {
        const { _id, companyId } = req.user;
        const clusterUserIds = getClusterUserIds(_id, companyId);
        const clusterUserObjIds = clusterUserIds.map(id => new mongoose.Types.ObjectId(id));

        const participants = await ChatParticipant.find({ userId: { $in: clusterUserObjIds } }).lean();
        const roomIds = participants.map(p => p.roomId);

        const rooms = await ChatRoom.find({ _id: { $in: roomIds }, isActive: { $ne: false } }).select('_id roomType metadata').lean();
        const roomsMap = new Map(rooms.map(r => [String(r._id), r]));

        // Deduplicate room read states by selecting max lastReadAt per roomId
        const lastReadByRoomId = new Map();
        for (const p of participants) {
            const rIdStr = String(p.roomId);
            const t = p.lastReadAt ? new Date(p.lastReadAt).getTime() : 0;
            if (!lastReadByRoomId.has(rIdStr) || t > lastReadByRoomId.get(rIdStr)) {
                lastReadByRoomId.set(rIdStr, t);
            }
        }

        let groupUnread = 0;
        let privateUnread = 0;

        for (const [rIdStr, lastReadTime] of lastReadByRoomId.entries()) {
            const room = roomsMap.get(rIdStr);
            if (!room) continue;

            if (room.roomType === 'DIRECT') {
                // Ensure target peer in direct room is active and belongs to same company
                const allRoomParticipants = await ChatParticipant.find({ roomId: room._id }).populate('userId', '_id companyId isActive').lean();
                const otherP = allRoomParticipants.find(p => p.userId && !clusterUserIds.includes(String(p.userId._id || p.userId)));
                if (!otherP || !otherP.userId) continue;

                const canonicalOtherId = resolveCanonicalUserId(otherP.userId._id || otherP.userId, companyId);
                const otherUser = await User.findById(canonicalOtherId).select('_id companyId isActive').lean();
                if (!otherUser || otherUser.isActive === false) continue;
                if (String(otherUser.companyId) !== String(companyId)) continue;
            }

            const count = await Chat.countDocuments({
                roomId: room._id,
                sender: { $nin: clusterUserObjIds },
                createdAt: { $gt: new Date(lastReadTime) }
            });

            if (room.roomType === 'PROJECT_GROUP') {
                groupUnread += count;
            } else if (room.roomType === 'DIRECT') {
                privateUnread += count;
            }
        }

        res.json({
            count: groupUnread + privateUnread,
            total: groupUnread + privateUnread,
            groupUnread,
            privateUnread
        });
    } catch (error) {
        next(error);
    }
};

// Legacy directory alias for backward compatibility
const getChatUsers = async (req, res, next) => {
    return getHierarchyUsers(req, res, next);
};

// Update attachments on a message
const updateMessageAttachments = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const { attachments } = req.body;

        const chat = await Chat.findById(messageId);
        if (!chat) return res.status(404).json({ message: 'Message not found' });

        chat.attachments = attachments;
        await chat.save();

        const io = req.app.get('io');
        if (io) {
            io.to(chat.roomId.toString()).emit('message_updated', chat);
        }

        res.json(chat);
    } catch (err) {
        next(err);
    }
};

/**
 * Syncs all relevant project users into the project's chat room.
 */
const syncProjectParticipants = async (projectId) => {
    try {
        const project = await Project.findById(projectId);
        if (!project) return;

        let room = await ChatRoom.findOne({ projectId, roomType: 'PROJECT_GROUP' });
        if (!room) {
            room = await ChatRoom.create({
                companyId: project.companyId,
                projectId,
                roomType: 'PROJECT_GROUP',
                name: project.name,
                isGroup: true
            });
        }

        const userIds = new Set();
        if (project.pmIds && Array.isArray(project.pmIds)) {
            project.pmIds.forEach(id => userIds.add(id.toString()));
        }
        if (project.pmId) userIds.add(project.pmId.toString());
        if (project.clientId) userIds.add(project.clientId.toString());
        if (project.createdBy) userIds.add(project.createdBy.toString());

        // Include the primary company owner / project creator
        if (project.createdBy) {
            userIds.add(project.createdBy.toString());
        }
        const primaryOwner = await User.findOne({
            companyId: project.companyId,
            role: 'COMPANY_OWNER',
            isActive: true
        }).sort({ createdAt: 1 }).select('_id');
        if (primaryOwner) {
            userIds.add(primaryOwner._id.toString());
        }

        const jobs = await Job.find({ projectId }).select('foremanId assignedWorkers subcontractorId');
        jobs.forEach(j => {
            if (j.foremanId) userIds.add(j.foremanId.toString());
            if (j.subcontractorId) userIds.add(j.subcontractorId.toString());
            if (j.assignedWorkers && Array.isArray(j.assignedWorkers)) {
                j.assignedWorkers.forEach(w => {
                    if (w) userIds.add(w.toString());
                });
            }
        });

        const tasks = await Task.find({ projectId }).select('assignedTo');
        tasks.forEach(t => {
            if (t.assignedTo && Array.isArray(t.assignedTo)) {
                t.assignedTo.forEach(u => {
                    if (u) userIds.add(u.toString());
                });
            }
        });

        const existingParticipants = await ChatParticipant.find({ roomId: room._id }).select('userId');
        const existingUserIds = new Set(existingParticipants.map(p => p.userId.toString()));

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
        }
    } catch (error) {
        console.error('Error in syncProjectParticipants:', error);
    }
};

module.exports = {
    getChatRooms,
    getRoomMessages,
    getRoomParticipants,
    sendMessage,
    getUnreadCount,
    markAsRead,
    getOrCreateDirectRoom,
    getHierarchyUsers,
    getChatUsers,
    updateMessageAttachments,
    syncProjectParticipants,
    getUserProjectScope,
    getUserChatScope,
    assertHierarchyMessagingAllowed
};

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const ChatRoom = require('../models/ChatRoom');
const ChatParticipant = require('../models/ChatParticipant');
const Chat = require('../models/Chat');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');

function pairKeyFromParticipants(participants) {
    const ids = participants.map((p) => String(p.userId)).sort();
    if (ids.length !== 2) return null;
    return `${ids[0]}:${ids[1]}`;
}

async function run() {
    if (!MONGO_URI) {
        throw new Error('Missing MONGO_URI / MONGODB_URI');
    }
    await mongoose.connect(MONGO_URI);
    console.log(`[DirectRoomMigration] connected | dryRun=${DRY_RUN}`);

    const rooms = await ChatRoom.find({ roomType: 'DIRECT', isActive: { $ne: false } }).select('_id companyId createdAt metadata');
    const pairs = new Map();

    for (const room of rooms) {
        const participants = await ChatParticipant.find({ roomId: room._id }).select('userId');
        const pairKey = pairKeyFromParticipants(participants);
        if (!pairKey) continue;
        const companyPairKey = `${String(room.companyId)}|${pairKey}`;
        if (!pairs.has(companyPairKey)) pairs.set(companyPairKey, []);
        pairs.get(companyPairKey).push({ room, participants, pairKey });
    }

    let duplicateGroups = 0;
    let mergedRooms = 0;
    let movedMessages = 0;
    let deactivatedRooms = 0;

    for (const [, group] of pairs.entries()) {
        if (group.length < 2) continue;
        duplicateGroups += 1;
        group.sort((a, b) => new Date(a.room.createdAt).getTime() - new Date(b.room.createdAt).getTime());
        const canonical = group[0];
        const duplicates = group.slice(1);

        if (!DRY_RUN) {
            await ChatRoom.updateOne(
                { _id: canonical.room._id },
                { $set: { 'metadata.directPair': canonical.pairKey } }
            );
        }

        for (const dup of duplicates) {
            const count = await Chat.countDocuments({ roomId: dup.room._id });
            movedMessages += count;

            if (!DRY_RUN) {
                await Chat.updateMany({ roomId: dup.room._id }, { $set: { roomId: canonical.room._id } });
                await ChatParticipant.deleteMany({ roomId: dup.room._id });
                await ChatRoom.updateOne(
                    { _id: dup.room._id },
                    { $set: { isActive: false, 'metadata.mergedInto': String(canonical.room._id) } }
                );
            }

            mergedRooms += 1;
            deactivatedRooms += 1;
        }
    }

    console.log('[DirectRoomMigration] summary', {
        duplicateGroups,
        mergedRooms,
        movedMessages,
        deactivatedRooms,
        dryRun: DRY_RUN
    });

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error('[DirectRoomMigration] failed', err.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});

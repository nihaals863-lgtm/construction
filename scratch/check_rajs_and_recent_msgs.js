const { MongoClient } = require('mongodb');

async function findRajs() {
    const c = new MongoClient('mongodb://127.0.0.1:27017');
    await c.connect();
    const db = c.db('construction-saas');
    const users = await db.collection('users').find({
        $or: [
            { fullName: /raj/i },
            { email: /raj/i }
        ]
    }).toArray();

    console.log(`Found ${users.length} Raj users:`);
    users.forEach(u => {
        console.log({
            _id: u._id.toString(),
            fullName: u.fullName,
            email: u.email,
            role: u.role,
            isActive: u.isActive
        });
    });

    // Check recent messages sent in direct rooms
    const recentChats = await db.collection('chats').find().sort({ createdAt: -1 }).limit(10).toArray();
    console.log("\n=== RECENT CHATS ===");
    for (const m of recentChats) {
        const sender = await db.collection('users').findOne({ _id: m.sender });
        const room = await db.collection('chatrooms').findOne({ _id: m.roomId });
        console.log(`[${m.createdAt.toISOString()}] Sender: ${sender?.fullName} (${sender?.email}) in Room ${m.roomId}: "${m.message}"`);
        if (room) {
            console.log(`   Room directPair:`, room.metadata?.directPair);
        }
    }

    await c.close();
}

findRajs();

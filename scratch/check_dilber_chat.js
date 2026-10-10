const { MongoClient, ObjectId } = require('mongodb');

async function check() {
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    await client.connect();
    const db = client.db('construction-saas');

    console.log("=== USERS ===");
    const users = await db.collection('users').find({
        $or: [
            { email: /dil/i },
            { email: /raj/i }
        ]
    }).project({ _id: 1, email: 1, fullName: 1, role: 1, isActive: 1, companyId: 1 }).toArray();
    console.log(users);

    console.log("\n=== RECENT CHAT MESSAGES ===");
    const chats = await db.collection('chats').find().sort({ createdAt: -1 }).limit(10).toArray();
    for (const c of chats) {
        const sender = users.find(u => u._id.toString() === c.sender.toString()) || { email: c.sender.toString() };
        console.log(`[${c.createdAt.toISOString()}] Room: ${c.roomId} | Sender: ${sender.email || sender.fullName} | Msg: "${c.message}"`);
    }

    console.log("\n=== ROOMS FOR EACH USER ===");
    for (const u of users) {
        if (!u.isActive) continue;
        const parts = await db.collection('chatparticipants').find({ userId: u._id }).toArray();
        console.log(`User ${u.email} (${u._id}) is participant in rooms:`, parts.map(p => p.roomId.toString()));
    }

    await client.close();
}

check();

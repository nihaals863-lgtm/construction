const { MongoClient, ObjectId } = require('mongodb');

async function checkChatRooms() {
    const uri = "mongodb://127.0.0.1:27017/construction-saas";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        const id1 = new ObjectId('6abb6f8bce4d83703ad7ba33'); // dilbar@kaal.ca
        const id2 = new ObjectId('6abe1c27ce4d83703ae01cde'); // dilber@kaal.ca

        const p1 = await db.collection('chatparticipants').find({ userId: id1 }).toArray();
        const p2 = await db.collection('chatparticipants').find({ userId: id2 }).toArray();

        console.log(`p1 (dilbar) rooms: ${p1.map(p => p.roomId.toString()).join(', ')}`);
        console.log(`p2 (dilber) rooms: ${p2.map(p => p.roomId.toString()).join(', ')}`);

        // Check messages in those rooms
        const rooms1 = p1.map(p => p.roomId);
        const rooms2 = p2.map(p => p.roomId);

        const msgs1 = await db.collection('chats').find({ roomId: { $in: rooms1 } }).toArray();
        const msgs2 = await db.collection('chats').find({ roomId: { $in: rooms2 } }).toArray();

        console.log(`Messages in dilbar rooms (${msgs1.length}):`);
        msgs1.forEach(m => console.log(`  Room ${m.roomId}: [${m.senderId}] ${m.message}`));

        console.log(`Messages in dilber rooms (${msgs2.length}):`);
        msgs2.forEach(m => console.log(`  Room ${m.roomId}: [${m.senderId}] ${m.message}`));
    } finally {
        await client.close();
    }
}

checkChatRooms();

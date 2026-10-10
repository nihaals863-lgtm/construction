const { MongoClient, ObjectId } = require('mongodb');

async function inspectFailedRoom() {
    const uri = "mongodb://127.0.0.1:27017/construction-saas";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        const roomId = new ObjectId('6ac8dac8e8e12b910fd6b10e');
        const room = await db.collection('chatrooms').findOne({ _id: roomId });
        const participants = await db.collection('chatparticipants').find({ roomId }).toArray();
        const messages = await db.collection('chats').find({ roomId }).toArray();

        console.log("Room details:", room);
        console.log("Participants:");
        for (const p of participants) {
            const u = await db.collection('users').findOne({ _id: p.userId });
            console.log(`  - User: ${u ? u.fullName + ' (' + u.email + ')' : p.userId}`);
        }
        console.log("Messages in room:", messages);
    } finally {
        await client.close();
    }
}

inspectFailedRoom();

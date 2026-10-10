const { MongoClient, ObjectId } = require('mongodb');

async function inspectDilbersDetail() {
    const uri = "mongodb://127.0.0.1:27017/construction-saas";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        const ids = [
            new ObjectId('69f996aa16ba2a698b8f3816'),
            new ObjectId('6abb6f8bce4d83703ad7ba33'),
            new ObjectId('6abe1c27ce4d83703ae01cde')
        ];

        for (const id of ids) {
            const u = await db.collection('users').findOne({ _id: id });
            const projects = await db.collection('projects').countDocuments({ createdBy: id });
            const projectMembers = await db.collection('projects').countDocuments({ 'assignedUsers': id });
            const jobs = await db.collection('jobs').countDocuments({ assignedWorkers: id });
            const timelogs = await db.collection('timelogs').countDocuments({ userId: id });
            const chatsSent = await db.collection('chats').countDocuments({ senderId: id });
            const chatRooms = await db.collection('chatparticipants').countDocuments({ userId: id });

            console.log(`\n========================================`);
            console.log(`User: ${u.fullName} (${u.email}) [Role: ${u.role}]`);
            console.log(`ID: ${id}`);
            console.log(`Created At: ${u.createdAt}`);
            console.log(`Last Active: ${u.lastLogin || u.updatedAt}`);
            console.log(`Activity counts:`);
            console.log(`  Projects Created: ${projects}`);
            console.log(`  Project Assigned: ${projectMembers}`);
            console.log(`  Jobs Assigned: ${jobs}`);
            console.log(`  TimeLogs: ${timelogs}`);
            console.log(`  Chat Messages Sent: ${chatsSent}`);
            console.log(`  Chat Rooms Joined: ${chatRooms}`);
        }
    } finally {
        await client.close();
    }
}

inspectDilbersDetail();

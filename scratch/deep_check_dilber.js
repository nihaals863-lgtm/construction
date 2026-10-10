const { MongoClient } = require('mongodb');

async function checkAllDilbers() {
    const uri = "mongodb://127.0.0.1:27017/construction-saas";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        // 1. Check all users
        const users = await db.collection('users').find({}).toArray();
        const dilberUsers = users.filter(u => 
            (u.fullName && u.fullName.toLowerCase().includes('dil')) ||
            (u.email && u.email.toLowerCase().includes('dil'))
        );

        console.log("=== USERS MATCHING 'dil' ===");
        dilberUsers.forEach(u => {
            console.log({
                _id: u._id.toString(),
                fullName: u.fullName,
                email: u.email,
                role: u.role,
                companyId: u.companyId ? u.companyId.toString() : null,
                isActive: u.isActive
            });
        });

        // 2. Check if there are other companies or other collections
        const companies = await db.collection('companies').find({}).toArray();
        console.log("\n=== COMPANIES ===");
        companies.forEach(c => console.log(c._id.toString(), c.name));

        // 3. Check ChatParticipants for Dilber users
        for (const u of dilberUsers) {
            const parts = await db.collection('chatparticipants').countDocuments({ userId: u._id });
            const msgs = await db.collection('chats').countDocuments({ senderId: u._id });
            console.log(`\nUser ${u.fullName} (${u.email}, ${u.role}, ID: ${u._id}):`);
            console.log(`  Chat participants entries: ${parts}`);
            console.log(`  Messages sent: ${msgs}`);
        }

    } finally {
        await client.close();
    }
}

checkAllDilbers();

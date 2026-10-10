const { MongoClient } = require('mongodb');

async function findDilbers() {
    const uri = "mongodb://127.0.0.1:27017/construction-saas";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const users = await db.collection('users').find({
            $or: [
                { fullName: { $regex: 'dilber', $options: 'i' } },
                { email: { $regex: 'dilber', $options: 'i' } }
            ]
        }).toArray();

        console.log(`Found ${users.length} Dilber users:`);
        users.forEach(u => {
            console.log({
                _id: u._id.toString(),
                fullName: u.fullName,
                email: u.email,
                role: u.role,
                companyId: u.companyId ? u.companyId.toString() : null,
                isActive: u.isActive,
                createdAt: u.createdAt
            });
        });
    } finally {
        await client.close();
    }
}

findDilbers();

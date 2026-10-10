const { MongoClient, ObjectId } = require('mongodb');

async function checkOwnerAccount() {
    const uri = "mongodb://127.0.0.1:27017/construction-saas";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        const u1 = await db.collection('users').findOne({ _id: new ObjectId('6abb6f8bce4d83703ad7ba33') });
        const u2 = await db.collection('users').findOne({ _id: new ObjectId('6abe1c27ce4d83703ae01cde') });

        console.log("Account 1 (dilbar@kaal.ca):", {
            phone: u1.phone,
            passwordHash: u1.password ? u1.password.substring(0, 10) + '...' : null,
            fcmTokens: await db.collection('fcmtokens').countDocuments({ userId: u1._id })
        });

        console.log("Account 2 (dilber@kaal.ca):", {
            phone: u2.phone,
            passwordHash: u2.password ? u2.password.substring(0, 10) + '...' : null,
            fcmTokens: await db.collection('fcmtokens').countDocuments({ userId: u2._id })
        });
    } finally {
        await client.close();
    }
}

checkOwnerAccount();

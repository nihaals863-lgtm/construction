const { MongoClient, ObjectId } = require('mongodb');

const atlasUri = "mongodb+srv://bard_admin:Bard%40Construction2026%21%21@bard-construction-clust.tarehtj.mongodb.net/construction-saas?appName=bard-construction-cluster";
const localUri = "mongodb://127.0.0.1:27017/construction-saas";

const duplicateId = new ObjectId('6abb6f8bce4d83703ad7ba33'); // dilbar@kaal.ca (extra duplicate)
const canonicalId = new ObjectId('6abe1c27ce4d83703ae01cde'); // dilber@kaal.ca (kept canonical)

async function deactivateDuplicate(uri, name) {
    console.log(`Connecting to ${name}...`);
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        // 1. Mark duplicate as isActive: false
        const res = await db.collection('users').updateOne(
            { _id: duplicateId },
            { $set: { isActive: false, duplicateOf: canonicalId, updatedAt: new Date() } }
        );
        console.log(`[${name}] Updated user ${duplicateId}: modified ${res.modifiedCount}`);

        // 2. Remove duplicate from chatparticipants so it doesn't show in any active directory
        const partRes = await db.collection('chatparticipants').deleteMany({ userId: duplicateId });
        console.log(`[${name}] Cleaned chatparticipants: deleted ${partRes.deletedCount}`);

        // 3. Verify
        const activeUsers = await db.collection('users').find({
            $or: [{ email: 'dilbar@kaal.ca' }, { email: 'dilber@kaal.ca' }, { email: 'dilber@steelage.ca' }],
            isActive: { $ne: false }
        }).project({ fullName: 1, email: 1, role: 1, isActive: 1 }).toArray();

        console.log(`[${name}] Active Dilber users remaining:`, activeUsers);
    } catch (err) {
        console.error(`[${name}] Error:`, err.message);
    } finally {
        await client.close();
    }
}

async function run() {
    await deactivateDuplicate(localUri, "LOCAL DB");
    console.log("-----------------------------------------");
    await deactivateDuplicate(atlasUri, "LIVE ATLAS DB");
}

run();

const { MongoClient, ObjectId } = require('mongodb');

async function deactivateComDilber() {
    const c = new MongoClient('mongodb://127.0.0.1:27017');
    await c.connect();
    const db = c.db('construction-saas');
    const uId = new ObjectId('6aca042387c80bf9ff100f2e');
    const res = await db.collection('users').updateOne(
        { _id: uId },
        { $set: { isActive: false, duplicateOf: new ObjectId('6abe1c27ce4d83703ae01cde'), updatedAt: new Date() } }
    );
    const pRes = await db.collection('chatparticipants').deleteMany({ userId: uId });
    console.log(`Deactivated dilber@kaal.com: modified ${res.modifiedCount}, removed ${pRes.deletedCount} chatparticipants`);
    await c.close();
}

deactivateComDilber();

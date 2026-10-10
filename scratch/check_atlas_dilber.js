const { MongoClient } = require('mongodb');

async function checkAtlas() {
    const atlasUri = "mongodb+srv://bard_admin:Bard%40Construction2026%21%21@bard-construction-clust.tarehtj.mongodb.net/construction-saas?appName=bard-construction-cluster";
    const client = new MongoClient(atlasUri);
    try {
        await client.connect();
        const db = client.db();
        const users = await db.collection('users').find({
            $or: [
                { email: 'dilbar@kaal.ca' },
                { email: 'dilber@kaal.ca' },
                { email: 'dilber@steelage.ca' }
            ]
        }).project({ fullName: 1, email: 1, role: 1 }).toArray();

        console.log("Atlas Dilber users:", users);
    } finally {
        await client.close();
    }
}

checkAtlas();

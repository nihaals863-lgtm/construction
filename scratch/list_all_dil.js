const { MongoClient } = require('mongodb');

async function listDil() {
    const c = new MongoClient('mongodb://127.0.0.1:27017');
    await c.connect();
    const db = c.db('construction-saas');
    const all = await db.collection('users').find({}).toArray();
    const filtered = all.filter(u => 
        (u.fullName && u.fullName.toLowerCase().includes('dil')) ||
        (u.email && u.email.toLowerCase().includes('dil'))
    );
    console.log("Total Dil users in local DB:", filtered.length);
    filtered.forEach(u => console.log({ id: u._id.toString(), name: u.fullName, email: u.email, role: u.role, isActive: u.isActive }));
    await c.close();
}

listDil();

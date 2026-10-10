const { MongoClient } = require('mongodb');

async function getLogins() {
    const c = new MongoClient('mongodb://127.0.0.1:27017');
    await c.connect();
    const db = c.db('construction-saas');
    const emails = ['raj@steelage.ca', 'dilber@kaal.ca', 'office@steelage.ca', 'company@admin.com', 'super@admin.com', 'engineer@kaal.ca'];
    const users = await db.collection('users').find({ email: { $in: emails } }).toArray();
    users.forEach(u => console.log(`Email: ${u.email} | Role: ${u.role} | Name: ${u.fullName}`));
    await c.close();
}

getLogins();

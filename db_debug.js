const mongoose = require('mongoose');
const fs = require('fs');

const uri = 'mongodb+srv://ankit:Ankit%401205patidar@cluster0.xoxzbbv.mongodb.net/construction-saas';

async function debug() {
    try {
        console.log('Connecting to DB...');
        await mongoose.connect(uri);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const users = await db.collection('users').find({}).toArray();
        const companies = await db.collection('companies').find({}).toArray();

        console.log(`Found ${users.length} users and ${companies.length} companies.`);

        const output = {
            users: users.map(u => ({
                id: u._id,
                fullName: u.fullName,
                role: u.role,
                companyId: u.companyId
            })),
            companies: companies.map(c => ({
                id: c._id,
                name: c.name
            }))
        };

        fs.writeFileSync('db_debug_output.json', JSON.stringify(output, null, 2));
        console.log('Debug complete. Output written to db_debug_output.json');
        process.exit(0);
    } catch (err) {
        console.error('Debug Error:', err);
        process.exit(1);
    }
}

debug();

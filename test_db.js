const mongoose = require('mongoose');

async function testConnection() {
    try {
        await mongoose.connect('mongodb+srv://ankit:Ankit%401205patidar@cluster0.xoxzbbv.mongodb.net/construction-saas');
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const clients = await db.collection('users').find({ role: 'CLIENT' }).toArray();
        console.log('Clients count:', clients.length);
        if (clients.length > 0) {
            console.log('Sample client:', clients[0].email);
        }

        const exactEmail = await db.collection('users').find({ email: { $regex: /client@kaal\.ca/i } }).toArray();
        console.log('Exact email test (case insensitive):', exactEmail.map(u => ({ email: u.email, role: u.role, passwordObjLen: u.password?.length, isActive: u.isActive })));
        
        mongoose.disconnect();
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

testConnection();

const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://ankit:Ankit%401205patidar@cluster0.xoxzbbv.mongodb.net/construction-saas';

async function main() {
    await mongoose.connect(mongoUri);
    console.log('Connected to DB');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const pm = await User.findOne({ role: 'PM' });
    console.log('PM found:', pm ? { _id: pm._id, fullName: pm.fullName, role: pm.role, companyId: pm.companyId } : 'none');

    const users = await User.find({ role: 'PM' });
    console.log('All PMs:', users.map(u => ({ _id: u._id, fullName: u.fullName })));

    await mongoose.disconnect();
}

main().catch(console.error);

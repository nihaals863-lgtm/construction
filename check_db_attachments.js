require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('./models/Chat');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const chats = await Chat.find({ 'attachments.0': { $exists: true } }).sort({ createdAt: -1 }).limit(1);
    console.log(JSON.stringify(chats, null, 2));
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });

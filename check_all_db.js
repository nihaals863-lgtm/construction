require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('./models/Chat');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const chats = await Chat.find({ 'attachments.url': { $regex: 'file://' } });
    console.log(`Found ${chats.length} chats with file:// URLs`);
    chats.forEach(c => {
        console.log(`ID: ${c._id}, isPending: ${c.attachments[0].isPending}, createdAt: ${c.createdAt}, updatedAt: ${c.updatedAt}`);
    });
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });

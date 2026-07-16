require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('./models/Chat');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const chat = new Chat({
        companyId: new mongoose.Types.ObjectId(),
        roomId: new mongoose.Types.ObjectId(),
        sender: new mongoose.Types.ObjectId(),
        message: 'Test',
        attachments: [{
            name: 'test',
            url: 'test',
            fileType: 'test',
            isPending: true
        }]
    });
    console.log("Before save:", chat.attachments[0].isPending);
    await chat.save();
    console.log("After save:", chat.attachments[0].isPending);
    await Chat.deleteOne({ _id: chat._id });
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });

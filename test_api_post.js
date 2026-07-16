require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('./models/Chat');
const User = require('./models/User');
const { sendMessage } = require('./controllers/chatController');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const user = await User.findOne({ companyId: { $exists: true } });
    const ChatRoom = require('./models/ChatRoom');
    const room = await ChatRoom.create({ companyId: user.companyId, roomType: 'GENERAL_COMPANY' });
    
    const req = {
        user: { _id: user._id, companyId: user.companyId, role: user.role, fullName: user.fullName },
        body: {
            message: 'Test API Post',
            roomId: room._id.toString(),
            attachments: [{
                name: 'test.jpg',
                url: 'file:///test.jpg',
                fileType: 'image/jpeg',
                isPending: true
            }]
        },
        app: { get: () => null }
    };
    const res = {
        status: (code) => { console.log('Status:', code); return res; },
        json: async (data) => {
            console.log('Response JSON isPending:', data.attachments[0].isPending);
            const chat = await Chat.findById(data._id);
            console.log('Saved to DB isPending:', chat.attachments[0].isPending);
            await Chat.deleteOne({ _id: data._id });
            await ChatRoom.deleteOne({ _id: room._id });
            process.exit(0);
        }
    };
    const next = (err) => { console.error('Next error:', err); process.exit(1); };
    
    await sendMessage(req, res, next);
}).catch(err => { console.error(err); process.exit(1); });

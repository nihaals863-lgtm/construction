const express = require('express');
const router = express.Router();
const {
    getChatRooms,
    getRoomMessages,
    sendMessage,
    getUnreadCount,
    markAsRead,
    getOrCreateDirectRoom,
    getChatUsers
} = require('../controllers/chatController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/rooms', getChatRooms);
router.get('/unread-count', getUnreadCount);
router.get('/users', getChatUsers);
router.post('/direct', getOrCreateDirectRoom);
router.put('/mark-read/:roomId', markAsRead);
router.get('/:roomId', getRoomMessages);
router.post('/', sendMessage);

module.exports = router;

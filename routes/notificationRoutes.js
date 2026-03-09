const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, markAllRead } = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getNotifications);
router.patch('/mark-all-read', markAllRead);
router.patch('/:id/read', markAsRead);

module.exports = router;

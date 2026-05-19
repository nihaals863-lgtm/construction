const express = require('express');
const router = express.Router();
const {
    getNotifications,
    markAsRead,
    markAllRead,
    clearAllNotifications,
    updateFcmToken,
    deactivateFcmToken
} = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getNotifications);
router.patch('/mark-all-read', markAllRead);
router.delete('/clear-all', clearAllNotifications);
router.post('/fcm-token', updateFcmToken);
router.post('/fcm-token/deactivate', deactivateFcmToken);
router.patch('/:id/read', markAsRead);

module.exports = router;

const Notification = require('../models/Notification');
const FcmToken = require('../models/FcmToken');

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res, next) => {
    try {
        const notifications = await Notification.find({ userId: req.user._id, companyId: req.user.companyId })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        res.json(notifications);
    } catch (error) {
        next(error);
    }
};

// @desc    Mark notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res, next) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id, companyId: req.user.companyId },
            { isRead: true },
            { new: true }
        );
        if (!notification) {
            res.status(404);
            throw new Error('Notification not found');
        }
        res.json(notification);
    } catch (error) {
        next(error);
    }
};

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/mark-all-read
// @access  Private
const markAllRead = async (req, res, next) => {
    try {
        const result = await Notification.updateMany(
            { userId: req.user._id, companyId: req.user.companyId, isRead: false },
            { isRead: true }
        );
        res.json({ message: 'All notifications marked as read', updatedCount: result.modifiedCount || 0 });
    } catch (error) {
        next(error);
    }
};

// @desc    Clear all notifications (Delete)
// @route   DELETE /api/notifications/clear-all
// @access  Private
const clearAllNotifications = async (req, res, next) => {
    try {
        await Notification.deleteMany({ userId: req.user._id, companyId: req.user.companyId });
        res.json({ message: 'All notifications cleared' });
    } catch (error) {
        next(error);
    }
};

// @desc    Register or update FCM Token
// @route   POST /api/notifications/fcm-token
// @access  Private
const updateFcmToken = async (req, res, next) => {
    try {
        const { token, platform } = req.body;
        if (!token || !platform) {
            res.status(400);
            throw new Error('FCM token and platform are required');
        }

        const fcmToken = await FcmToken.findOneAndUpdate(
            { token },
            {
                userId: req.user._id,
                platform,
                isActive: true
            },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'FCM token registered successfully', data: fcmToken });
    } catch (error) {
        next(error);
    }
};

// @desc    Deactivate FCM Token
// @route   POST /api/notifications/fcm-token/deactivate
// @access  Private
const deactivateFcmToken = async (req, res, next) => {
    try {
        const { token } = req.body;
        if (!token) {
            res.status(400);
            throw new Error('FCM token is required to deactivate');
        }

        await FcmToken.findOneAndUpdate(
            { token, userId: req.user._id },
            { isActive: false },
            { new: true }
        );

        res.status(200).json({ success: true, message: 'FCM token deactivated successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getNotifications,
    markAsRead,
    markAllRead,
    clearAllNotifications,
    updateFcmToken,
    deactivateFcmToken
};


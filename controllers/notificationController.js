const Notification = require('../models/Notification');

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

module.exports = {
    getNotifications,
    markAsRead,
    markAllRead,
    clearAllNotifications
};

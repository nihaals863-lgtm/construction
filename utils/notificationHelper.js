const Notification = require('../models/Notification');

/**
 * Helper to dispatch a notification via Socket.IO and save to DB
 * @param {Object} req - Express request object
 * @param {Object} data - { userId, title, message, link, type }
 */
const dispatchNotification = async (req, { userId, title, message, link, type = 'task' }) => {
    try {
        const notification = await Notification.create({
            companyId: req.user.companyId,
            userId,
            title,
            message,
            type,
            link: link || '/company-admin/notifications'
        });

        const io = req.app.get('io');
        if (io) {
            io.to(userId.toString()).emit('new_notification', notification);
        }
        return notification;
    } catch (err) {
        console.error('Notification dispatch failed:', err.message);
        return null;
    }
};

module.exports = { dispatchNotification };

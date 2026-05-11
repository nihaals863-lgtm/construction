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
const { upload, imageKitUpload } = require('../middlewares/imageKitUploadMiddleware');
const https = require('https');
const fs = require('fs');
const path = require('path');

router.use(protect);

// Unified download proxy for BOTH local and Cloudinary files
router.get('/download', async (req, res) => {
    try {
        const { url, name } = req.query;
        if (!url) return res.status(400).json({ message: 'URL is required' });

        // CASE 1: Local File (e.g. /uploads/chat/chat-...)
        if (url.includes('/uploads/chat/')) {
            const relativePath = url.split('/uploads/chat/')[1];
            const filePath = path.join(__dirname, '../uploads/chat', relativePath);
            
            if (fs.existsSync(filePath)) {
                res.setHeader('Content-Disposition', `attachment; filename="${name || path.basename(filePath)}"`);
                return fs.createReadStream(filePath).pipe(res);
            }
        }

        // CASE 2: ImageKit or Cloudinary Asset (External) - Force Download
        if (url.includes('cloudinary.com') || url.includes('ik.imagekit.io')) {
            return https.get(url, (externalRes) => {
                res.setHeader('Content-Type', externalRes.headers['content-type'] || 'application/octet-stream');
                res.setHeader('Content-Disposition', `attachment; filename="${name || 'file'}"`);
                externalRes.pipe(res);
            }).on('error', (e) => {
                console.error('External Download Error:', e);
                res.redirect(url); // Fallback to redirect if piping fails
            });
        }

        // Final fallback: redirect to the URL
        res.redirect(url);
    } catch (error) {
        console.error('Download Proxy Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/upload', upload.array('files', 10), imageKitUpload, (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }
    
    const results = files.map(file => ({
        name: file.originalname,
        url: file.path,
        fileType: file.mimetype
    }));
    
    res.json(results);
});

router.get('/rooms', getChatRooms);
router.get('/unread-count', getUnreadCount);
router.get('/users', getChatUsers);
router.post('/direct', getOrCreateDirectRoom);
router.put('/mark-read/:roomId', markAsRead);
router.get('/:roomId', getRoomMessages);
router.post('/', sendMessage);

module.exports = router;

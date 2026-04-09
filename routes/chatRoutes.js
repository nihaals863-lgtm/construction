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
const cloudinaryUpload = require('../middlewares/chatUploadMiddleware'); // Keep for old ones
const localUpload = require('../middlewares/localChatUpload'); // New local storage
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

        // CASE 2: Cloudinary Asset (Legacy or fallback)
        if (url.includes('cloudinary.com')) {
            const parts = url.split('/');
            const uploadIndex = parts.indexOf('upload');
            
            if (uploadIndex !== -1) {
                const resource_type = parts[uploadIndex - 1];
                let public_id_with_ext = parts.slice(uploadIndex + 2).join('/');
                
                const signedUrl = cloudinary.url(public_id_with_ext, {
                    resource_type: resource_type,
                    sign_url: true,
                    secure: true
                });

                return https.get(signedUrl, (cRes) => {
                    res.setHeader('Content-Type', cRes.headers['content-type'] || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `attachment; filename="${name || 'attachment'}"`);
                    cRes.pipe(res);
                }).on('error', (e) => res.status(500).send(e.message));
            }
        }

        // Final fallback: redirect to the URL if proxying is not possible
        res.redirect(url);
    } catch (error) {
        console.error('Download Proxy Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/upload', localUpload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Generate a full URL for the frontend
    const protocol = req.protocol;
    const host = req.get('host');
    const localUrl = `${protocol}://${host}/uploads/chat/${req.file.filename}`;
    
    res.json({
        name: req.file.originalname,
        url: localUrl,
        fileType: req.file.mimetype
    });
});

router.get('/rooms', getChatRooms);
router.get('/unread-count', getUnreadCount);
router.get('/users', getChatUsers);
router.post('/direct', getOrCreateDirectRoom);
router.put('/mark-read/:roomId', markAsRead);
router.get('/:roomId', getRoomMessages);
router.post('/', sendMessage);

module.exports = router;

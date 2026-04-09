const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Storage
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const isImage = file.mimetype.startsWith('image/');
        const resource_type = isImage ? 'image' : 'raw';
        const extension = file.originalname.split('.').pop();
        const cleanName = file.originalname.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_');
        
        return {
            folder: 'chat_attachments',
            resource_type: resource_type,
            public_id: `attachment-${Date.now()}-${cleanName}${resource_type === 'raw' ? `.${extension}` : ''}`,
            access_mode: 'public',
            type: 'upload'
        };
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

module.exports = upload;

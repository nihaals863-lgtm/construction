const multer = require('multer');
const ImageKit = require('imagekit');
const path = require('path');

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedExtensions = [
        '.pdf', '.dwg', '.dxf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
        '.txt', '.csv', '.zip', '.rar', '.7z'
    ];
    const allowedMimeTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv'
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = allowedMimeTypes.includes(file.mimetype);
    const extOk = ext === '' || allowedExtensions.includes(ext); // allow no-extension files
    
    if (mimeOk || (extOk && ext !== '')) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type! Allowed: ${allowedExtensions.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// Middleware to handle ImageKit upload after multer memory storage
const imageKitUpload = async (req, res, next) => {
    // Handle both single file (req.file) and multiple files (req.files)
    const files = req.file ? [req.file] : (req.files || []);
    
    if (files.length === 0) return next();

    try {
        let folder = '/general';
        if (req.baseUrl.includes('drawings')) folder = '/drawings';
        else if (req.baseUrl.includes('vendors')) folder = '/trades';
        else if (req.baseUrl.includes('rfis')) folder = '/rfis';
        else if (req.baseUrl.includes('chat')) folder = '/chat';
        else if (req.baseUrl.includes('issues')) folder = '/issues';
        else if (req.baseUrl.includes('invoices')) folder = '/invoices';
        else if (req.baseUrl.includes('project-documents')) folder = '/documents';

        const uploadPromises = files.map(async (file) => {
            // Derive extension: prefer from originalname, fall back to MIME type
            let ext = path.extname(file.originalname);
            if (!ext) {
                const mimeToExt = {
                    'image/jpeg': '.jpg', 'image/jpg': '.jpg',
                    'image/png': '.png', 'image/gif': '.gif',
                    'image/webp': '.webp', 'image/heic': '.jpg',
                    'application/pdf': '.pdf'
                };
                ext = mimeToExt[file.mimetype] || '.jpg';
            }
            const uploadResponse = await imagekit.upload({
                file: file.buffer,
                fileName: `${file.fieldname}-${Date.now()}${ext}`,
                folder: `construction_saas${folder}`,
                useUniqueFileName: true
            });
            
            // Attach the URL back to the file object so route handler can read it
            file.path = uploadResponse.url;
            file.mimetype = uploadResponse.fileType || file.mimetype;
            return uploadResponse;
        });

        await Promise.all(uploadPromises);
        next();
    } catch (error) {
        console.error('ImageKit Upload Error:', error);
        res.status(500).json({ message: 'Error uploading file(s) to ImageKit', error: error.message });
    }
};

module.exports = {
    upload,
    imageKitUpload
};

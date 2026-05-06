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
        '.pdf', '.dwg', '.dxf', '.jpg', '.jpeg', '.png', '.gif', 
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
        '.txt', '.csv', '.zip', '.rar', '.7z'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
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
            const uploadResponse = await imagekit.upload({
                file: file.buffer,
                fileName: `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`,
                folder: `construction_saas${folder}`,
                useUniqueFileName: true
            });
            
            // Attach the URL back to the file object
            file.path = uploadResponse.url;
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

const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        // Determine subfolder based on route
        let folder = 'general';
        if (req.baseUrl.includes('drawings')) folder = 'drawings';
        else if (req.baseUrl.includes('rfis')) folder = 'drawings';
        else if (req.baseUrl.includes('vendors')) folder = 'drawings';
        
        return {
            folder: `construction_saas/${folder}`,
            resource_type: 'auto', // Important for PDFs and non-image files
            public_id: `${file.fieldname}-${Date.now()}`,
        };
    },
});

const fileFilter = (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.dwg', '.dxf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = require('path').extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type! Allowed: PDF, DWG, DXF, JPG, PNG, DOC, DOCX, XLS'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

module.exports = upload;

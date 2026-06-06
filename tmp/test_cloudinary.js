const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('Testing Cloudinary upload...');
console.log('Cloud name:', process.env.CLOUDINARY_CLOUD_NAME);

// Upload a simple base64 image (a 1x1 transparent pixel)
const testImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

cloudinary.uploader.upload(testImage, { folder: 'test' })
    .then(result => {
        console.log('Cloudinary Upload Success!');
        console.log('URL:', result.secure_url);
        process.exit(0);
    })
    .catch(error => {
        console.error('Cloudinary Upload Failed:', error);
        process.exit(1);
    });

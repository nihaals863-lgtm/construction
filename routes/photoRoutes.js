const express = require('express');
const router = express.Router();
const { getPhotos, uploadPhoto, deletePhoto } = require('../controllers/photoController');
const { protect } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.use(protect);

router.get('/', getPhotos);
router.post('/upload', upload.single('image'), uploadPhoto);
router.delete('/:id', deletePhoto);

module.exports = router;

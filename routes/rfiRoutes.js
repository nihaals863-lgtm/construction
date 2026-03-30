const express = require('express');
const router = express.Router();
const {
    getRFIs, getRFIStats, getRFIById,
    createRFI, updateRFI, addComment, deleteRFI
} = require('../controllers/rfiController');
const { protect, authorize, checkPermission } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/fileUploadMiddleware');

router.use(protect);

router.get('/stats', checkPermission('VIEW_RFI'), getRFIStats);
router.get('/', checkPermission('VIEW_RFI'), getRFIs);
router.post('/', checkPermission('CREATE_RFI'), upload.array('files'), createRFI);
router.get('/:id', checkPermission('VIEW_RFI'), getRFIById);
router.patch('/:id', checkPermission('EDIT_RFI'), updateRFI);
router.post('/:id/comments', checkPermission('VIEW_RFI'), addComment);
router.delete('/:id', checkPermission('DELETE_RFI'), deleteRFI);

module.exports = router;

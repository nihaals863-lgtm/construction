const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { upload, imageKitUpload } = require('../middlewares/imageKitUploadMiddleware');
const {
    createDocument,
    getProjectDocuments,
    deleteDocument
} = require('../controllers/projectDocumentController');

// All routes are protected
router.use(protect);

router.post('/', 
    authorize('COMPANY_OWNER', 'PM', 'FOREMAN'), 
    upload.single('file'), 
    imageKitUpload, 
    createDocument
);

router.get('/:projectId', getProjectDocuments);

router.delete('/:id', 
    authorize('COMPANY_OWNER', 'PM', 'FOREMAN'), 
    deleteDocument
);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getDrawings, createDrawing, addDrawingVersion, deleteDrawing } = require('../controllers/drawingController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/fileUploadMiddleware');

router.use(protect);

router.get('/', getDrawings);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'ENGINEER'), upload.single('file'), createDrawing);
router.post('/:id/versions', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'ENGINEER'), upload.single('file'), addDrawingVersion);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteDrawing);

// Annotation Routes
const {
    getDrawingAnnotations,
    createDrawingAnnotation,
    updateDrawingAnnotation,
    deleteDrawingAnnotation
} = require('../controllers/drawingController');

router.get('/:id/annotations', getDrawingAnnotations);
router.post('/:id/annotations', createDrawingAnnotation);
router.patch('/annotations/:id', updateDrawingAnnotation);
router.delete('/annotations/:id', deleteDrawingAnnotation);

module.exports = router;

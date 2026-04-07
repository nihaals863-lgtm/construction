const express = require('express');
const router = express.Router();
const {
    createCorrectionRequest,
    getCorrectionRequests,
    updateCorrectionRequest,
    deleteCorrectionRequest,
    deleteMultipleCorrections
} = require('../controllers/correctionController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.route('/')
    .post(createCorrectionRequest)
    .get(getCorrectionRequests);

router.post('/bulk-delete', deleteMultipleCorrections);

router.route('/:id')
    .patch(updateCorrectionRequest)
    .delete(deleteCorrectionRequest);

module.exports = router;

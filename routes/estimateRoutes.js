const express = require('express');
const router = express.Router();
const { getEstimates, createEstimate, updateEstimate, deleteEstimate } = require('../controllers/estimateController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getEstimates);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), createEstimate);
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), updateEstimate);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteEstimate);

module.exports = router;

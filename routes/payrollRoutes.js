const express = require('express');
const router = express.Router();
const { getPayrollPreview, runPayroll, getPayrollHistory, getPayrollDetails, getPayrollSlip } = require('../controllers/payrollController');
const { protect, checkPermission } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/preview', checkPermission('MANAGE_FINANCIALS'), getPayrollPreview);
router.post('/run', checkPermission('MANAGE_FINANCIALS'), runPayroll);
router.get('/history', checkPermission('MANAGE_FINANCIALS'), getPayrollHistory);
router.get('/details', checkPermission('MANAGE_FINANCIALS'), getPayrollDetails);
router.get('/slip/:id', checkPermission('MANAGE_FINANCIALS'), getPayrollSlip);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice } = require('../controllers/invoiceController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getInvoices);
router.get('/:id', getInvoice);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), createInvoice);
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), updateInvoice);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteInvoice);

module.exports = router;

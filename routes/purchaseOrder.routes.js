const express = require('express');
const router = express.Router();
const poController = require('../controllers/purchaseOrder.controller');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Base Roles: Admin, PM, Foreman
const baseRoles = ['COMPANY_OWNER', 'PM', 'FOREMAN'];
const adminOnly = ['COMPANY_OWNER'];

router.use(protect);

// 1. CREATE PO
router.post('/', authorize(...baseRoles), poController.createPO);

// 2. GET ALL PO
router.get('/', authorize(...baseRoles), poController.getAllPOs);

// 3. GET SINGLE PO
router.get('/:id', authorize(...baseRoles), poController.getSinglePO);

// 4. UPDATE PO
router.patch('/:id', authorize(...baseRoles), poController.updatePO);

// 5. APPROVE PO
router.patch('/:id/approve', authorize(...adminOnly), poController.approvePO);

// 6. SEND TO VENDOR
router.patch('/:id/send', authorize(...adminOnly), poController.sendToVendor);

// 7. MARK DELIVERED
router.patch('/:id/deliver', authorize(...adminOnly), poController.markDelivered);

// 8. CLOSE PO
router.patch('/:id/close', authorize(...adminOnly), poController.closePO);

// 9. CANCEL PO
router.patch('/:id/cancel', authorize(...adminOnly), poController.cancelPO);

// 10. DELETE PO
router.delete('/:id', authorize(...baseRoles), poController.deletePO);

module.exports = router;

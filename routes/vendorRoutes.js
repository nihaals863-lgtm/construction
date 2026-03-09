const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public Routes (For External Trades)
router.get('/public/drawing/:id', vendorController.getPublicDrawingInfo);
router.post('/public/submit-bid', vendorController.submitBid);

router.use(protect);

// Vendor/Trade Management
router.post('/', authorize('COMPANY_OWNER', 'PM'), vendorController.createVendor);
router.get('/', vendorController.getVendors);
router.patch('/:id', authorize('COMPANY_OWNER', 'PM'), vendorController.updateVendor);
router.delete('/:id', authorize('COMPANY_OWNER', 'PM'), vendorController.deleteVendor);

// Drawing Distribution
router.post('/send-drawing', authorize('COMPANY_OWNER', 'PM'), vendorController.sendDrawingToTrades);

// Admin Bidding View
router.get('/bids', authorize('COMPANY_OWNER', 'PM'), vendorController.getBids);
router.patch('/bids/:id', authorize('COMPANY_OWNER', 'PM'), vendorController.updateBidStatus);

module.exports = router;

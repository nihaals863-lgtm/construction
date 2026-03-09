const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
    getStats,
    approveCompany,
    rejectCompany,
    getTransactions,
    getBillingStats,
    getSupportTickets,
    updateSupportTicket,
    getGlobalUsers,
    getSystemLogs
} = require('../controllers/superAdminController');

router.use(protect);
router.use(authorize('SUPER_ADMIN'));

router.get('/dashboard/stats', getStats);
router.patch('/companies/:id/approve', approveCompany);
router.patch('/companies/:id/reject', rejectCompany);

// Billing & Revenue
router.get('/billing/transactions', getTransactions);
router.get('/billing/stats', getBillingStats);

// Support
router.get('/support/tickets', getSupportTickets);
router.patch('/support/tickets/:id', updateSupportTicket);

// User Management
router.get('/users', getGlobalUsers);

// System Logs
router.get('/logs', getSystemLogs);

module.exports = router;

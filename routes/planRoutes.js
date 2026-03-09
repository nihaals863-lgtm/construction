const express = require('express');
const router = express.Router();
const { getPlans, createPlan, updatePlan, deletePlan } = require('../controllers/planController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public route for landing page & registration
router.get('/', getPlans);

// Admin only routes
router.post('/', protect, authorize('SUPER_ADMIN'), createPlan);
router.patch('/:id', protect, authorize('SUPER_ADMIN'), updatePlan);
router.delete('/:id', protect, authorize('SUPER_ADMIN'), deletePlan);

module.exports = router;

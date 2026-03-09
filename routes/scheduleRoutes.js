const express = require('express');
const router = express.Router();
const {
    getSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule
} = require('../controllers/scheduleController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getSchedules);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), createSchedule);
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), updateSchedule);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteSchedule);

module.exports = router;

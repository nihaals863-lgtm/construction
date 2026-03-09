const express = require('express');
const router = express.Router();
const { clockIn, clockOut, getTimeLogs, updateTimeLog } = require('../controllers/timeLogController');
const { protect, checkPermission } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getTimeLogs);
router.post('/clock-in', (req, res, next) => {
    if (req.body.userId && req.body.userId !== req.user._id.toString()) {
        return checkPermission('CLOCK_IN_CREW')(req, res, next);
    }
    next();
}, clockIn);
router.post('/clock-out', (req, res, next) => {
    if (req.body.userId && req.body.userId !== req.user._id.toString()) {
        return checkPermission('CLOCK_IN_CREW')(req, res, next);
    }
    next();
}, clockOut);
// updateTimeLog is used by Crew Control for bulk actions too
router.patch('/:id', checkPermission('CLOCK_IN_CREW'), updateTimeLog);

module.exports = router;

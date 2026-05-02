const express = require('express');
const router = express.Router();
const { clockIn, clockOut, getTimeLogs, updateTimeLog, deleteTimeLog } = require('../controllers/timeLogController');
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
// updateTimeLog and deleteTimeLog require permission
router.patch('/:id', checkPermission('CLOCK_IN_CREW'), updateTimeLog);
router.delete('/:id', checkPermission('CLOCK_IN_CREW'), deleteTimeLog);

module.exports = router;

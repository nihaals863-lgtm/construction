const express = require('express');
const router = express.Router();
const { getDailyLogs, createDailyLog, verifyDailyLog, updateDailyLog, deleteDailyLog, getDailyLogReports } = require('../controllers/dailyLogController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.use(protect);

router.get('/', getDailyLogs);
router.get('/reports', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getDailyLogReports);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN'), upload.array('photos', 5), createDailyLog);
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN'), upload.array('photos', 5), updateDailyLog);
router.post('/:id/verify', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), verifyDailyLog);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteDailyLog);

module.exports = router;

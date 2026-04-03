const express = require('express');
const router = express.Router();
const {
    getProjectReport,
    getCompanyReport,
    getDashboardStats,
    getWorkerAttendanceReport,
    getForemanAttendanceReport,
    getProjectAttendanceReport,
    exportAttendanceReport,
    getDetailedProjectReport
} = require('../controllers/reportController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/stats', getDashboardStats);
router.get('/company', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getCompanyReport);
router.get('/project/:projectId', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getProjectReport);
router.get('/detailed/:projectId', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getDetailedProjectReport);

// Attendance Reports
router.get('/attendance/workers', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getWorkerAttendanceReport);
router.get('/attendance/foremen', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getForemanAttendanceReport);
router.get('/attendance/projects', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), getProjectAttendanceReport);

module.exports = router;

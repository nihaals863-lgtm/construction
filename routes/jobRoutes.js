const express = require('express');
const router = express.Router();
const {
    getJobs,
    getJobById,
    createJob,
    updateJob,
    deleteJob,
    getJobFullHistory,
    generateJobHistoryPDF
} = require('../controllers/jobController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getJobs);
router.get('/:id', getJobById);
router.get('/:id/full-history', getJobFullHistory);
router.get('/:id/history-pdf', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN'), generateJobHistoryPDF);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), createJob);
router.post('/:id/assign-foreman', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN'), updateJob);
router.post('/:id/assign-workers', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN'), updateJob);
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN', 'WORKER'), updateJob);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteJob);

module.exports = router;

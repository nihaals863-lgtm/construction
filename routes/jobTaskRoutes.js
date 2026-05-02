const express = require('express');
const router = express.Router();
const {
    createJobTask,
    getJobTasks,
    updateJobTask,
    deleteJobTask,
    getWorkerTasks
} = require('../controllers/jobTaskController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

// Worker specific route - must be before restricted job routes or specialized with unique path
router.get('/worker', authorize('WORKER', 'SUBCONTRACTOR', 'FOREMAN', 'PM', 'COMPANY_OWNER'), getWorkerTasks);

// Job specific routes
router.get('/job/:jobId', getJobTasks);

// CRUD routes
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM', 'FOREMAN'), createJobTask);
router.patch('/:id', updateJobTask); // Authorization handled inside controller for worker status updates
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteJobTask);

module.exports = router;

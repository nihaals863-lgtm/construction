const express = require('express');
const router = express.Router();
const {
    getProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    getProjectMembers,
    getClientProgress,
    getProjectClientUpdates,
    createProjectClientUpdate,
    getProjectFinancialSummary
} = require('../controllers/projectController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { checkProjectLimit } = require('../middlewares/checkPlanLimits');
const upload = require('../middlewares/uploadMiddleware');

router.use(protect); // All routes protected

router.get('/', getProjects);
router.get('/:id', getProjectById);
router.get('/:id/members', getProjectMembers);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), checkProjectLimit, createProject);
router.post('/:id/assign-pm', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), updateProject); // Reuse updateProject for now or create specific controller
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), updateProject);
router.get('/:id/client-progress', getClientProgress);
router.get('/:id/client-updates', getProjectClientUpdates);
router.post('/:id/client-updates', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), upload.array('images', 5), createProjectClientUpdate);
router.get('/:id/financial-summary', getProjectFinancialSummary);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), deleteProject);

module.exports = router;

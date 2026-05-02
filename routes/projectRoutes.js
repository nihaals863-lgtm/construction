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
    getProjectFinancialSummary,
    getArchivedProjects,
    restoreProject,
    permanentlyDeleteProject
} = require('../controllers/projectController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { checkProjectLimit } = require('../middlewares/checkPlanLimits');
const upload = require('../middlewares/uploadMiddleware');

router.use(protect); // All routes protected

router.get('/', getProjects);
router.get('/archived', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), getArchivedProjects);
router.get('/:id', getProjectById);
router.get('/:id/members', getProjectMembers);
router.post('/', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), checkProjectLimit, upload.single('image'), createProject);
router.post('/:id/assign-pm', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), updateProject); 
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), upload.single('image'), updateProject);
router.get('/:id/client-progress', getClientProgress);
router.get('/:id/client-updates', getProjectClientUpdates);
router.post('/:id/client-updates', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), upload.array('images', 5), createProjectClientUpdate);
router.get('/:id/financial-summary', getProjectFinancialSummary);
router.patch('/:id/restore', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), restoreProject);
router.delete('/:id/permanent', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), permanentlyDeleteProject);
router.delete('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER', 'PM'), deleteProject); // Changed access to include PM for archiving

module.exports = router;

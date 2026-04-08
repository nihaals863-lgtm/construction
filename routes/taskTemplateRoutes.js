const express = require('express');
const router = express.Router();
const { getTemplates, createTemplate, deleteTemplate, updateTemplate, applyTemplate, createTemplateFromTask, bulkDeleteTemplates, reorderTemplates } = require('../controllers/taskTemplateController');
const { protect, checkPermission } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getTemplates);
router.post('/', checkPermission('CREATE_TASK'), createTemplate);
router.post('/from-task', checkPermission('CREATE_TASK'), createTemplateFromTask);
router.post('/reorder', checkPermission('UPDATE_TASK'), reorderTemplates);
router.post('/bulk-delete', checkPermission('DELETE_TASK'), bulkDeleteTemplates);
router.patch('/:id', checkPermission('UPDATE_TASK'), updateTemplate);
router.post('/:id/apply', checkPermission('CREATE_TASK'), applyTemplate);
router.delete('/:id', checkPermission('DELETE_TASK'), deleteTemplate);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getTemplates, createTemplate, deleteTemplate, updateTemplate } = require('../controllers/taskTemplateController');
const { protect, checkPermission } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getTemplates);
router.post('/', checkPermission('CREATE_TASK'), createTemplate);
router.patch('/:id', checkPermission('UPDATE_TASK'), updateTemplate);
router.delete('/:id', checkPermission('DELETE_TASK'), deleteTemplate);

module.exports = router;

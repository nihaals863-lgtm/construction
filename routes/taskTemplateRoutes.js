const express = require('express');
const router = express.Router();
const { getTemplates, createTemplate, deleteTemplate } = require('../controllers/taskTemplateController');
const { protect, checkPermission } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getTemplates);
router.post('/', checkPermission('CREATE_TASK'), createTemplate);
router.delete('/:id', checkPermission('DELETE_TASK'), deleteTemplate);

module.exports = router;

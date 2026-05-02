const express = require('express');
const router = express.Router();
const { getIssues, createIssue, updateIssue, deleteIssue } = require('../controllers/issueController');
const { protect } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.use(protect);

router.get('/', getIssues);
router.post('/', upload.array('images', 5), createIssue);
router.patch('/:id', upload.array('images', 5), updateIssue);
router.delete('/:id', deleteIssue);

module.exports = router;

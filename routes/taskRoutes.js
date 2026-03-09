const express = require('express');
const router = express.Router();
const {
    getTasks,
    getMyTasks,
    getProjectTasks,
    createTask,
    assignTask,
    updateTask,
    deleteTask,
    getSubTasks,
    createSubTask,
    updateSubTask,
    deleteSubTask
} = require('../controllers/taskController');
const { protect, authorize, checkPermission } = require('../middlewares/authMiddleware');

router.use(protect);

// Must be before /:id to avoid route conflict
router.get('/my-tasks', getMyTasks);
router.get('/project/:projectId', getProjectTasks);

router.get('/', checkPermission('VIEW_TASKS'), getTasks);
router.post('/', checkPermission('CREATE_TASK'), createTask);

router.put('/:id/assign', checkPermission('EDIT_TASK'), assignTask);
router.patch('/:id', updateTask); // Internal role checks or generic update
router.delete('/:id', checkPermission('DELETE_TASK'), deleteTask);

// Sub-tasks
router.get('/:id/subtasks', getSubTasks);
router.post('/:id/subtasks', createSubTask);
router.patch('/:id/subtasks/:subTaskId', updateSubTask);
router.delete('/:id/subtasks/:subTaskId', deleteSubTask);

module.exports = router;

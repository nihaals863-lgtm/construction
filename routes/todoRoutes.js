const express = require('express');
const router = express.Router();
const {
    getTodos,
    getAssignedByMeTodos,
    createTodo,
    updateTodo,
    deleteTodo
} = require('../controllers/todoController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getTodos);
router.get('/assigned-by', getAssignedByMeTodos);
router.post('/', createTodo);
router.patch('/:id', updateTodo);
router.delete('/:id', deleteTodo);

module.exports = router;

const express = require('express');
const router = express.Router();
const { loginUser, registerUser, registerCompany, getMe, getUsers, updateUser, deleteUser, createUser, updatePassword } = require('../controllers/authController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.post('/login', loginUser);
router.post('/register', registerUser);
router.post('/register-company', registerCompany);
router.get('/me', protect, getMe);
router.get('/users', protect, getUsers);
router.post('/users', protect, authorize('SUPER_ADMIN', 'COMPANY_OWNER'), createUser);
router.patch('/users/:id', protect, authorize('SUPER_ADMIN', 'COMPANY_OWNER'), updateUser);
router.patch('/updatepassword', protect, updatePassword);
router.delete('/users/:id', protect, authorize('SUPER_ADMIN', 'COMPANY_OWNER'), deleteUser);

module.exports = router;

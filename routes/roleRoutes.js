const express = require('express');
const router = express.Router();
const { getRoles, getAllPermissions, getUserPermissions, updateUserOverrides, getMyPermissions, updateRolePermissions, bulkUpdateRolePermissions } = require('../controllers/roleController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/my-permissions', getMyPermissions);
router.get('/permissions', authorize('COMPANY_OWNER', 'SUPER_ADMIN'), getAllPermissions);
router.get('/user/:userId', authorize('COMPANY_OWNER', 'SUPER_ADMIN'), getUserPermissions);
router.post('/user/:userId/overrides', authorize('COMPANY_OWNER', 'SUPER_ADMIN'), updateUserOverrides);

// Only COMPANY_OWNER and SUPER_ADMIN can view and update roles
router.get('/', authorize('COMPANY_OWNER', 'SUPER_ADMIN'), getRoles);
router.put('/bulk', authorize('COMPANY_OWNER', 'SUPER_ADMIN'), bulkUpdateRolePermissions);
router.put('/:roleName', authorize('COMPANY_OWNER', 'SUPER_ADMIN'), updateRolePermissions);

module.exports = router;

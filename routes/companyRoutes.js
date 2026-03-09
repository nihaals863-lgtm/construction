const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getCompanies,
    getCompanyById,
    createCompany,
    updateCompany,
    deleteCompany
} = require('../controllers/companyController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect); // All routes protected

router.get('/dashboard/stats', authorize('COMPANY_OWNER', 'COMPANY_ADMIN'), getDashboardStats);

router.get('/', authorize('SUPER_ADMIN'), getCompanies);
router.post('/', authorize('SUPER_ADMIN'), createCompany);
router.get('/:id', getCompanyById);
router.patch('/:id', authorize('SUPER_ADMIN', 'COMPANY_OWNER'), updateCompany);
router.delete('/:id', authorize('SUPER_ADMIN'), deleteCompany);

module.exports = router;

const User = require('../models/User');
const Company = require('../models/Company');
const Plan = require('../models/Plan');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { fetchUserPermissions } = require('./roleController');

// @desc    Register a new company and owner
// @route   POST /api/auth/register-company
// @access  Public
const registerCompany = async (req, res, next) => {
    try {
        const { companyName, fullName, email, password, phone, plan } = req.body;

        // Check if user exists
        const userExists = await User.findOne({ email });
        if (userExists) {
            res.status(400);
            throw new Error('User with this email already exists');
        }

        // Check if company exists
        const companyExists = await Company.findOne({ name: companyName });
        if (companyExists) {
            res.status(400);
            throw new Error('Company with this name already exists');
        }

        // --- RESOLVE PLAN IF STRING ---
        let finalPlanId = null;
        const searchPlan = plan || 'starter';
        if (searchPlan && typeof searchPlan === 'string' && !mongoose.Types.ObjectId.isValid(searchPlan)) {
            const planDoc = await Plan.findOne({ name: new RegExp('^' + searchPlan + '$', 'i') });
            finalPlanId = planDoc ? planDoc._id : null;
        } else if (mongoose.Types.ObjectId.isValid(searchPlan)) {
            finalPlanId = searchPlan;
        }
        // ------------------------------

        // Create Company
        const company = await Company.create({
            name: companyName,
            email: email, // Default to owner email
            subscriptionPlanId: finalPlanId,
            subscriptionStatus: 'active'
        });

        // Create Owner User
        const user = await User.create({
            fullName,
            email,
            password,
            role: 'COMPANY_OWNER',
            companyId: company._id,
            phone,
            isActive: false // Important: Needs approval
        });

        // Update company to pending
        company.subscriptionStatus = 'pending';
        await company.save();

        res.status(201).json({
            message: 'Company and Owner registered successfully',
            user: {
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                companyId: user.companyId
            }
            // Removed token generation here as they can't login yet
        });
    } catch (error) {
        next(error);
    }
};

const generateToken = (userId, role, companyId) => {
    return jwt.sign({ userId, role, companyId }, process.env.JWT_SECRET, {
        expiresIn: '7d',
    });
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (user && (await user.matchPassword(password))) {
            if (!user.isActive) {
                res.status(401);
                throw new Error('Your account is currently under review by the Super Admin. Once all required checks are completed, your access will be approved. Please wait or contact your administrator for updates');
            }

            // Check if company's plan is expired
            if (user.companyId) { // Check only if user belongs to a company
                const company = await Company.findById(user.companyId);
                if (company) {
                    if (company.expireDate && new Date(company.expireDate) < new Date()) {
                        res.status(401);
                        throw new Error('Company subscription plan has expired. Please contact support to renew.');
                    }
                }
            }

            const permissions = await fetchUserPermissions(user);

            res.json({
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                companyId: user.companyId,
                avatar: user.avatar,
                token: generateToken(user._id, user.role, user.companyId),
                permissions
            });
        } else {
            res.status(401);
            throw new Error('Invalid email or password');
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res, next) => {
    try {
        const { fullName, email, password, role, companyId, phone } = req.body;

        if (!companyId) {
            res.status(400);
            throw new Error('Company ID is required. If you are creating a new company, use /api/auth/register-company.');
        }

        const userExists = await User.findOne({ email });

        if (userExists) {
            res.status(400);
            throw new Error('User already exists');
        }

        const user = await User.create({
            fullName,
            email,
            password,
            role: role || 'COMPANY_OWNER',
            companyId,
            phone
        });

        if (user) {
            res.status(201).json({
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                companyId: user.companyId,
                avatar: user.avatar,
                token: generateToken(user._id, user.role, user.companyId),
            });
        } else {
            res.status(400);
            throw new Error('Invalid user data');
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            res.json({
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                companyId: user.companyId,
                avatar: user.avatar,
            });
        } else {
            res.status(404);
            throw new Error('User not found');
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Get all users for a company
// @route   GET /api/auth/users
// @access  Private
const getUsers = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };
        console.log('getUsers req.user:', { id: req.user._id, role: req.user.role, companyId: req.user.companyId });

        // Super Admin can see all users
        if (req.user.role === 'SUPER_ADMIN') {
            delete query.companyId;
        }

        // Support role filtering
        if (req.query.role) {
            query.role = req.query.role;
        }

        console.log('getUsers query:', query);
        const users = await User.find(query).select('-password');
        console.log('getUsers found count:', users.length);
        res.json(users);
    } catch (error) {
        console.error('getUsers error:', error);
        next(error);
    }
};

// @desc    Update user
// @route   PATCH /api/auth/users/:id
// @access  Private (Company Owner or Super Admin)
const updateUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        // Multi-tenant check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== user.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to update this user');
        }

        // Update fields
        Object.keys(req.body).forEach(key => {
            if (key !== '_id' && key !== 'companyId') {
                user[key] = req.body[key];
            }
        });

        await user.save();
        
        const updatedUser = user.toObject();
        delete updatedUser.password;

        res.json(updatedUser);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete user
// @route   DELETE /api/auth/users/:id
// @access  Private (Company Owner or Super Admin)
const deleteUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        // Multi-tenant check
        if (req.user.role !== 'SUPER_ADMIN' && req.user.companyId.toString() !== user.companyId.toString()) {
            res.status(403);
            throw new Error('Not authorized to delete this user');
        }

        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'User removed' });
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new user (Internal/Admin)
// @route   POST /api/auth/users
// @access  Private (Company Owner/Admin)
const createUser = async (req, res, next) => {
    try {
        const { fullName, email, password, role, phone } = req.body;

        // Ensure current user has a company
        if (!req.user.companyId) {
            res.status(400);
            throw new Error('Current user does not belong to a company');
        }

        // ---------------------------

        const userExists = await User.findOne({ email });

        if (userExists) {
            res.status(400);
            throw new Error('User already exists');
        }

        const user = await User.create({
            fullName,
            email,
            password,
            role: role || 'WORKER',
            roleId: req.body.roleId,
            companyId: req.user.companyId,
            phone,
            isActive: true // Created by admin, so active by default
        });

        if (user) {
            res.status(201).json({
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                companyId: user.companyId
            });
        } else {
            res.status(400);
            throw new Error('Invalid user data');
        }
    } catch (error) {
        next(error);
    }
};



// @desc    Update password
// @route   PATCH /api/auth/updatepassword
// @access  Private
const updatePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id);

        if (user && (await user.matchPassword(currentPassword))) {
            user.password = newPassword;
            await user.save();
            res.json({ message: 'Password updated' });
        } else {
            res.status(401);
            throw new Error('Invalid current password');
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Update current user profile
// @route   PATCH /api/auth/profile
// @access  Private
const updateProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        const { fullName, email, avatar, phone } = req.body;

        if (fullName) user.fullName = fullName;
        if (email) user.email = email;
        if (avatar) user.avatar = avatar;
        if (phone) user.phone = phone;

        await user.save();

        const updatedUser = user.toObject();
        delete updatedUser.password;

        res.json(updatedUser);
    } catch (error) {
        next(error);
    }
};

module.exports = { loginUser, registerUser, registerCompany, getMe, getUsers, updateUser, deleteUser, createUser, updatePassword, updateProfile };

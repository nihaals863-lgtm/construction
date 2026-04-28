const Role = require('../models/Role');
const RolePermission = require('../models/RolePermission');
const UserPermission = require('../models/UserPermission');
const Permission = require('../models/Permission');
const Company = require('../models/Company');
const Plan = require('../models/Plan');

// @desc    Get all roles
// @route   GET /api/roles
// @access  Private (Admin)
const getRoles = async (req, res, next) => {
    try {
        const roles = await Role.find();
        
        // Enhance roles with their permissions
        const rolesWithPermissions = await Promise.all(roles.map(async (role) => {
            const rolePermDocs = await RolePermission.find({ roleId: role._id }).populate('permissionId');
            return {
                ...role.toObject(),
                permissions: rolePermDocs
                    .filter(rp => rp.permissionId)
                    .map(rp => rp.permissionId.key)
            };
        }));
        
        res.json(rolesWithPermissions);
    } catch (error) {
        next(error);
    }
};

// @desc    Get all permissions
// @route   GET /api/roles/permissions
// @access  Private (Admin)
const getAllPermissions = async (req, res, next) => {
    try {
        const permissions = await Permission.find().sort({ module: 1, name: 1 });
        res.json(permissions);
    } catch (error) {
        next(error);
    }
};

// @desc    Get user permissions (including overrides)
// @route   GET /api/roles/user/:userId
// @access  Private (Admin)
const getUserPermissions = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const user = await require('../models/User').findById(userId);
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        let roleId = user.roleId;
        if (!roleId) {
            const roleDoc = await Role.findOne({ name: user.role });
            if (roleDoc) roleId = roleDoc._id;
        }

        // Parallel fetch for efficiency
        const [rolePermDocs, overrideDocs] = await Promise.all([
            roleId ? RolePermission.find({ roleId }).populate('permissionId') : [],
            UserPermission.find({ userId }).populate('permissionId')
        ]);

        const rolePermissions = rolePermDocs
            .filter(rp => rp.permissionId)
            .map(rp => rp.permissionId.key);

        const overrides = overrideDocs
            .filter(o => o.permissionId)
            .map(o => ({
                key: o.permissionId.key,
                isAllowed: o.isAllowed
            }));

        res.json({ rolePermissions, overrides });
    } catch (error) {
        next(error);
    }
};

// @desc    Update user permission overrides
// @route   POST /api/roles/user/:userId/overrides
// @access  Private (Admin)
const updateUserOverrides = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { overrides } = req.body; // Array of { key: 'VIEW_RFI', isAllowed: true/false }

        for (const override of overrides) {
            const perm = await Permission.findOne({ key: override.key });
            if (!perm) continue;

            await UserPermission.findOneAndUpdate(
                { userId, permissionId: perm._id },
                { userId, permissionId: perm._id, isAllowed: override.isAllowed },
                { upsert: true, new: true }
            );
        }

        res.json({ message: 'User overrides updated successfully' });
    } catch (error) {
        next(error);
    }
};

// Helper function to get permissions for a user
const fetchUserPermissions = async (user) => {
    try {
        let roleId = user.roleId?._id || user.roleId;

        if (!roleId) {
            const roleDoc = await Role.findOne({ name: user.role });
            if (roleDoc) roleId = roleDoc._id;
        }

        const [rolePermDocs, overrideDocs] = await Promise.all([
            roleId ? RolePermission.find({ roleId }).populate('permissionId') : [],
            UserPermission.find({ userId: user._id }).populate('permissionId')
        ]);

        const permissions = new Set(
            rolePermDocs
                .filter(rp => rp.permissionId)
                .map(rp => rp.permissionId.key)
        );

        overrideDocs.forEach(o => {
            if (o.permissionId) {
                if (o.isAllowed) {
                    permissions.add(o.permissionId.key);
                } else {
                    permissions.delete(o.permissionId.key);
                }
            }
        });

        let finalPermissions = Array.from(permissions);

        if (user.companyId) {
            let plan = null;
            if (user.companyDetails && user.companyDetails.subscriptionPlanId) {
                plan = user.companyDetails.subscriptionPlanId;
            } else {
                const company = await Company.findById(user.companyId).lean();
                if (company && company.subscriptionPlanId) {
                    const mongoose = require('mongoose');
                    const planQuery = mongoose.Types.ObjectId.isValid(company.subscriptionPlanId)
                        ? { _id: company.subscriptionPlanId }
                        : { name: new RegExp('^' + company.subscriptionPlanId + '$', 'i') };
                    plan = await Plan.findOne(planQuery).lean();
                }
            }

            if (plan && plan.rolePermissions) {
                const roleKey = user.role.toUpperCase().replace(/\s/g, '_');
                let allowedByPlan = (plan.rolePermissions instanceof Map)
                    ? plan.rolePermissions.get(roleKey)
                    : plan.rolePermissions[roleKey];

                if (!allowedByPlan) {
                    if (roleKey === 'COMPANY_OWNER') {
                        allowedByPlan = (plan.rolePermissions instanceof Map) ? plan.rolePermissions.get('ADMIN') : plan.rolePermissions['ADMIN'];
                    }
                    if (roleKey === 'PM') {
                        allowedByPlan = (plan.rolePermissions instanceof Map) ? plan.rolePermissions.get('PROJECT_MANAGER') : plan.rolePermissions['PROJECT_MANAGER'];
                    }
                }

                if (allowedByPlan && Array.isArray(allowedByPlan)) {
                    finalPermissions = finalPermissions.filter(p => allowedByPlan.includes(p));
                }
            }
        }

        return finalPermissions;
    } catch (error) {
        console.error('Permission fetching error:', error);
        return [];
    }
};

// @desc    Get permissions for current user
// @route   GET /api/roles/my-permissions
// @access  Private
const getMyPermissions = async (req, res, next) => {
    try {
        if (req.user.role === 'SUPER_ADMIN') {
            return res.json({ role: 'SUPER_ADMIN', permissions: ['ALL'] });
        }

        const permissions = await fetchUserPermissions(req.user);

        res.json({
            role: req.user.role,
            permissions
        });
    } catch (error) {
        next(error);
    }
};

const updateRolePermissions = async (req, res, next) => {
    try {
        const { roleName } = req.params;
        const { permissions } = req.body; // Array of permission keys

        const role = await Role.findOne({ name: roleName });
        if (!role) {
            res.status(404);
            throw new Error('Role not found');
        }

        await RolePermission.deleteMany({ roleId: role._id });

        for (const key of permissions) {
            const perm = await Permission.findOne({ key });
            if (perm) {
                await RolePermission.create({
                    roleId: role._id,
                    permissionId: perm._id
                });
            }
        }

        res.json({ message: 'Role permissions updated successfully' });
    } catch (error) {
        next(error);
    }
};

const bulkUpdateRolePermissions = async (req, res, next) => {
    try {
        const { roleUpdates } = req.body;

        for (const update of roleUpdates) {
            const { roleName, permissions } = update;
            const role = await Role.findOne({ name: roleName });
            if (role) {
                await RolePermission.deleteMany({ roleId: role._id });
                for (const key of permissions) {
                    const perm = await Permission.findOne({ key });
                    if (perm) {
                        await RolePermission.create({
                            roleId: role._id,
                            permissionId: perm._id
                        });
                    }
                }
            }
        }

        res.json({ message: 'All role permissions updated successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getRoles,
    getAllPermissions,
    getUserPermissions,
    updateUserOverrides,
    getMyPermissions,
    updateRolePermissions,
    bulkUpdateRolePermissions,
    fetchUserPermissions
};

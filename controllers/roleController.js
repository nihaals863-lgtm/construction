const Role = require('../models/Role');
const Permission = require('../models/Permission');
const RolePermission = require('../models/RolePermission');
const UserPermission = require('../models/UserPermission');
const User = require('../models/User');
const Company = require('../models/Company');
const Plan = require('../models/Plan');

// @desc    Get all roles
// @route   GET /api/roles
// @access  Private (SUPER_ADMIN, COMPANY_OWNER)
const getRoles = async (req, res, next) => {
    try {
        const roles = await Role.find().sort({ name: 1 });

        // Fetch all role permissions in one go
        const roleIds = roles.map(r => r._id);
        const allRolePerms = await RolePermission.find({ roleId: { $in: roleIds } }).populate('permissionId');

        // Group by roleId
        const permsByRole = allRolePerms.reduce((acc, rp) => {
            if (!acc[rp.roleId]) acc[rp.roleId] = [];
            if (rp.permissionId) acc[rp.roleId].push(rp.permissionId.key);
            return acc;
        }, {});

        const rolesWithPerms = roles.map(role => ({
            _id: role._id,
            name: role.name,
            description: role.description,
            permissions: permsByRole[role._id] || []
        }));

        res.json(rolesWithPerms);
    } catch (error) {
        next(error);
    }
};

// @desc    Update permissions for a specific role
// @route   PUT /api/roles/:roleName
// @access  Private (Admin)
const updateRolePermissions = async (req, res, next) => {
    try {
        const { roleName } = req.params;
        const { permissions } = req.body; // Array of permission keys

        const role = await Role.findOne({ name: roleName });
        if (!role) {
            res.status(404);
            throw new Error('Role not found');
        }

        // 1. Delete existing permissions for this role
        await RolePermission.deleteMany({ roleId: role._id });

        // 2. Add new permissions
        if (permissions && Array.isArray(permissions)) {
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

        res.json({ message: `Permissions for role ${roleName} updated successfully` });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all system permissions grouped by module
// @route   GET /api/roles/permissions
// @access  Private (Admin)
const getAllPermissions = async (req, res, next) => {
    try {
        const permissions = await Permission.find().sort({ module: 1, key: 1 });
        res.json(permissions);
    } catch (error) {
        next(error);
    }
};

// @desc    Bulk update permissions for multiple roles
// @route   PUT /api/roles/bulk
// @access  Private (Admin)
const bulkUpdateRolePermissions = async (req, res, next) => {
    try {
        const { roleUpdates } = req.body; // Array of { roleName: 'PM', permissions: ['VIEW_TASKS', ...] }

        if (!roleUpdates || !Array.isArray(roleUpdates)) {
            res.status(400);
            throw new Error('Invalid role updates data');
        }

        for (const update of roleUpdates) {
            const role = await Role.findOne({ name: update.roleName });
            if (!role) continue;

            // Delete existing permissions for this role
            await RolePermission.deleteMany({ roleId: role._id });

            // Add new permissions
            if (update.permissions && Array.isArray(update.permissions)) {
                for (const key of update.permissions) {
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

        res.json({ message: 'Bulk permissions updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @desc    Get permissions for a specific user (Role base + Overrides)
// @route   GET /api/roles/user/:userId
// @access  Private (Admin)
const getUserPermissions = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId).populate('roleId');
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        let roleId = user.roleId?._id || user.roleId; // Handle both populated and unpopulated
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
    let roleId = user.roleId?._id || user.roleId;

    if (!roleId) {
        const roleDoc = await Role.findOne({ name: user.role });
        if (roleDoc) roleId = roleDoc._id;
    }

    // Parallel fetch for efficiency: Fetch all role-based perms and all user overrides
    const [rolePermDocs, overrideDocs] = await Promise.all([
        roleId ? RolePermission.find({ roleId }).populate('permissionId') : [],
        UserPermission.find({ userId: user._id }).populate('permissionId')
    ]);

    // Create a set of keys allowed by the role
    const permissions = new Set(
        rolePermDocs
            .filter(rp => rp.permissionId)
            .map(rp => rp.permissionId.key)
    );

    // Apply overrides: Add if allowed, remove if explicitly denied
    overrideDocs.forEach(o => {
        if (o.permissionId) {
            if (o.isAllowed) {
                permissions.add(o.permissionId.key);
            } else {
                permissions.delete(o.permissionId.key);
            }
        }
    });

    const finalPermissions = Array.from(permissions);

    // PLAN FILTERING:
    // If the user belongs to a company, filter their permissions against the company's subscription plan.
    if (user.companyId) {
        try {
            const company = await Company.findById(user.companyId);
            if (company && company.subscriptionPlanId) {
                const mongoose = require('mongoose');
                const planQuery = mongoose.Types.ObjectId.isValid(company.subscriptionPlanId)
                    ? { _id: company.subscriptionPlanId }
                    : { name: new RegExp('^' + company.subscriptionPlanId + '$', 'i') };

                const plan = await Plan.findOne(planQuery);
                if (plan && plan.rolePermissions && plan.rolePermissions instanceof Map) {
                    // Map company roles to plan keys
                    const roleKey = user.role.toUpperCase().replace(/\s/g, '_');
                    
                    // Search for permissions in the plan using the role key or common aliases
                    let allowedByPlan = plan.rolePermissions.get(roleKey);
                    
                    // Fallbacks for legacy plan versions or naming differences
                    if (!allowedByPlan) {
                        if (roleKey === 'COMPANY_OWNER') allowedByPlan = plan.rolePermissions.get('ADMIN');
                        if (roleKey === 'PM') allowedByPlan = plan.rolePermissions.get('PROJECT_MANAGER');
                    }
                    
                    // If the plan has specific permissions for this role, filter against it
                    if (allowedByPlan && Array.isArray(allowedByPlan)) {
                        return finalPermissions.filter(p => allowedByPlan.includes(p));
                    }
                }
            }
        } catch (error) {
            console.error('Plan-based permission filtering error:', error);
            // Default to granting standard permissions if filtering fails
        }
    }

    return finalPermissions;
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

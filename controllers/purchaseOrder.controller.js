const PurchaseOrder = require('../models/purchaseOrder.model');
const Project = require('../models/Project');
const Vendor = require('../models/Vendor');
const Counter = require('../models/Counter');

// Create PO
exports.createPO = async (req, res) => {
    try {
        const { projectId, jobId, vendorId, vendorName, vendorEmail, items, notesToVendor, internalNotes, expectedDeliveryDate, totalAmount, subtotal, tax } = req.body;
        
        // Clean optional IDs
        const cleanVendorId = vendorId || null;
        const cleanJobId = jobId || null;

        // Skip strict Vendor verification if vendorName is provided
        if (vendorId) {
            const vendor = await Vendor.findById(vendorId);
            if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
        }

        // Auto-increment PO Number
        const counter = await Counter.findOneAndUpdate(
            { id: 'poNumber' },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );
        const poNumber = `PO-${String(counter.seq).padStart(6, '0')}`;

        // Initial Status based on role
        let status = 'Draft';
        if (req.user.role === 'PM' || req.user.role === 'COMPANY_OWNER') {
            status = 'Pending Approval';
        } else if (req.user.role === 'FOREMAN') {
            status = 'Draft';
        }

        const po = new PurchaseOrder({
            companyId: req.user.companyId || req.user.company?._id || req.body.companyId,
            poNumber,
            projectId,
            jobId: cleanJobId,
            vendorId: cleanVendorId,
            vendorName,
            vendorEmail,
            createdBy: req.user._id,
            items,
            notesToVendor,
            internalNotes,
            expectedDeliveryDate,
            status,
            subtotal,
            tax,
            totalAmount
        });

        await po.save();
        res.status(201).json(po);
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
    }
};

// Get All POs with Filters
exports.getAllPOs = async (req, res) => {
    try {
        const { projectId, jobId, vendorId, status, startDate, endDate } = req.query;
        let query = {};

        // Security: Visibility logic
        if (req.user.role === 'FOREMAN') {
            query.createdBy = req.user._id;
        }
        // PM and Admin see everything in their company
        query.companyId = req.user.companyId || req.user.company?._id;

        // Apply filters
        if (projectId) query.projectId = projectId;
        if (jobId) query.jobId = jobId;
        if (vendorId) query.vendorId = vendorId;
        if (status) query.status = status;
        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const pos = await PurchaseOrder.find(query)
            .populate('projectId', 'name')
            .populate('vendorId', 'name')
            .populate('createdBy', 'fullName role')
            .sort({ createdAt: -1 });

        res.json(pos);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get Single PO
exports.getSinglePO = async (req, res) => {
    try {
        const po = await PurchaseOrder.findById(req.params.id)
            .populate('companyId')
            .populate('projectId')
            .populate('vendorId')
            .populate('createdBy', 'fullName role')
            .populate('approvedBy', 'fullName');

        if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
        res.json(po);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update PO (Editing allowed only in Draft, Status updates allowed for Admins)
exports.updatePO = async (req, res) => {
    try {
        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ message: 'Purchase Order not found' });

        const isStatusOnly = Object.keys(req.body).length === 1 && (req.body.status !== undefined);
        const isAdminOrPM = req.user.role === 'COMPANY_OWNER' || req.user.role === 'PM';

        // Content editing (line items, etc) rules:
        // 1. Drafts can be edited by anyone with access
        // 2. Pending Approval and Approved can be edited by Admins/PMs
        if (!isStatusOnly) {
            const isDraft = po.status === 'Draft';
            const canManagerEdit = isAdminOrPM && ['Pending Approval', 'Approved'].includes(po.status);
            
            if (!isDraft && !canManagerEdit) {
                return res.status(400).json({ message: `Cannot edit Purchase Order in ${po.status} status` });
            }
        }

        // Status update logic
        if (isStatusOnly && !isAdminOrPM && po.status !== 'Draft') {
            return res.status(403).json({ message: 'Only Admins/PMs can change status after submission' });
        }

        // Clean optional IDs if present
        if (req.body.vendorId === '') req.body.vendorId = null;
        if (req.body.jobId === '') req.body.jobId = null;

        Object.assign(po, req.body);
        await po.save();
        res.json(po);
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
    }
};

// Status Actions (Admin Only)
const updateStatus = async (req, res, newStatus, additionalData = {}) => {
    try {
        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ message: 'Purchase Order not found' });

        // Admin or PM can perform status updates
        const isAuthorized = req.user.role === 'COMPANY_OWNER' || req.user.role === 'PM';
        if (!isAuthorized) {
            return res.status(403).json({ message: 'Only Admin/PM can perform this action' });
        }

        // Optional Rule: Cannot approve own PO
        if (newStatus === 'Approved' && po.createdBy.toString() === req.user._id.toString()) {
            // Uncomment if mandatory:
            // return res.status(400).json({ message: 'Cannot approve your own Purchase Order' });
        }

        po.status = newStatus;
        Object.assign(po, additionalData);
        await po.save();
        res.json(po);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.approvePO = (req, res) => updateStatus(req, res, 'Approved', { approvedBy: req.user._id });
exports.sendToVendor = (req, res) => updateStatus(req, res, 'Sent');
exports.markDelivered = (req, res) => updateStatus(req, res, 'Delivered');
exports.closePO = (req, res) => updateStatus(req, res, 'Closed');
exports.cancelPO = (req, res) => updateStatus(req, res, 'Cancelled');

// Delete PO
exports.deletePO = async (req, res) => {
    try {
        const po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ message: 'Purchase Order not found' });

        // Security: Admins can delete anything; Others only their own Drafts
        const isAdmin = req.user.role === 'COMPANY_OWNER' || req.user.role === 'PM';
        const isOwner = po.createdBy.toString() === req.user._id.toString();

        if (!isAdmin && (!isOwner || po.status !== 'Draft')) {
            return res.status(403).json({ message: 'Not authorized to delete this Purchase Order' });
        }

        await PurchaseOrder.findByIdAndDelete(req.params.id);
        res.json({ message: 'Purchase Order deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

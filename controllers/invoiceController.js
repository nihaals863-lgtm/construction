const Invoice = require('../models/Invoice');

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
const getInvoices = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        // Clients can only see their own invoices
        if (req.user.role === 'CLIENT') {
            query.clientId = req.user._id;
        }

        if (req.query.projectId) query.projectId = req.query.projectId;
        if (req.query.status) query.status = req.query.status;

        const invoices = await Invoice.find(query)
            .populate('projectId', 'name')
            .populate('clientId', 'fullName')
            .populate('estimateId', 'estimateNumber')
            .populate('createdBy', 'fullName');

        res.json(invoices);
    } catch (error) {
        next(error);
    }
};

// @desc    Create new invoice
// @route   POST /api/invoices
// @access  Private (PM, Owners)
const createInvoice = async (req, res, next) => {
    try {
        let { invoiceNumber } = req.body;

        if (!invoiceNumber) {
            const count = await Invoice.countDocuments({ companyId: req.user.companyId });
            invoiceNumber = `INV-${String(count + 1).padStart(3, '0')}`;
        }

        const invoice = await Invoice.create({
            ...req.body,
            invoiceNumber,
            companyId: req.user.companyId,
            createdBy: req.user._id
        });
        res.status(201).json(invoice);
    } catch (error) {
        next(error);
    }
};

// @desc    Update invoice status/payment
// @route   PATCH /api/invoices/:id
// @access  Private
const updateInvoice = async (req, res, next) => {
    try {
        const invoice = await Invoice.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!invoice) {
            res.status(404);
            throw new Error('Invoice not found');
        }

        const updatedInvoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.json(updatedInvoice);
    } catch (error) {
        next(error);
    }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
const getInvoice = async (req, res, next) => {
    try {
        const invoice = await Invoice.findOne({ _id: req.params.id, companyId: req.user.companyId })
            .populate('projectId', 'name')
            .populate('clientId', 'fullName')
            .populate('estimateId', 'estimateNumber')
            .populate('createdBy', 'fullName');

        if (!invoice) {
            res.status(404);
            throw new Error('Invoice not found');
        }

        res.json(invoice);
    } catch (error) {
        next(error);
    }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
// @access  Private (Owner, PM)
const deleteInvoice = async (req, res, next) => {
    try {
        const invoice = await Invoice.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!invoice) {
            res.status(404);
            throw new Error('Invoice not found');
        }

        await Invoice.findByIdAndDelete(req.params.id);
        res.json({ message: 'Invoice removed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getInvoices,
    getInvoice,
    createInvoice,
    updateInvoice,
    deleteInvoice
};

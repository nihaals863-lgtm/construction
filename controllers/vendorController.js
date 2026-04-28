const Vendor = require('../models/Vendor');
const TradeBid = require('../models/TradeBid');
const Drawing = require('../models/Drawing');

// @desc    Create new trade/vendor
// @route   POST /api/vendors
exports.createVendor = async (req, res) => {
    try {
        let attachments = [];
        if (req.files && req.files.length > 0) {
            attachments = req.files.map(file => ({
                name: file.originalname,
                url: file.path.replace(/\\/g, '/'),
                fileType: file.mimetype
            }));
        }

        const vendor = new Vendor({
            ...req.body,
            companyId: req.user.companyId || req.user.company?._id,
            attachments
        });
        await vendor.save();
        res.status(201).json(vendor);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all trades/vendors for the company
// @route   GET /api/vendors
exports.getVendors = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.user.company?._id;
        let query = { companyId };

        if (req.query.category) {
            query.category = req.query.category;
        }
        if (req.query.status) {
            query.status = req.query.status;
        }
        if (req.query.search) {
            query.name = { $regex: req.query.search, $options: 'i' };
        }

        const vendors = await Vendor.find(query)
            .select('name email category status phone businessAddress contactPerson attachments')
            .lean();
        res.json(vendors);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update vendor
// @route   PATCH /api/vendors/:id
exports.updateVendor = async (req, res) => {
    try {
        const updateData = { ...req.body };
        
        if (req.files && req.files.length > 0) {
            const newAttachments = req.files.map(file => ({
                name: file.originalname,
                url: file.path.replace(/\\/g, '/'),
                fileType: file.mimetype
            }));
            
            // If we want to APPEND to existing:
            const existingVendor = await Vendor.findById(req.params.id);
            updateData.attachments = [...(existingVendor.attachments || []), ...newAttachments];
        }

        const vendor = await Vendor.findOneAndUpdate(
            { _id: req.params.id, companyId: req.user.companyId },
            updateData,
            { new: true }
        );
        if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
        res.json(vendor);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete vendor
// @route   DELETE /api/vendors/:id
exports.deleteVendor = async (req, res) => {
    try {
        const vendor = await Vendor.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
        if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
        res.json({ message: 'Vendor deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Send drawing to trades
// @route   POST /api/vendors/send-drawing
exports.sendDrawingToTrades = async (req, res) => {
    try {
        const { drawingId, vendorIds } = req.body;
        const drawing = await Drawing.findById(drawingId).populate('projectId');
        const vendors = await Vendor.find({ _id: { $in: vendorIds } });

        if (!drawing) return res.status(404).json({ message: 'Drawing not found' });

        // Email logic placeholder
        // In a real app, you'd use a mail service like SendGrid
        console.log(`Sending drawing ${drawing.title} to ${vendors.length} vendors`);

        // Update drawing or create notification log if needed

        res.json({ message: `Drawing sent to ${vendors.length} trades` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Submit bid from trade
// @route   POST /api/vendors/submit-bid
exports.submitBid = async (req, res) => {
    try {
        const { drawingId, vendorId, bidAmount, notes, companyId } = req.body;
        
        let attachments = [];
        if (req.files && req.files.length > 0) {
            attachments = req.files.map(file => ({
                name: file.originalname,
                url: file.path.replace(/\\/g, '/'),
                fileType: file.mimetype
            }));
        }

        const bid = new TradeBid({
            companyId,
            drawingId,
            vendorId,
            bidAmount,
            notes,
            attachments,
            status: 'Pending'
        });

        await bid.save();
        res.status(201).json(bid);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all bids for the company
// @route   GET /api/vendors/bids
exports.getBids = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const bids = await TradeBid.find({ companyId })
            .populate('vendorId', 'name email')
            .populate('drawingId', 'title')
            .populate('companyId')
            .sort({ createdAt: -1 });
        res.json(bids);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get public drawing info for bidding
// @route   GET /api/vendors/public/drawing/:id
exports.getPublicDrawingInfo = async (req, res) => {
    try {
        const drawing = await Drawing.findById(req.params.id)
            .populate('projectId', 'name');

        if (!drawing) return res.status(404).json({ message: 'Drawing not found' });

        res.json({
            title: drawing.title,
            drawingNumber: drawing.drawingNumber,
            category: drawing.category,
            projectId: drawing.projectId,
            companyId: drawing.companyId,
            versions: drawing.versions
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update bid status
// @route   PATCH /api/vendors/bids/:id
exports.updateBidStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const bid = await TradeBid.findByIdAndUpdate(req.params.id, { status }, { new: true });
        res.json(bid);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete a bid
// @route   DELETE /api/vendors/bids/:id
exports.deleteBid = async (req, res) => {
    try {
        const bid = await TradeBid.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
        if (!bid) return res.status(404).json({ message: 'Bid not found' });
        res.json({ message: 'Bid deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

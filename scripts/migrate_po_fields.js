const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PurchaseOrder = require('../models/purchaseOrder.model');

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const pos = await PurchaseOrder.find({});
        console.log(`Found ${pos.length} POs to check`);

        for (let po of pos) {
            let updated = false;

            // Handle lineItems -> items
            if (po._doc.lineItems && !po._doc.items) {
                po.items = po._doc.lineItems;
                updated = true;
            }

            // Handle grandTotal -> totalAmount
            if (po._doc.grandTotal !== undefined && po._doc.totalAmount === undefined) {
                po.totalAmount = po._doc.grandTotal;
                updated = true;
            } else if (po._doc.totalAmount === undefined || po._doc.totalAmount === 0) {
                // Recalculate if totally missing
                if (po.items && po.items.length > 0) {
                    let subtotal = 0;
                    po.items.forEach(item => {
                        item.total = item.quantity * item.unitPrice;
                        subtotal += item.total;
                    });
                    po.subtotal = subtotal;
                    po.tax = subtotal * 0.15;
                    po.totalAmount = subtotal + po.tax;
                    updated = true;
                }
            }

            if (updated) {
                // Use updateOne to avoid schema validation issues during migration if any
                await PurchaseOrder.updateOne(
                    { _id: po._id },
                    {
                        $set: {
                            items: po.items,
                            totalAmount: po.totalAmount,
                            subtotal: po.subtotal || 0,
                            tax: po.tax || 0
                        },
                        $unset: { lineItems: "", grandTotal: "" }
                    }
                );
                console.log(`Updated PO ${po.poNumber}`);
            }
        }

        console.log('Migration completed');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();

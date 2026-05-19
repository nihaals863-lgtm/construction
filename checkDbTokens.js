require('dotenv').config();
const mongoose = require('mongoose');
const FcmToken = require('./models/FcmToken');

async function runDiagnostics() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected successfully!");

        const tokens = await FcmToken.find({}).sort({ createdAt: -1 }).limit(10);
        
        console.log("\n================ DB FCM TOKENS DIAGNOSTICS ================");
        if (tokens.length === 0) {
            console.log("❌ No tokens found in the database!");
        } else {
            console.log(`Found ${tokens.length} total tokens (latest first):\n`);
            tokens.forEach((t, idx) => {
                console.log(`[Token ${idx + 1}]`);
                console.log(`- User ID:  ${t.userId}`);
                console.log(`- Platform: ${t.platform}`);
                console.log(`- Active:   ${t.isActive}`);
                console.log(`- Created:  ${t.createdAt}`);
                console.log(`- Token preview: ${t.token.substring(0, 30)}...`);
                console.log("-----------------------------------------");
            });
        }
        console.log("==========================================================\n");

        await mongoose.disconnect();
    } catch (err) {
        console.error("Diagnostic error:", err);
    }
}

runDiagnostics();

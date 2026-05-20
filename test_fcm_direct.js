require('dotenv').config();
const admin = require('firebase-admin');
const FcmToken = require('./models/FcmToken');
const mongoose = require('mongoose');

async function testFCM() {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Initialize
    let firebaseApp;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        firebaseApp = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    } else {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
            })
        });
    }

    const messaging = admin.messaging();
    
    // Get ALL active android tokens
    const tokens = await FcmToken.find({ platform: 'android', isActive: true });
    console.log(`Found ${tokens.length} active android tokens.`);
    
    if(tokens.length === 0) {
        console.log("No android tokens found!");
        process.exit(0);
    }

    const tokenStrings = tokens.map(t => t.token);
    
    const payload = {
        notification: { title: "Direct Test", body: "Checking if notifications arrive when killed" },
        data: { type: "test" },
        android: { priority: 'high', notification: { sound: 'default' } }
    };
    
    const response = await messaging.sendEachForMulticast({
        tokens: tokenStrings,
        ...payload
    });
    
    console.log(`Success: ${response.successCount}, Failure: ${response.failureCount}`);
    process.exit(0);
}

testFCM();

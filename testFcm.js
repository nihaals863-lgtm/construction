require('dotenv').config();
const { messaging, isInitialized } = require('./utils/fcmHelper');

// Get FCM Token from CLI arguments
const TEST_FCM_TOKEN = process.argv[2];

if (!TEST_FCM_TOKEN) {
    console.log("\n❌ Please provide a registered FCM token!");
    console.log("Usage: node testFcm.js <FCM_TOKEN>");
    console.log("Example: node testFcm.js d7HkP92sX...\n");
    process.exit(1);
}

if (!isInitialized) {
    console.error("\n❌ Firebase Admin was not initialized. Check your .env file credentials!");
    process.exit(1);
}

async function sendTestNotification() {
    console.log(`Sending test push notification to: ${TEST_FCM_TOKEN}...`);
    try {
        const payload = {
            token: TEST_FCM_TOKEN,
            notification: {
                title: "Hello from Construction Bard!",
                body: "This is a real-time test push notification 🚀"
            },
            data: {
                roomId: "test-room-123",
                type: "chat",
                senderName: "Admin Test"
            }
        };

        const response = await messaging.send(payload);
        console.log("\n✅ Push Notification Sent Successfully!");
        console.log("Firebase Message ID:", response);
    } catch (error) {
        console.error("\n❌ Error sending push notification:");
        console.error(error.message);
    }
}

sendTestNotification();

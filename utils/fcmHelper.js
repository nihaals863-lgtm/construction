const admin = require('firebase-admin');
const FcmToken = require('../models/FcmToken');

let firebaseApp = null;
let messaging = null;

// Initialize Firebase Admin
try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (privateKey) {
        // Handle newline escaping in environment variables
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson);
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        messaging = admin.messaging();
        console.log('[Firebase Admin] Successfully initialized via FIREBASE_SERVICE_ACCOUNT.');
    } else if (projectId && clientEmail && privateKey) {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey
            })
        });
        messaging = admin.messaging();
        console.log('[Firebase Admin] Successfully initialized via individual environment variables.');
    } else {
        console.warn('[Firebase Admin] Firebase keys are missing in environment variables. FCM helper will run in DRY-RUN mode.');
    }
} catch (error) {
    console.error('[Firebase Admin] Initialization failed:', error.message);
    console.warn('[Firebase Admin] FCM helper will run in DRY-RUN mode due to initialization failure.');
}

/**
 * Send push notification to users if they are offline or app is closed
 * @param {Array|String} userIds - User ID or array of User IDs to send notifications to
 * @param {String} title - Notification title
 * @param {String} body - Notification body
 * @param {Object} extraData - Additional data payload (e.g. roomId, type)
 * @param {Object} io - Socket.io server instance to check online status
 */
const sendPushNotification = async (userIds, title, body, extraData = {}, io = null) => {
    try {
        const ids = Array.isArray(userIds) ? userIds : [userIds];
        if (ids.length === 0) return;

        // Find active tokens for these users
        const tokensDoc = await FcmToken.find({
            userId: { $in: ids },
            isActive: true
        });

        if (tokensDoc.length === 0) {
            console.log(`[FCM] No active device tokens found for users: ${ids.join(', ')}`);
            return;
        }

        // Group tokens by userId to check online status per user
        const tokensByUser = {};
        tokensDoc.forEach(doc => {
            if (!tokensByUser[doc.userId]) {
                tokensByUser[doc.userId] = [];
            }
            tokensByUser[doc.userId].push(doc);
        });

        const targetTokens = [];
        const invalidTokens = [];

        for (const userId of Object.keys(tokensByUser)) {
            // Check if user is online in socket
            let isUserOnline = false;
            if (io) {
                const sockets = io.sockets.adapter.rooms.get(userId.toString());
                isUserOnline = sockets && sockets.size > 0;
            }

            if (isUserOnline) {
                console.log(`[FCM] User ${userId} is currently online via Socket.IO. Skipping push notification.`);
                continue;
            }

            // User is offline or app closed, collect their tokens
            tokensByUser[userId].forEach(doc => {
                targetTokens.push(doc.token);
            });
        }

        if (targetTokens.length === 0) {
            console.log('[FCM] All target users are currently online or have no tokens. No push notifications sent.');
            return;
        }

        console.log(`[FCM] Sending push notification to ${targetTokens.length} tokens. Title: "${title}"`);

        // If in dry-run mode
        if (!messaging) {
            console.log('[FCM DRY-RUN] Push notification payload:', {
                tokensCount: targetTokens.length,
                title,
                body,
                extraData
            });
            return;
        }

        // Prepare message payload
        const payload = {
            notification: {
                title,
                body
            },
            data: {
                ...extraData,
                title,
                body
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        };

        // Send to each token
        const response = await messaging.sendEachForMulticast({
            tokens: targetTokens,
            ...payload
        });

        console.log(`[FCM] Sent notifications. Success: ${response.successCount}, Failure: ${response.failureCount}`);

        // Clean up invalid or unregistered tokens
        if (response.failureCount > 0) {
            response.responses.forEach((res, idx) => {
                if (!res.success) {
                    const error = res.error;
                    if (error && (
                        error.code === 'messaging/invalid-registration-token' ||
                        error.code === 'messaging/registration-token-not-registered'
                    )) {
                        invalidTokens.push(targetTokens[idx]);
                    }
                    console.error(`[FCM] Error sending to token ${targetTokens[idx]}:`, error?.message || 'Unknown error');
                }
            });

            if (invalidTokens.length > 0) {
                console.log(`[FCM] Deactivating ${invalidTokens.length} invalid/expired tokens.`);
                await FcmToken.updateMany(
                    { token: { $in: invalidTokens } },
                    { isActive: false }
                );
            }
        }

    } catch (error) {
        console.error('[FCM Error] Failed to send push notification:', error.message);
    }
};

module.exports = {
    sendPushNotification
};

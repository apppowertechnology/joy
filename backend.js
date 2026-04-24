// backend.js - Core Shared Utility for AURACIOUS SIP API
const admin = require('firebase-admin');
const axios = require('axios');

// 1. Safe Firebase Initialization (Idempotent)
if (!admin.apps.length) {
    try {
        // Parse the service account from an environment variable string
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        console.log("Firebase Admin Initialized Successfully");
    } catch (error) {
        console.error("CRITICAL: Firebase Admin Init Failed:", error.message);
    }
}

const db = admin.database();
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// 2. Shared Debugging & Verification Logger
const logVerification = async (reference, type, status, message) => {
    try {
        await db.ref('verificationLogs').push({
            reference: reference || 'N/A',
            type, status, message,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error("Logging failed:", e.message);
    }
};

// 3. Export Shared Resources
module.exports = { admin, db, axios, PAYSTACK_SECRET_KEY, logVerification };
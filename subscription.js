// api/subscription.js - Handle Subscription Verification & Tinubu Overrides
const admin = require('firebase-admin');
const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Initialize Firebase Admin for Serverless
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}
const db = admin.database();

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Handle Tinubu Panel Price Updates (POST with special action)
    if (req.method === 'PATCH') {
        const { monthlyPrice, grace } = req.body;
        await db.ref('subscriptionPricing').update({ 
            monthlyPrice, 
            grace, 
            updatedAt: Date.now() 
        }, (err) => { if(err) console.error("Pricing update failed:", err); });
        return res.status(200).json({ success: true });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false });

    const { reference, months, amount: frontendAmount } = req.body;

    try {
        // 1. Idempotency Check
        const historySnap = await db.ref('subscription/history').orderByChild('reference').equalTo(reference).once('value');
        if (historySnap.exists()) {
            return res.status(200).json({ success: true, message: 'Subscription already updated' });
        }

        // 2. Verify Payment
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (response.data.data.status === 'success') {
            const actualAmountPaid = response.data.data.amount / 100;
            
            if (frontendAmount && actualAmountPaid < (parseFloat(frontendAmount) - 0.01)) {
                return res.status(400).json({ success: false, message: 'Amount mismatch' });
            }

            // 3. Calculate New Expiry
            const subRef = db.ref('subscription');
            const snapshot = await subRef.once('value');
            const currentSub = snapshot.val() || { expiresAt: Date.now() };

            const baseDate = (currentSub.expiresAt && currentSub.expiresAt > Date.now()) ? currentSub.expiresAt : Date.now();
            const newExpiry = baseDate + (months * 30 * 24 * 60 * 60 * 1000);

            // 4. Update Database
            await subRef.update({
                active: true,
                expiresAt: newExpiry,
                systemLocked: false,
                lastPaymentDate: Date.now(),
                updatedAt: admin.database.ServerValue.TIMESTAMP
            });

            // 5. Log History
            await db.ref('subscription/history').push({
                amount: actualAmountPaid,
                months: months,
                date: Date.now(),
                reference: reference,
                status: 'Successful'
            });

            // 6. Log Analytics
            const salesRef = db.ref('analytics/monthlySales');
            await salesRef.transaction(current => (current || 0) + actualAmountPaid);

            return res.status(200).json({ success: true, expiresAt: newExpiry });
        } else {
            return res.status(400).json({ success: false, message: 'Verification failed' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
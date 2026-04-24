// api/subscription.js - Handle Subscription Verification & Tinubu Overrides
const { admin, db, verifyPaystack, processSubscription } = require('./backend');

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Handle Tinubu Panel Price Updates (POST with special action)
    if (req.method === 'PATCH') {
        const { monthlyPrice, grace } = req.body;
        try {
            await db.ref('subscriptionPricing').update({ 
            monthlyPrice, 
            grace, 
            updatedAt: Date.now() 
            });
            return res.status(200).json({ success: true });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
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
        const { amountPaid } = await verifyPaystack(reference);

        // 3. Process Subscription using centralized logic
        const result = await processSubscription(reference, months, amountPaid, frontendAmount);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
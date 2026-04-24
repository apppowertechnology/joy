// api/subscription.js - Handle Subscription Verification & Tinubu Overrides
const { admin, db, verifyPaystack, processSubscription } = require('./backend');

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ success: false, message: `Method ${req.method} not allowed` });
    }

    // Support both POST and GET
    const reference = req.body?.reference || req.query?.reference;
    let months = req.body?.months || req.query?.months;
    let frontendAmount = req.body?.amount || req.query?.amount;

    if (!reference) return res.status(400).json({ success: false, message: "Missing reference" });

    try {
        // Recover subscription details from DB if missing from request
        if (!months) {
            const transSnap = await db.ref(`transactions/${reference}`).once('value');
            if (transSnap.exists()) {
                const trans = transSnap.val();
                months = trans.months;
                frontendAmount = trans.amount;
            }
        }

        if (!months) {
            return res.status(400).json({ success: false, message: "Subscription duration details missing." });
        }

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
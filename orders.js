// api/orders.js - Handle Order Creation and Verification
const { admin, db, logVerification, verifyPaystack, processOrder } = require('./backend');

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Support both POST (body) and GET (query) for resilience
    const reference = req.body?.reference || req.query?.reference;
    let orderData = req.body?.orderData;

    // Recovery Logic: If orderData is missing (common in GET/Redirects), 
    // try to reconstruct it from the pending transaction in DB
    if (!orderData && reference) {
        const transSnap = await db.ref(`transactions/${reference}`).once('value');
        if (transSnap.exists()) {
            const trans = transSnap.val();
            orderData = {
                customerName: trans.customerName,
                email: trans.email,
                phone: trans.phone,
                address: trans.address,
                note: trans.note || "",
                items: trans.items
            };
        }
    }

    if (!orderData || !orderData.customerName || !orderData.items || orderData.items.length === 0) {
        return res.status(400).json({ success: false, message: `Incomplete order data for ref: ${reference || 'None'}` });
    }

    try {
        await logVerification(reference, 'Order', 'Attempt', 'Verification process started');

        // 2. Verify Payment with Paystack
        const { amountPaid } = await verifyPaystack(reference);

        // 3. Process Order using centralized logic
        const result = await processOrder(reference, orderData, amountPaid);
        return res.status(200).json(result);

    } catch (error) {
        await logVerification(reference, 'Order', 'Error', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
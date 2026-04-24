// api/orders.js - Handle Order Creation and Verification
const { admin, db, logVerification, verifyPaystack, processOrder } = require('./backend');

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: `Method ${req.method} not allowed` });

    const { reference, orderData } = req.body;

    // Validation Shield: Prevent saving incomplete orders
    if (!orderData || !orderData.customerName || !orderData.items || orderData.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Incomplete order data received' });
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
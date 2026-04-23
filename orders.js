// api/orders.js - Handle Order Creation and Verification
const { db, admin, PAYSTACK_SECRET_KEY } = require('./config');
const axios = require('axios');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ success: false });

    const { reference, orderData } = req.body;

    try {
        // 1. Verify Payment with Paystack
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (response.data.data.status !== 'success') {
            return res.status(400).json({ success: false, message: 'Payment verification failed' });
        }

        const paidAmount = response.data.data.amount / 100;
        const ticketNumber = 'AUR-' + Math.floor(100000 + Math.random() * 900000);

        // 2. Prepare Order Object
        const newOrder = {
            ...orderData,
            amount: paidAmount,
            ticketNumber: ticketNumber,
            orderStatus: 'Pending',
            paymentStatus: 'Paid',
            paymentReference: reference,
            createdAt: Date.now()
        };

        // 3. Save to Firebase via Admin SDK
        const orderRef = db.ref('orders').push();
        await orderRef.set(newOrder);

        // 4. Update Analytics & Ledger
        await db.ref(`transactions/${reference}`).update({ status: 'Successful' });
        await db.ref('analytics/totalRevenue').transaction(c => (c || 0) + paidAmount);
        await db.ref('analytics/successfulPayments').transaction(c => (c || 0) + 1);

        return res.status(200).json({ 
            success: true, 
            status: 'success', // Kept for frontend compatibility
            order: newOrder 
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
// api/orders.js - Handle Order Creation and Verification
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

const logVerification = async (reference, type, status, message) => {
    await db.ref('verificationLogs').push({
        reference: reference || 'N/A',
        type, status, message,
        timestamp: Date.now()
    });
};

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false });

    const { reference, orderData } = req.body;

    try {
        await logVerification(reference, 'Order', 'Attempt', 'Verification process started');

        // 1. Idempotency Check
        const existingOrderSnap = await db.ref('orders').orderByChild('paymentReference').equalTo(reference).once('value');
        if (existingOrderSnap.exists()) {
            await logVerification(reference, 'Order', 'Success', 'Idempotency: Order already exists');
            let existingOrder;
            existingOrderSnap.forEach(c => { existingOrder = c.val(); });
            return res.status(200).json({ success: true, order: existingOrder, message: 'Already verified' });
        }

        // 2. Verify Payment with Paystack
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        const data = response.data.data;
        if (data.status !== 'success') {
            await logVerification(reference, 'Order', 'Failed', `Paystack returned status: ${data.status}`);
            return res.status(400).json({ success: false, message: 'Payment verification failed' });
        }

        const paidAmount = data.amount / 100;

        // 3. Security: DB Price Lookup & Stock Pre-check
        const productRequests = orderData.items.map(item => db.ref(`products/${item.id}`).once('value'));
        const productSnapshots = await Promise.all(productRequests);
        
        let expectedAmount = 0;
        const verifiedItems = [];

        for (let i = 0; i < productSnapshots.length; i++) {
            const product = productSnapshots[i].val();
            const originalItem = orderData.items[i];

            if (!product || (product.stock || 0) < originalItem.quantity) {
                await logVerification(reference, 'Order', 'Failed', `Stock error: ${originalItem.name}`);
                return res.status(400).json({ success: false, message: 'Product unavailable or out of stock' });
            }

            const currentPrice = parseFloat(product.price);
            expectedAmount += currentPrice * originalItem.quantity;
            verifiedItems.push({ ...originalItem, price: currentPrice });
        }

        if (Math.abs(paidAmount - expectedAmount) >= 0.01) {
            await logVerification(reference, 'Order', 'Failed', `Amount mismatch: Paid ${paidAmount}, Expected ${expectedAmount}`);
            return res.status(400).json({ success: false, message: 'Amount mismatch' });
        }

        // 4. Atomic Stock Deduction
        const stockDeductions = verifiedItems.map(item => {
            return db.ref(`products/${item.id}/stock`).transaction(currentStock => {
                if (currentStock !== null && currentStock >= item.quantity) {
                    return currentStock - item.quantity;
                }
                return;
            });
        });

        const deductionResults = await Promise.all(stockDeductions);
        if (deductionResults.some(r => !r.committed)) {
            await logVerification(reference, 'Order', 'Failed', 'Atomic stock update conflict');
            return res.status(400).json({ success: false, message: 'Stock update conflict' });
        }

        const ticketNumber = 'AUR-' + Math.floor(100000 + Math.random() * 900000);

        const newOrder = {
            customerName: orderData.customerName,
            phone: orderData.phone,
            address: orderData.address,
            note: orderData.note,
            items: verifiedItems,
            amount: paidAmount,
            ticketNumber: ticketNumber,
            orderStatus: 'Pending',
            paymentStatus: 'Paid',
            paymentReference: reference,
            createdAt: Date.now()
        };

        const orderRef = db.ref('orders').push();
        await orderRef.set(newOrder);

        await db.ref(`transactions/${reference}`).update({ 
            status: 'Successful', 
            amount: paidAmount, 
            updatedAt: admin.database.ServerValue.TIMESTAMP 
        });
        await db.ref('analytics/totalRevenue').transaction(c => (c || 0) + paidAmount);
        await db.ref('analytics/successfulPayments').transaction(c => (c || 0) + 1);

        await logVerification(reference, 'Order', 'Success', 'Order verified and stock updated');
        return res.status(200).json({ success: true, order: newOrder });

    } catch (error) {
        await logVerification(reference, 'Order', 'Error', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
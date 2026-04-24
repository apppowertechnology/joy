// server.js - AURACIOUS SIP Secure Backend
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');
const app = express();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY; // Ensure this is set in your .env
const FIREBASE_URL = process.env.FIREBASE_DATABASE_URL;

app.use(express.json());
app.use(cors());

// Initialize Firebase Admin (Using credentials locally)
try {
    if (!admin.apps.length) {
        // Parse the service account from an environment variable string
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: FIREBASE_URL
        });
    }
} catch (e) {
    console.error("Firebase Admin initialization failed:", e.message);
}
const db = admin.database();

// Health Check Route (To debug 404s)
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', message: 'AURACIOUS SIP API is reachable' });
});

/**
 * Verify Product Order Payment
 */
app.post('/api/orders', async (req, res) => {
    const { reference, orderData } = req.body;
    if (!reference || !orderData) return res.status(400).json({ success: false, status: 'failed', message: 'Missing transaction data' });

    try {
        // 1. Idempotency Check: Prevent duplicate orders for the same reference
        const existingOrderSnap = await db.ref('orders').orderByChild('paymentReference').equalTo(reference).once('value');
        if (existingOrderSnap.exists()) {
            let existingOrder;
            existingOrderSnap.forEach(c => { existingOrder = c.val(); });
            return res.json({ success: true, status: 'success', order: existingOrder, message: 'Payment already verified' });
        }

        // 2. Paystack Verification
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        const data = response.data.data;
        if (data.status === 'success') {
            const paidAmount = data.amount / 100; // Kobo to Naira

            // 3. Security Check: Validate Amount with DB Lookup
            const productRequests = orderData.items.map(item => db.ref(`products/${item.id}`).once('value'));
            const productSnapshots = await Promise.all(productRequests);
            
            let expectedAmount = 0;
            const verifiedItems = [];

            for (let i = 0; i < productSnapshots.length; i++) {
                const product = productSnapshots[i].val();
                const originalItem = orderData.items[i];

                if (!product) {
                    return res.status(400).json({ success: false, message: `Validation failed: Product ${originalItem.name} not found.` });
                }

                // Pre-check stock levels
                if ((product.stock || 0) < originalItem.quantity) {
                    return res.status(400).json({ success: false, message: `Insufficient stock for ${originalItem.name}.` });
                }

                const currentPrice = Number(product.price);
                expectedAmount += currentPrice * originalItem.quantity;
                verifiedItems.push({ ...originalItem, price: currentPrice });
            }

            if (Math.abs(paidAmount - expectedAmount) > 0.01) {
                return res.status(400).json({ success: false, message: 'Amount mismatch detected' });
            }

            // 4. Atomic Stock Deduction
            const stockDeductions = verifiedItems.map(item => {
                return db.ref(`products/${item.id}/stock`).transaction(currentStock => {
                    if (currentStock !== null && currentStock >= item.quantity) {
                        return currentStock - item.quantity;
                    }
                    return; // Abort transaction if stock became insufficient
                });
            });

            const deductionResults = await Promise.all(stockDeductions);
            if (deductionResults.some(r => !r.committed)) {
                return res.status(400).json({ success: false, message: 'Stock error: One or more items became unavailable during processing.' });
            }

            const ticketNumber = 'AUR-' + Math.floor(100000 + Math.random() * 900000);
            const newOrderRef = db.ref('orders').push();
            const newOrder = {
                ...orderData,
                items: verifiedItems, // Ensure verified prices are stored in history
                amount: paidAmount,
                ticketNumber: ticketNumber,
                orderStatus: 'Pending',
                paymentStatus: 'Paid',
                paymentReference: reference,
                createdAt: Date.now()
            };
            await newOrderRef.set(newOrder);

            // Update Transaction Ledger
            await db.ref(`transactions/${reference}`).update({ status: 'Successful', amount: paidAmount, updatedAt: Date.now() });

            // Update Analytics via transactions
            await db.ref('analytics/totalRevenue').transaction(c => (c || 0) + paidAmount);
            await db.ref('analytics/successfulPayments').transaction(c => (c || 0) + 1);

            res.json({ success: true, status: 'success', order: newOrder, message: 'Payment verified successfully' });
        } else {
            res.status(400).json({ success: false, message: 'Payment verification failed on gateway' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error during verification' });
    }
});

/**
 * Update Subscription Pricing (Tinubu Panel)
 */
app.patch('/api/subscription', async (req, res) => {
    const { monthlyPrice, grace } = req.body;
    await db.ref('subscriptionPricing').update({ 
        monthlyPrice, 
        grace, 
        updatedAt: Date.now() 
    });
    res.json({ success: true });
});

app.post('/api/subscription', async (req, res) => {
    const { reference, months, amount: frontendAmount } = req.body;

    try {
        // Idempotency Check
        const historySnap = await db.ref('subscription/history').orderByChild('reference').equalTo(reference).once('value');
        if (historySnap.exists()) {
            return res.json({ success: true, status: 'success', message: 'Subscription already updated' });
        }

        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (response.data.data.status === 'success') {
            const actualAmountPaid = response.data.data.amount / 100; // Convert kobo to naira

            if (frontendAmount && actualAmountPaid < frontendAmount) {
                return res.status(400).json({ success: false, message: 'Amount mismatch detected' });
            }

            const subRef = db.ref('subscription');
            const snapshot = await subRef.once('value');
            const currentSub = snapshot.val() || { expiresAt: Date.now() };

            // Early Renewal Rule
            const baseDate = (currentSub.expiresAt && currentSub.expiresAt > Date.now()) ? currentSub.expiresAt : Date.now();
            const newExpiry = baseDate + (months * 30 * 24 * 60 * 60 * 1000);

            await subRef.update({
                active: true,
                expiresAt: newExpiry,
                systemLocked: false,
                lastPaymentDate: Date.now(),
                updatedAt: admin.database.ServerValue.TIMESTAMP,
                monthsPaid: (currentSub.monthsPaid || 0) + months
            });

            // Log Payment to history
            await db.ref('subscription/history').push({
                amount: actualAmountPaid,
                months: months,
                date: Date.now(),
                reference: reference,
                status: 'Successful'
            });

            // Log Analytics
            const salesRef = db.ref('analytics/monthlySales');
            await salesRef.transaction(current => (current || 0) + actualAmountPaid);

            res.json({ success: true, status: 'success', expiresAt: newExpiry });
        } else {
            res.status(400).json({ success: false, message: 'Payment failed' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;

// Start server immediately (Unless required as a module for serverless)
const server = app.listen(PORT, () => {
    console.log(`AURACIOUS SIP Backend active on: http://localhost:${PORT}`);
}).on('error', (err) => console.error("Server startup error:", err));

module.exports = app;
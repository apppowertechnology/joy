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
    const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: FIREBASE_URL
    });
} catch (e) {
    console.error("Firebase Admin initialization failed. Check your service account key.");
}
const db = admin.database();

/**
 * Verify Product Order Payment
 */
app.post('/api/orders', async (req, res) => {
    const { reference, orderData } = req.body;
    if (!reference || !orderData) return res.status(400).json({ status: 'failed', message: 'Missing transaction data' });

    try {
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (response.data.data.status === 'success') {
            const ticketNumber = 'AUR-' + Math.floor(100000 + Math.random() * 900000);
            const totalAmount = orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            // Securely save order to DB
            const newOrderRef = db.ref('orders').push();
            const newOrder = {
                ...orderData,
                amount: totalAmount,
                ticketNumber: ticketNumber,
                orderStatus: 'Pending',
                paymentStatus: 'Paid',
                paymentReference: reference,
                createdAt: Date.now()
            };
            await newOrderRef.set(newOrder);

            // Update Transaction Ledger
            await db.ref(`transactions/${reference}`).update({ status: 'Successful' });

            // Update Analytics
            await db.ref('analytics/totalRevenue').transaction(c => (c || 0) + totalAmount);
            await db.ref('analytics/successfulPayments').transaction(c => (c || 0) + 1);

            res.json({ status: 'success', orderId: newOrderRef.key, order: newOrder });
        } else {
            res.status(400).json({ status: 'failed', message: 'Payment verification failed' });
        }
    } catch (error) {
        console.error("Order Verification Error:", error.message);
        res.status(500).json({ status: 'error', message: 'Internal verification error' });
    }
});

app.post('/api/subscription', async (req, res) => {
    const { reference, months, amount: frontendAmount } = req.body; // frontendAmount for initial validation

    try {
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (response.data.data.status === 'success') {
            const actualAmountPaid = response.data.data.amount / 100; // Convert kobo to naira

            // Basic security check: Ensure the amount paid matches the expected amount
            // This is a crucial step to prevent tampering with the amount on the frontend.
            // You might want to fetch the current pricing from DB here and calculate expected amount.
            if (frontendAmount && actualAmountPaid < frontendAmount) {
                return res.status(400).json({ status: 'failed', message: 'Amount mismatch detected.' });
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

            res.json({ status: 'success', expiresAt: newExpiry });
        } else {
            res.status(400).json({ status: 'failed' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AURACIOUS SIP Backend on port ${PORT}`));
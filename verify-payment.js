// api/verify-payment.js - Generic Paystack Verification Helper
const axios = require('axios');
const { PAYSTACK_SECRET_KEY } = require('./config');

module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

    const { reference } = req.body;
    if (!reference) return res.status(400).json({ success: false, message: 'Reference missing' });

    try {
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (response.data.data.status === 'success') {
            // This returns the raw verification data. 
            // The specific endpoints (orders/subscription) will call this logic or handle it internally.
            return res.status(200).json({ 
                success: true, 
                data: response.data.data,
                amount: response.data.data.amount / 100 
            });
        } else {
            return res.status(400).json({ success: false, message: 'Payment not successful' });
        }
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error during verification' 
        });
    }
};
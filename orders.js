// api/orders.js - Handle Order Creation and Verification
const { admin, db, logVerification, verifyPaystack } = require('./backend');

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
        const { amountPaid } = await verifyPaystack(reference);

        // 3. Security: DB Price Lookup & Stock Pre-check
        const productRequests = orderData.items.map(item => db.ref(`products/${item.id}`).once('value'));
        const productSnapshots = await Promise.all(productRequests);
        
        // Map snapshots to IDs for reliable lookup
        const productMap = new Map();
        productSnapshots.forEach(snap => { if(snap.exists()) productMap.set(snap.key, snap.val()); });

        let expectedAmount = 0;
        const verifiedItems = [];

        for (const originalItem of orderData.items) {
            const product = productMap.get(originalItem.id);

            if (!product || (product.stock || 0) < originalItem.quantity) {
                await logVerification(reference, 'Order', 'Failed', `Stock error: ${originalItem.name}`);
                return res.status(400).json({ success: false, message: 'Product unavailable or out of stock' });
            }

            const currentPrice = parseFloat(product.price);
            expectedAmount += currentPrice * originalItem.quantity;
            verifiedItems.push({ ...originalItem, price: currentPrice });
        }

        if (Math.abs(amountPaid - expectedAmount) >= 0.01) {
            await logVerification(reference, 'Order', 'Failed', `Amount mismatch: Paid ${amountPaid}, Expected ${expectedAmount}`);
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
            amount: amountPaid,
            ticketNumber: ticketNumber,
            orderStatus: 'Pending',
            paymentStatus: 'Paid',
            paymentReference: reference,
            createdAt: admin.database.ServerValue.TIMESTAMP
        };

        const orderRef = db.ref('orders').push();
        await orderRef.set(newOrder);

        await db.ref(`transactions/${reference}`).update({ 
            status: 'Successful', 
            amount: amountPaid, 
            updatedAt: admin.database.ServerValue.TIMESTAMP 
        });
        await db.ref('analytics/totalRevenue').transaction(c => (c || 0) + amountPaid);
        await db.ref('analytics/successfulPayments').transaction(c => (c || 0) + 1);

        await logVerification(reference, 'Order', 'Success', 'Order verified and stock updated');
        return res.status(200).json({ success: true, order: newOrder });

    } catch (error) {
        await logVerification(reference, 'Order', 'Error', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
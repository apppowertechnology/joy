// app.js - AURACIOUS SIP Storefront Logic

let allProducts = [];
let lastOrder = null;
let cart = JSON.parse(localStorage.getItem('auracious_cart')) || [];

document.addEventListener('DOMContentLoaded', () => {
    checkSubscription();
    trackVisit();
    loadDynamicCategories();
    loadSocialLinks();
    loadProducts();
    updateCartBadge();
    setupListeners();
    setupLockScreenRenewal();
    handleInitialRouting();
});

function handleInitialRouting() {
    const path = window.location.pathname;
    if (path === '/story') toggleOurStory(true);
    if (path === '/tracking') toggleTrackingView(true);
}

const showToast = (msg, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
};

async function fetchWithRetry(url, options, retries = 3, backoff = 1000) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            // Read as text first to handle HTML error pages gracefully
            const errorText = await res.text();
            let errorMessage = `Server error: ${res.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorMessage;
            } catch (e) {
                errorMessage = errorText.substring(0, 100) || errorMessage;
            }
            throw new Error(errorMessage);
        }
        return await res.json();
    } catch (err) {
        const isNetworkError = err instanceof TypeError || err.message.includes('fetch') || err.message.includes('network');
        if (retries > 0 && isNetworkError) {
            console.warn(`Retrying... (${retries} left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw err;
    }
}

async function trackVisit() {
    const date = new Date().toISOString().split('T')[0];
    const visitRef = db.ref(`analytics/traffic/${date}`);
    await visitRef.transaction(curr => (curr || 0) + 1);
    
    // Heartbeat for Active Users
    const sessionId = Math.random().toString(36).substring(7);
    const activeRef = db.ref(`analytics/activeUsers/${sessionId}`);
    activeRef.set({ lastActive: Date.now() });
    activeRef.onDisconnect().remove();
    setInterval(() => activeRef.update({ lastActive: Date.now() }), 30000);
}

function loadDynamicCategories() {
    db.ref('categories').on('value', snapshot => {
        const nav = document.getElementById('categoryNav');
        const categories = snapshot.val() || {};
        let html = '<button class="cat-pill active" data-cat="All">All Items</button>';
        Object.keys(categories).forEach(id => {
            html += `<button class="cat-pill" data-cat="${categories[id].name}">${categories[id].name}</button>`;
        });
        nav.innerHTML = html;
        setupCategoryListeners();
    });
}

function loadSocialLinks() {
    db.ref('settings/social').on('value', snapshot => {
        const social = snapshot.val();
        if (!social) return;
        
        const containers = document.querySelectorAll('.social-links-display');
        // Map keys to Font Awesome classes
        const iconClasses = {
            facebook: 'fab fa-facebook', instagram: 'fab fa-instagram', 
            tiktok: 'fab fa-tiktok', whatsapp: 'fab fa-whatsapp', 
            twitter: 'fab fa-x-twitter', youtube: 'fab fa-youtube'
        };

        let html = '';
        Object.keys(social).forEach(key => {
            if (social[key] && iconClasses[key]) {
                html += `<a href="${social[key]}" target="_blank" class="social-icon-btn" title="${key}"><i class="${iconClasses[key]}"></i></a>`;
            }
        });
        
        containers.forEach(c => c.innerHTML = html);
    });
}

async function checkSubscription() {
    db.ref('subscription').on('value', snapshot => {
        const sub = snapshot.val();
        const isExpired = sub && sub.expiresAt < Date.now();
        const isLocked = sub && sub.systemLocked === true;

        if (isExpired || isLocked) {
        document.getElementById('lock-screen').style.display = 'flex';
        document.body.classList.add('locked');
        
        if (isExpired) {
            document.getElementById('lock-title').innerText = "Subscription Expired";
            document.getElementById('lock-msg').innerText = "Renew your AURACIOUS SIP platform access to continue operations.";
            document.getElementById('renew-btn-wrapper').style.display = 'block';
        } else {
            document.getElementById('lock-title').innerText = "System Locked";
            document.getElementById('lock-msg').innerText = "Access restricted by developer control.";
            document.getElementById('renew-btn-wrapper').style.display = 'none';
        }
        } else {
            document.getElementById('lock-screen').style.display = 'none';
            document.body.classList.remove('locked');
        }
    });
}

const setProcessingState = (isProcessing, message = "Processing...") => {
    let overlay = document.getElementById('processingOverlay');
    if (!overlay && isProcessing) {
        overlay = document.createElement('div');
        overlay.id = 'processingOverlay';
        overlay.className = 'modal'; // Reuse modal styles for backdrop
        overlay.style.display = 'flex';
        overlay.innerHTML = `<div class="modal-content" style="text-align:center;"><div class="success-icon-circle blinking"><i class="fas fa-sync-alt"></i></div><h3 id="procMsg">${message}</h3><p>Please do not close this window.</p></div>`;
        document.body.appendChild(overlay);
    }
    if (overlay) overlay.style.display = isProcessing ? 'flex' : 'none';
    if (overlay && message) document.getElementById('procMsg').innerText = message;
};

async function initiatePaystackSubscriptionPaymentFromLockScreen() {
    // Assuming a default 1-month renewal from the lock screen for simplicity
    // Or you could add options to the lock screen for different durations
    const months = 1; 
    const defaultMonthlyPrice = 5000; // Fallback if pricing not loaded

    // Attempt to get current pricing from Firebase
    let currentMonthlyRate = defaultMonthlyPrice;
    try {
        const snap = await db.ref('subscriptionPricing').once('value');
        const data = snap.val();
        if (data && typeof data === 'object' && data.monthlyPrice) {
            currentMonthlyRate = parseFloat(data.monthlyPrice);
        } else if (data && typeof data === 'number') {
            currentMonthlyRate = parseFloat(data);
        }
    } catch (error) {
        console.error("Failed to load pricing for lock screen renewal:", error);
    }

    const total = months * currentMonthlyRate;
    if (total <= 0) return alert("Subscription price is not configured. Please contact support.");

    const renewBtn = document.getElementById('lockRenewBtn'); // Assuming a button with this ID on the lock screen
    if (renewBtn) {
        renewBtn.disabled = true;
        renewBtn.innerText = "Initializing Paystack...";
    }

    const ref = 'AS-LOCK-SUB-' + Date.now();

    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: 'admin@auracioussip.com', // Or a generic contact email
        amount: total * 100, // Paystack expects amount in kobo
        currency: 'NGN',
        ref: ref,
        callback: function(response) {
            setProcessingState(true, "Verifying Subscription...");
            fetchWithRetry(`${API_URL}/subscription`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ reference: response.reference, months: months, amount: total })
            })
            .then(() => location.reload())
            .catch(err => {
                setProcessingState(false);
                showToast("Verification failed. Please contact support.", "error");
            });
        },
        onClose: () => { if (renewBtn) { renewBtn.disabled = false; renewBtn.innerText = "Renew Subscription"; } }
    });
    handler.openIframe();
}

function loadProducts() {
    db.ref('products').on('value', snapshot => {
        allProducts = [];
        snapshot.forEach(child => {
            allProducts.push({ id: child.key, ...child.val() });
        });
        renderProducts(allProducts);
    });
}

function renderProducts(products) {
    const container = document.getElementById('productContainer');
    container.innerHTML = products.map(p => `
        <div class="product-card premium-card" data-id="${p.id}">
            <div class="img-container">
                <img src="${p.image}" class="product-image" loading="lazy" alt="${p.name}">
                ${p.stock < 1 ? '<div class="card-overlay"><span class="badge-sold">Sold Out</span></div>' : ''}
                ${p.stock > 0 && p.stock < 5 ? `<span class="badge badge-pending" style="position:absolute; bottom:10px; right:10px; z-index:10; background:var(--orange); color:white;">Only ${p.stock} left</span>` : ''}
                <div class="card-category-tag">${p.category}</div>
            </div>
            <div class="product-info">
                <p class="product-unit">${p.unit}</p>
                <h3 class="product-name">${p.name}</h3>
                <div class="product-footer">
                    <span class="product-price">₦${Number(p.price).toLocaleString()}</span>
                    <div class="card-controls">
                        <input type="number" value="${p.stock < 1 ? 0 : 1}" min="${p.stock < 1 ? 0 : 1}" max="${p.stock}" 
                            class="qty-input" id="qty-${p.id}" ${p.stock < 1 ? 'disabled' : ''}>
                        <button class="btn btn-primary btn-sm" ${p.stock < 1 ? 'disabled' : ''} 
                            onclick="addToCart('${p.id}')">
                            ${p.stock < 1 ? 'Sold Out' : 'Add'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product || (product.stock || 0) < 1) {
        return showToast("Sorry, this item is out of stock.", "error");
    }

    const qtyInput = document.getElementById(`qty-${productId}`);
    const quantity = parseInt(qtyInput.value);

    if (isNaN(quantity) || quantity < 1) return;

    const existingItem = cart.find(item => item.id === productId);
    const currentInCart = existingItem ? existingItem.quantity : 0;

    if (currentInCart + quantity > product.stock) {
        return showToast(`Only ${product.stock} available in total.`, "error");
    }

    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        cart.push({ ...product, quantity });
    }

    saveCart();
    showToast(`${product.name} added to cart`);
}

function saveCart() {
    localStorage.setItem('auracious_cart', JSON.stringify(cart));
    updateCartBadge();
}

function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.innerText = totalItems;
}

function openCart() {
    const container = document.getElementById('cartItemsContainer');
    let hasStockError = false;

    if (cart.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding: 20px;">Your cart is empty.</p>';
        document.getElementById('checkoutBtn').disabled = true;
    } else {
        container.innerHTML = cart.map(item => {
            const product = allProducts.find(p => p.id === item.id);
            const isInsufficient = !product || product.stock < item.quantity;
            if (isInsufficient) hasStockError = true;

            return `
                <div class="cart-item" style="${isInsufficient ? 'border-left: 4px solid var(--danger);' : ''}">
                    <img src="${item.image}" alt="${item.name}">
                    <div class="cart-item-info">
                        <h4>${item.name}</h4>
                        <p>₦${Number(item.price).toLocaleString()} x ${item.quantity}</p>
                        ${isInsufficient ? `<p class="text-danger" style="font-size:0.75rem; font-weight:700;">Insufficient Stock: Only ${product ? product.stock : 0} left</p>` : ''}
                    </div>
                    <button class="remove-item" onclick="removeFromCart('${item.id}')">✕</button>
                </div>
            `;
        }).join('');
        document.getElementById('checkoutBtn').disabled = hasStockError;
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('cartSubtotal').innerText = `₦${subtotal.toLocaleString()}`;
    document.getElementById('cartTotal').innerText = `₦${subtotal.toLocaleString()}`;
    document.getElementById('cartModal').style.display = 'flex';
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    openCart();
}

function closeCart() {
    document.getElementById('cartModal').style.display = 'none';
}

function openCheckout() {
    closeCart();
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('checkoutTotal').innerText = `₦${total.toLocaleString()}`;
    document.getElementById('orderModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('orderModal').style.display = 'none';
}

function setupCategoryListeners() {
    document.querySelectorAll('.cat-pill').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelector('.cat-pill.active').classList.remove('active');
            e.target.classList.add('active');
            const cat = e.target.dataset.cat;
            const filtered = cat === 'All' ? allProducts : allProducts.filter(p => p.category === cat);
            renderProducts(filtered);
        });
    });
}

function toggleOurStory(show) {
    const homeView = document.getElementById('homeView'); // Your main product/hero container
    const storyView = document.getElementById('ourStoryView');
    
    if (show) {
        if(homeView) homeView.style.display = 'none';
        if(storyView) storyView.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        if(homeView) homeView.style.display = 'block';
        if(storyView) storyView.classList.remove('active');
    }
}

function toggleTrackingView(show) {
    const homeView = document.getElementById('homeView');
    const trackingView = document.getElementById('trackingView');
    if (show) {
        homeView.style.display = 'none';
        trackingView.classList.add('active');
    } else {
        homeView.style.display = 'block';
        trackingView.classList.remove('active');
    }
}

function setupListeners() {
    setupCategoryListeners();

    // Search
    document.getElementById('productSearch').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allProducts.filter(p => p.name.toLowerCase().includes(query));
        renderProducts(filtered);
    });

    // Navigation for Our Story (Apply data-nav="story" to your Nav link)
    document.querySelectorAll('[data-nav="story"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            toggleOurStory(true);
        });
    });

    // Order Form Submission
    document.getElementById('orderForm').addEventListener('submit', (e) => {
        e.preventDefault();
        processPayment();
    });
}

function setupLockScreenRenewal() {
    const lockRenewBtn = document.getElementById('lockRenewBtn');
    if (lockRenewBtn) {
        lockRenewBtn.onclick = initiatePaystackSubscriptionPaymentFromLockScreen;
    }
}


function processPayment() {
    const amount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const ref = 'AS-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const payBtn = document.querySelector('#orderForm button[type="submit"]');
    payBtn.disabled = true;
    payBtn.innerText = "Initializing Paystack...";

    // Log Pending Transaction
    const transData = {
        customerName: document.getElementById('custName').value,
        phone: document.getElementById('custPhone').value,
        amount: amount,
        items: cart.map(i => `${i.name} (${i.quantity})`).join(', '),
        status: 'Pending',
        reference: ref,
        createdAt: Date.now()
    };
    db.ref(`transactions/${ref}`).set(transData);

    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: `customer_${Date.now()}@auracioussip.com`,
        amount: amount * 100, // Kobo
        currency: 'NGN',
        ref: ref,
        callback: function(response) {
            verifyOrderOnBackend(response.reference);
        },
        onClose: () => {
            db.ref(`transactions/${ref}`).update({ status: 'Failed' });
            payBtn.disabled = false;
            payBtn.innerText = `Proceed to Payment`;
        }
    });
    handler.openIframe();
}

async function verifyOrderOnBackend(ref) {
    const orderData = {
        customerName: document.getElementById('custName').value,
        phone: document.getElementById('custPhone').value,
        address: document.getElementById('custAddress').value,
        note: document.getElementById('orderNote').value,
        items: cart.map(item => ({
            id: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            price: item.price,
            quantity: item.quantity
        }))
    };

    setProcessingState(true, "Verifying Payment...");

    try {
        const result = await fetchWithRetry(`${API_URL}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: ref, orderData })
        });
        if (result.success) {
            lastOrder = result.order;
            localStorage.removeItem('auracious_cart');
            cart = [];
            updateCartBadge();
            showOrderReceipt(result.order);
            setProcessingState(false);
        }
    } catch (e) {
        setProcessingState(false);
        showToast(e.message || 'Verification failed. Contact support.', 'error');
        const payBtn = document.querySelector('#orderForm button[type="submit"]');
        if (payBtn) {
            payBtn.disabled = false;
            payBtn.innerText = "Retry Verification";
            payBtn.className = "btn btn-danger"; // Visual cue for failure
            payBtn.onclick = () => verifyOrderOnBackend(ref);
        }
    }
}

function showOrderReceipt(order) {
    if (!order) {
        showToast("Payment confirmed, but receipt data is loading. Check your email or Admin Panel.", "info");
        return;
    }
    const container = document.getElementById('receiptContent');
    document.getElementById('orderModal').style.display = 'none';
    document.getElementById('orderSuccessModal').style.display = 'flex';

    const itemsHtml = order.items.map(i => {
        const subtotal = i.price * i.quantity;
        return `
            <div class="receipt-row">
                <div style="text-align: left;">
                    <span style="display:block; font-weight:600;">${i.name}</span>
                    <span style="font-size:0.75rem; color:#666;">${i.category || ''} ${i.unit ? '| ' + i.unit : ''}</span>
                </div>
                <div style="text-align: right;">
                    <span style="font-size:0.85rem; color:#666;">${i.quantity} x ₦${Number(i.price).toLocaleString()}</span>
                    <span style="display:block; font-weight:600;">₦${subtotal.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="receipt-card premium-receipt">
            <div class="receipt-header">
                <div class="success-icon-circle"><i class="fas fa-check"></i></div>
                <h3>AURACIOUS SIP</h3>
                <p class="receipt-subtitle">Payment Successful Receipt</p>
            </div>
            
            <div class="tracking-section">
                <span class="label">Tracking Ticket Number</span>
                <div class="ticket-box">${order.ticketNumber}</div>
            </div>

            <div class="receipt-details">
                <div class="detail-group">
                    <h4>Customer Details</h4>
                    <p><strong>Name:</strong> ${order.customerName}</p>
                    <p><strong>Phone:</strong> ${order.phone}</p>
                    <p style="font-size:0.85rem"><strong>Address:</strong> ${order.address}</p>
                </div>

                <div class="detail-group">
                    <h4>Order Summary</h4>
                    <div class="receipt-items-list">
                        ${itemsHtml}
                    </div>
                    <div class="receipt-row total">
                        <span>Total Paid</span>
                        <span>₦${order.amount.toLocaleString()}</span>
                    </div>
                </div>

                <div class="detail-group">
                    <h4>Payment Information</h4>
                    <p><strong>Status:</strong> <span class="text-success">Successful</span></p>
                    <p><strong>Method:</strong> Paystack</p>
                    <p><strong>Reference:</strong> ${order.paymentReference}</p>
                    <p><strong>Date/Time:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
                </div>
            </div>

            <div class="receipt-footer">
                <p class="thank-you-msg">Thank you for choosing AURACIOUS SIP.</p>
                <p>We have received your order successfully.</p>
            </div>
        </div>
    `;
}

async function downloadReceiptPDF() {
    if (!lastOrder) return;
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Brand Header
        doc.setTextColor(8, 28, 21); // --primary
        doc.setFontSize(24);
        doc.text("AURACIOUS SIP", 105, 20, { align: "center" });
        
        doc.setTextColor(100);
        doc.setFontSize(10);
        doc.text("OFFICIAL PAYMENT RECEIPT", 105, 27, { align: "center" });
        
        // Ticket Number Highlight
        doc.setFillColor(8, 28, 21);
        doc.rect(70, 35, 70, 15, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.text(`Ticket: ${lastOrder.ticketNumber}`, 105, 45, { align: "center" });
        
        doc.setTextColor(0);
        doc.setFontSize(12);
        
        // Info Tables
        doc.autoTable({
            startY: 60,
            head: [['Customer Details', 'Payment Info']],
            body: [[
                `Name: ${lastOrder.customerName}\nPhone: ${lastOrder.phone}\nAddress: ${lastOrder.address}`,
                `Status: Successful\nMethod: Paystack\nRef: ${lastOrder.paymentReference}\nDate: ${new Date(lastOrder.createdAt).toLocaleString()}`
            ]],
            theme: 'plain',
            styles: { fontSize: 9 }
        });

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Product', 'Category', 'Qty', 'Subtotal']],
            body: lastOrder.items.map(i => [
                i.name, 
                i.category || 'Standard', 
                `${i.quantity} ${i.unit || 'unit(s)'}`, 
                `N${(i.price * i.quantity).toLocaleString()}`
            ]),
            foot: [['', '', 'Grand Total Paid', `N${lastOrder.amount.toLocaleString()}`]],
            headStyles: { fillColor: [8, 28, 21] },
            footStyles: { fillColor: [248, 249, 250], textColor: [0, 0, 0], fontStyle: 'bold' }
        });

        const finalY = doc.lastAutoTable.finalY + 20;
        doc.setFontSize(11);
        doc.text("Thank you for choosing AURACIOUS SIP.", 105, finalY, { align: "center" });
        doc.text("We have received your order successfully.", 105, finalY + 7, { align: "center" });

        doc.save(`AURACIOUS-SIP-Receipt-${lastOrder.ticketNumber}.pdf`);
    } catch (err) {
        console.error(err);
        showToast("Unable to generate PDF. Please retry.", "error");
    }
}

function shareReceipt() {
    if (!lastOrder) return;
    const shareData = {
        title: 'AURACIOUS SIP Receipt',
        text: `My order ${lastOrder.ticketNumber} from AURACIOUS SIP is confirmed! Amount: ₦${lastOrder.amount.toLocaleString()}. Ref: ${lastOrder.paymentReference}`,
        url: window.location.origin
    };
    if (navigator.share) {
        navigator.share(shareData).catch(() => showToast("Sharing cancelled", "info"));
    } else {
        navigator.clipboard.writeText(shareData.text);
        showToast("Receipt details copied to clipboard!", "success");
    }
}

function copyTicketNumber() {
    if (!lastOrder) return;
    navigator.clipboard.writeText(lastOrder.ticketNumber);
    const btn = document.getElementById('copyTicketBtn');
    btn.innerText = "Copied!";
    setTimeout(() => btn.innerText = "Copy Ticket #", 2000);
}

function searchPublicOrder() {
    const ticket = document.getElementById('publicTrackingId').value.trim().toUpperCase();
    const resultArea = document.getElementById('publicTrackingResult');
    if (!ticket) return showToast("Enter a ticket number", "error");

    db.ref('orders').orderByChild('ticketNumber').equalTo(ticket).once('value', snapshot => {
        if (!snapshot.exists()) {
            resultArea.innerHTML = `<div class="admin-card text-danger">Order not found. Please check your ticket number.</div>`;
            return;
        }
        
        snapshot.forEach(child => {
            const order = child.val();
            const statusClass = order.orderStatus.toLowerCase().replace(/\s+/g, '-');
            resultArea.innerHTML = `
                <div class="tracking-card">
                    <div style="display:flex; justify-content:space-between; align-items:center">
                        <h4>Ticket: ${order.ticketNumber}</h4>
                        <span class="status-pill status-${statusClass}">${order.orderStatus}</span>
                    </div>
                    <div class="tracking-timeline">
                        <div class="timeline-item"><strong>Order Placed:</strong> ${new Date(order.createdAt).toLocaleDateString()}</div>
                        <div class="timeline-item"><strong>Current Status:</strong> ${order.orderStatus}</div>
                    </div>
                    <p style="margin-top:15px; font-size:0.8rem; color:#666">Delivery for: ${order.customerName}</p>
                </div>
            `;
        });
    });
}
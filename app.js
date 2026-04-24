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
    const urlParams = new URLSearchParams(window.location.search);
    
    if (path === '/story' || urlParams.get('view') === 'story') toggleOurStory(true);
    if (path === '/tracking' || urlParams.get('view') === 'tracking') toggleTrackingView(true);

    // CAPTURE REFERENCE: Check search params OR pathname (for Vercel rewrites)
    let ref = urlParams.get('reference') || urlParams.get('trxref');
    
    // Broaden detection: if path is not a known route, treat as possible ref
    const knownRoutes = ['/', '/index.html', '/story', '/tracking', '/admin.html', '/tinubu.html'];
    if (!ref && path.length > 5 && !knownRoutes.some(r => path.endsWith(r))) {
        ref = path.split('/').filter(Boolean).pop(); 
    }

    if (ref) {
        // Check if this was a subscription recovery
        if (sessionStorage.getItem('pending_sub_months')) {
            handleSubscriptionRecovery(ref);
            window.history.replaceState({}, document.title, "/");
            return;
        }

        // Recover lost form data from session if this was a redirect
        const savedData = sessionStorage.getItem('pending_checkout_data');
        const orderData = savedData ? JSON.parse(savedData) : null;
        
        verifyOrderOnBackend(ref, orderData);
        
        // Clean the URL for a premium look
        window.history.replaceState({}, document.title, "/");
    }
}

async function handleSubscriptionRecovery(ref) {
    const months = sessionStorage.getItem('pending_sub_months');
    const amount = sessionStorage.getItem('pending_sub_amount');
    
    setProcessingState(true, "Verifying Subscription...");
    try {
        await fetchWithRetry(`${API_URL}/subscription`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ reference: ref, months: parseInt(months), amount: parseFloat(amount) })
        });
        sessionStorage.removeItem('pending_sub_months');
        location.reload();
    } catch (err) {
        setProcessingState(false);
        showToast("Subscription verification failed. Please contact support.", "error");
    }
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

    // Persist sub details for recovery if redirected
    sessionStorage.setItem('pending_sub_months', months);
    sessionStorage.setItem('pending_sub_amount', total);

    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: 'admin@auracioussip.com', // Or a generic contact email
        amount: total * 100, // Paystack expects amount in kobo
        currency: 'NGN',
        ref: ref,
        callback_url: window.location.origin, // Force return to index.html for recovery
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

    const customerInfo = {
        customerName: document.getElementById('custName').value,
        email: document.getElementById('custEmail').value,
        phone: document.getElementById('custPhone').value,
        address: document.getElementById('custAddress').value,
        note: document.getElementById('orderNote').value
    };

    // PERSISTENCE: Save form data in case of redirect
    sessionStorage.setItem('pending_checkout_data', JSON.stringify(customerInfo));

    payBtn.disabled = true;
    payBtn.innerText = "Initializing Paystack...";

    // Log Pending Transaction
    const transData = {
        ...customerInfo,
        amount: amount,
        items: cart.map(item => ({
            id: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            price: item.price,
            quantity: item.quantity
        })),
        status: 'Pending',
        reference: ref,
        createdAt: Date.now()
    };
    db.ref(`transactions/${ref}`).set(transData);

    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: customerInfo.email,
        amount: amount * 100, // Kobo
        currency: 'NGN',
        ref: ref,
        callback_url: window.location.origin + "/index.html", // Explicit file path to prevent 404
        callback: function(response) {
            // Strictly handle via AJAX, do not allow browser redirect
            verifyOrderOnBackend(response.reference);
        },
        onClose: () => {
            db.ref(`transactions/${ref}`).update({ status: 'Canceled' });
            payBtn.disabled = false;
            payBtn.innerText = `Proceed to Payment`;
        }
    });
    handler.openIframe();
}

async function verifyOrderOnBackend(ref, recoveredData = null) {
    // Use recovered data (from redirect) or live form data (from popup)
    const orderData = recoveredData || {
        customerName: document.getElementById('custName')?.value,
        email: document.getElementById('custEmail')?.value,
        phone: document.getElementById('custPhone')?.value,
        address: document.getElementById('custAddress')?.value,
        note: document.getElementById('orderNote')?.value,
        items: cart.map(item => ({
            id: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            price: item.price,
            quantity: item.quantity
        }))
    };

    // Safety Check: If we are recovering from a redirect and session is empty
    if (!orderData.customerName && !recoveredData) {
        setProcessingState(false);
        showToast("Order details lost during redirect. Please check your email or contact support with your reference.", "error");
        console.error("Redirect Recovery Failed: No order data available.");
        return;
    }

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
                sessionStorage.removeItem('pending_checkout_data');
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
    if (!order) return;
    const container = document.getElementById('receiptContent');
    const modal = document.getElementById('orderSuccessModal');
    
    // Hide other modals
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    modal.style.display = 'flex';

    const itemsHtml = order.items.map(i => {
        const subtotal = i.price * i.quantity;
        return `
            <div class="receipt-row">
                <div style="text-align: left;">
                    <span style="display:block; font-weight:600; color: var(--primary);">${i.name}</span>
                    <span style="font-size:0.75rem; color:#666;">${i.category || ''} ${i.unit ? '| ' + i.unit : ''}</span>
                </div>
                <div style="text-align: right;">
                    <span style="font-size:0.85rem; color:#888;">${i.quantity} x ₦${Number(i.price).toLocaleString()}</span>
                    <span style="display:block; font-weight:600;">₦${subtotal.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');

    const receiptHtml = `
        <div class="receipt-card premium-receipt" style="animation: slideUp 0.4s ease-out;">
            <div class="receipt-header">
                <div class="success-icon-circle"><i class="fas fa-check"></i></div>
                <h2 style="font-family: 'Playfair Display'; letter-spacing: 1px;">AURACIOUS SIP</h2>
                <div class="badge badge-successful" style="margin-top: 10px; font-size: 0.8rem;">PAYMENT VERIFIED</div>
            </div>
            
            <div class="tracking-section">
                <span class="label">OFFICIAL TRACKING TICKET</span>
                <div class="ticket-box">${order.ticketNumber}</div>
            </div>

            <div class="receipt-details">
                <div class="detail-group">
                    <h4 class="receipt-section-title"><i class="fas fa-user"></i> Recipient Info</h4>
                    <div class="info-grid">
                        <span>Customer:</span> <strong>${order.customerName}</strong>
                        <span>Phone:</span> <strong>${order.phone}</strong>
                        <span>Address:</span> <strong style="font-size: 0.8rem;">${order.address}</strong>
                    </div>
                </div>

                <div class="detail-group">
                    <h4 class="receipt-section-title"><i class="fas fa-shopping-cart"></i> Order Summary</h4>
                    <div class="receipt-items-list">
                        ${itemsHtml}
                    </div>
                    <div class="receipt-row total">
                        <span style="font-size: 1.1rem;">Total Verified Paid</span>
                        <span style="font-size: 1.2rem; color: var(--primary-light);">₦${order.amount.toLocaleString()}</span>
                    </div>
                </div>

                <div class="detail-group" style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
                    <h4 class="receipt-section-title"><i class="fas fa-credit-card"></i> Transaction Log</h4>
                    <div class="info-grid" style="font-size: 0.8rem;">
                        <span>Method:</span> <strong>Paystack Secure</strong>
                        <span>Reference:</span> <strong>${order.paymentReference}</strong>
                        <span>Date:</span> <strong>${new Date(order.createdAt).toLocaleString()}</strong>
                        <span>Status:</span> <strong class="text-success">VERIFIED</strong>
                    </div>
                </div>
            </div>

            <div class="receipt-footer">
                <p class="thank-you-msg">Thank you for your premium selection.</p>
                <p style="font-size: 0.75rem; color: #888;">Please present your ticket number to our delivery partners.</p>
            </div>
        </div>
    `;

    container.innerHTML = receiptHtml;
}

function goToTrackingFromReceipt() {
    const ticket = lastOrder ? lastOrder.ticketNumber : '';
    document.getElementById('orderSuccessModal').style.display = 'none';
    toggleTrackingView(true);
    if (ticket) {
        document.getElementById('publicTrackingId').value = ticket;
        searchPublicOrder();
    }
}

function printReceipt() {
    if (!lastOrder) return;
    const content = document.getElementById('receiptContent').innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Receipt - ${lastOrder.ticketNumber}</title>
                <link rel="stylesheet" href="/style.css">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    body { background: white !important; color: black !important; padding: 40px; font-family: 'Montserrat', sans-serif; }
                    .receipt-card { box-shadow: none !important; border: 1px solid #eee; margin: 0 auto; width: 100%; max-width: 600px; animation: none !important; }
                </style>
            </head>
            <body>
                <div class="modal-content" style="box-shadow:none; border:none; padding:0; background:none;">${content}</div>
                <script>window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 500); };</script>
            </body>
        </html>
    `);
    printWindow.document.close();
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

async function manualVerifyPayment() {
    const refInput = document.getElementById('manualRefInput');
    const ref = refInput ? refInput.value.trim() : null;
    if (!ref) return showToast("Please enter the payment reference from your bank alert/Paystack", "error");

    setProcessingState(true, "Checking transaction records...");
    
    try {
        // 1. DATABASE CHECK: Search completed orders (already processed)
        const orderSnap = await db.ref('orders').orderByChild('paymentReference').equalTo(ref).once('value');
        if (orderSnap.exists()) {
            let existingOrder;
            orderSnap.forEach(c => { existingOrder = c.val(); });
            
            lastOrder = existingOrder;
            setProcessingState(false);
            showOrderReceipt(existingOrder);
            if (refInput) refInput.value = '';
            showToast("Order record found and recovered.");
            return;
        }

        // 2. LEDGER CHECK: Did we initiate this transaction? 
        // This validates the reference against our own records before Paystack
        const snapshot = await db.ref(`transactions/${ref}`).once('value');
        const transData = snapshot.val();

        if (!transData) {
            setProcessingState(false);
            return showToast("Invalid reference number. This payment was not initiated on this platform.", "error");
        }

        // 3. CONTEXT VALIDATION: Ensure it's not a subscription token
        if (!transData.items && transData.months) {
            setProcessingState(false);
            return showToast("This reference belongs to a system license, not a product order.", "error");
        }

        // 4. FINAL VERIFICATION: Confirmed in DB, now sync with Gateway
        const statusMsg = transData.status === 'Successful' ? "Finalizing order details..." : "Synchronizing payment status...";
        setProcessingState(true, statusMsg);

        const orderData = {
            customerName: transData.customerName,
            email: transData.email,
            phone: transData.phone,
            address: transData.address,
            note: transData.note || "",
            items: transData.items
        };

        // Trigger the professional success flow
        await verifyOrderOnBackend(ref, orderData);
        if (refInput) refInput.value = '';
    } catch (e) {
        setProcessingState(false);
        showToast(e.message || "Unable to sync payment. Please try again or check your connection.", "error");
    }
}
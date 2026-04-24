// admin.js - AURACIOUS SIP Management Logic
let salesChart = null;
let systemPricing = { monthlyPrice: 100 };
let currentSubscriptionExpiry = null;
let subscriptionTicker = null;

function authAdmin() {
    const pin = document.getElementById('adminPin').value;
    
    db.ref('subscription').once('value', snapshot => {
        const sub = snapshot.val();
        if (sub && sub.adminLocked === true) {
            return alert("AURACIOUS SIP: ADMIN ACCESS RESTRICTED BY DEVELOPER CONTROL.");
        }

    if (pin === "AURACIOUSSIP MANAGEMENT") {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('adminDashboard').style.display = 'block';
        initDashboard();
    } else {
        document.getElementById('loginError').style.display = 'block';
        document.getElementById('adminPin').value = '';
    }
    });
}

function switchTab(tabId) {
    const isExpired = document.body.classList.contains('sub-expired');
    if (isExpired && tabId !== 'subscription') {
        return showToast("Subscription expired. Please renew to access this section.", "error");
    }

    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    
    document.getElementById(`tab-${tabId}`).classList.add('active');
    const activeLink = Array.from(document.querySelectorAll('.nav-link')).find(l => l.innerText.toLowerCase().includes(tabId));
    if(activeLink) activeLink.classList.add('active');
    
    document.getElementById('currentTabTitle').innerText = tabId.charAt(0).toUpperCase() + tabId.slice(1);
}

function initDashboard() {
    initRealTimeAnalytics();
    initSalesChart();
    loadCategories();
    loadProducts();
    loadTransactions('All');
    loadUploadedAssets();
    loadTrackingOrders();
    loadAnalytics();
    loadSettings();
    loadSubscriptionHistory();
    loadPricingConfig();
    
    setInterval(() => {
        const time = new Date().toLocaleTimeString();
        document.getElementById('currentDateTime').innerText = time;
    }, 1000);

    setupSubscriptionListener();

    // Start the 1-second heartbeat ticker
    if (subscriptionTicker) clearInterval(subscriptionTicker);
    subscriptionTicker = setInterval(updateSubscriptionTimer, 1000);
}

function setupSubscriptionListener() {
    // Prevent listener stacking
    db.ref('subscription').off('value');
    db.ref('subscription').on('value', snapshot => {
        const sub = snapshot.val();
        
        // Fail-safe logic: If subscription data is missing (null), default to restricted/expired
        currentSubscriptionExpiry = (sub && sub.expiresAt) ? Number(sub.expiresAt) : null;
        const isLocked = sub?.systemLocked === true;
        const isExpired = !currentSubscriptionExpiry || currentSubscriptionExpiry < Date.now();

        if (isLocked || isExpired) {
            document.body.classList.add('sub-expired');
        } else {
            document.body.classList.remove('sub-expired');
        }

        // Immediately refresh the UI display
        updateSubscriptionTimer();
    });
}

function manualRefreshSubscription() {
    setupSubscriptionListener();
    loadPricingConfig();
    showToast("Subscription data refreshed.", "success");
}

function loadPricingConfig() {
    const rateDisplay = document.getElementById('currentMonthlyRateDisplay');
    if (rateDisplay) rateDisplay.innerText = "Loading current pricing...";

    // Prevent listener stacking
    db.ref('subscriptionPricing').off('value');

    db.ref('subscriptionPricing').on('value', snap => {
        const data = snap.val();

        if (data !== null) {
            // Robust check: JS treats 'null' as an object, so we verify existence first
            if (typeof data === 'object') {
                systemPricing = { ...systemPricing, ...data };
            } else {
                // Fallback for legacy format (direct number)
                systemPricing = { monthlyPrice: Number(data) };
            }
        } else {
            systemPricing = { monthlyPrice: 100 };
            console.warn("AURACIOUS SIP: Pricing configuration missing in Database.");
        }

        updatePricingUI();
        if (typeof calculateSubPrice === 'function') calculateSubPrice();
        
    }, error => {
        console.error("Pricing Sync Error:", error);
        if (rateDisplay) rateDisplay.innerText = "Connection error. Retrying...";
    });
}

function updatePricingUI() {
    const rate = parseFloat(systemPricing?.monthlyPrice) || 0;
    const rateDisplay = document.getElementById('currentMonthlyRateDisplay');
    if (rateDisplay) {
        // Display 0 if rate is 0, instead of "unavailable", per requirements
        rateDisplay.innerText = `₦${rate.toLocaleString()} / Month`;

        // Auto-calculate standard tiers based on formula: Monthly * months
        const tiers = [1, 3, 6, 12];
        tiers.forEach(m => {
            const el = document.getElementById(`tier-${m}-price`);
            if (el) el.innerText = `₦${(rate * m).toLocaleString()}`;
        });
    }
}

function loadAnalytics() {
    const metrics = [
        { label: 'Active Users', node: 'analytics/activeUsers', id: 'count' },
        { label: 'Total Products', node: 'products', id: 'count' },
        { label: 'Total Orders', node: 'orders', id: 'count' },
        { label: 'Revenue (₦)', node: 'analytics/totalRevenue', id: 'val' }
    ];

    const grid = document.getElementById('analyticsGrid');
    grid.innerHTML = metrics.map(m => `
        <div class="stat-card">
            <span class="stat-label">${m.label}</span>
            <h3 id="metric-${m.label.replace(/\s+/g, '')}">0</h3>
        </div>
    `).join('');

    metrics.forEach(m => {
        db.ref(m.node).on('value', snapshot => {
            const val = m.id === 'count' ? snapshot.numChildren() : snapshot.val() || 0;
            document.getElementById(`metric-${m.label.replace(/\s+/g, '')}`).innerText = 
                m.id === 'val' ? `₦${val.toLocaleString()}` : val;
        });
    });

    // Advanced Financial Logic
    db.ref('transactions').on('value', snapshot => {
        let todayRev = 0;
        let monthRev = 0;
        const today = new Date().toDateString();
        const month = new Date().getMonth();
        const year = new Date().getFullYear();

        snapshot.forEach(child => {
            const t = child.val();
            if (t.status !== 'Successful') return;
            
            const tDate = new Date(t.createdAt);
            if (tDate.toDateString() === today) {
                todayRev += t.amount;
            }
            if (tDate.getMonth() === month && tDate.getFullYear() === year) {
                monthRev += t.amount;
            }
        });

        const tSalesEl = document.getElementById('todaySales');
        if (tSalesEl) tSalesEl.innerText = `₦${todayRev.toLocaleString()}`;
        
        const mRevEl = document.getElementById('monthlyRev');
        if (mRevEl) mRevEl.innerText = `₦${monthRev.toLocaleString()}`;
    });
}

function initRealTimeAnalytics() {
    // Active Users (Last 5 mins heartbeat)
    db.ref('analytics/activeUsers').on('value', snapshot => {
        const count = snapshot.numChildren();
        document.getElementById('activeUsers').innerText = count;
    });

    // Today's Traffic
    const date = new Date().toISOString().split('T')[0];
    db.ref(`analytics/traffic/${date}`).on('value', snapshot => {
        document.getElementById('todayVisits').innerText = snapshot.val() || 0;
    });

    // Product Count
    db.ref('products').on('value', snapshot => {
        document.getElementById('statProdCount').innerText = snapshot.numChildren();
    });
}

function initSalesChart() {
    const ctx = document.getElementById('salesChart').getContext('2d');
    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Weekly Sales (₦)',
                data: [12000, 19000, 15000, 25000, 22000, 30000, 45000],
                borderColor: '#1b4332',
                backgroundColor: 'rgba(27, 67, 50, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function loadCategories() {
    db.ref('categories').on('value', snapshot => {
        const list = document.getElementById('categoryList');
        const select = document.getElementById('prodCat');
        const assetFilter = document.getElementById('assetCatFilter');
        const categories = snapshot.val() || {};
        
        let html = '';
        let options = '<option value="">Select Category</option>';
        let filterOptions = '<option value="All">All Categories</option>';
        
        Object.keys(categories).forEach(id => {
            const cat = categories[id];
            html += `
                <div class="category-item-card">
                    <span>${cat.name}</span>
                    <button onclick="deleteCategory('${id}')">🗑️</button>
                </div>`;
            options += `<option value="${cat.name}">${cat.name}</option>`;
            filterOptions += `<option value="${cat.name}">${cat.name}</option>`;
        });
        list.innerHTML = html;
        select.innerHTML = options;
        if (assetFilter) assetFilter.innerHTML = filterOptions;
    });
}

document.getElementById('addCategoryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('catName').value;
    db.ref('categories').push({ name });
    e.target.reset();
});

function deleteCategory(id) {
    if(confirm('Delete this category?')) db.ref(`categories/${id}`).remove();
}

function loadUploadedAssets() {
    const searchQuery = document.getElementById('assetSearch')?.value.toLowerCase() || "";
    const catFilter = document.getElementById('assetCatFilter')?.value || "All";

    db.ref('products').on('value', snapshot => {
        const grid = document.getElementById('assetGrid');
        let html = '';
        
        if (!snapshot.exists()) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px;"><h3>No uploaded products yet.</h3></div>';
            return;
        }

        snapshot.forEach(child => {
            const p = child.val();
            if (catFilter !== "All" && p.category !== catFilter) return;
            if (searchQuery && !p.name.toLowerCase().includes(searchQuery)) return;

            const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'Unknown';
            const stockStatus = p.stock > 0 ? `<span class="text-success">In Stock (${p.stock})</span>` : '<span class="text-danger">Out of Stock</span>';
            
            const toggleIcon = p.stock > 0 ? '🚫' : '✅';
            const toggleTitle = p.stock > 0 ? 'Mark Out of Stock' : 'Restock (Set to 10)';

            html += `
                <div class="asset-card">
                    <div class="asset-img-wrapper" onclick="viewFullImage('${p.image}')">
                        <img src="${p.image}" class="asset-img" onerror="this.src='https://via.placeholder.com/200?text=No+Image'">
                        <div class="asset-hover-overlay"><span>View Full Image</span></div>
                    </div>
                    <div class="asset-details">
                        <h4>${p.name}</h4>
                        <span class="badge" style="background:#eee">${p.category}</span>
                        <p style="font-weight: 700; color: var(--primary-light); margin: 5px 0;">₦${Number(p.price).toLocaleString()}</p>
                        <p style="font-size:0.75rem; color: #888; margin-bottom: 5px;">${stockStatus}</p>
                        <p style="font-size:0.65rem; color: #aaa">Date: ${date}</p>
                    </div>
                    <div class="asset-actions">
                        <button class="btn-icon" title="${toggleTitle}" onclick="toggleStockStatus('${child.key}', ${p.stock})">${toggleIcon}</button>
                        <button class="btn-icon" title="Edit" onclick="openEditModal('${child.key}')">✏️</button>
                        <button class="btn-icon" title="Delete" onclick="deleteProduct('${child.key}')">🗑️</button>
                    </div>
                </div>`;
        });
        grid.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; padding: 50px;"><h3>No products match your search.</h3></div>';
    });
}

/**
 * Product Editing Functions
 */
function openEditModal(id) {
    db.ref(`products/${id}`).once('value', snapshot => {
        const p = snapshot.val();
        if (!p) return;
        
        document.getElementById('editProdId').value = id;
        document.getElementById('editProdName').value = p.name;
        document.getElementById('editProdPrice').value = p.price;
        document.getElementById('editProdStock').value = p.stock || 0;
        
        // Populate categories in modal
        db.ref('categories').once('value', catSnap => {
            const select = document.getElementById('editProdCat');
            let options = '';
            catSnap.forEach(c => {
                const name = c.val().name;
                options += `<option value="${name}" ${p.category === name ? 'selected' : ''}>${name}</option>`;
            });
            select.innerHTML = options;
        });

        document.getElementById('editProductModal').style.display = 'flex';
    });
}

function closeEditModal() {
    document.getElementById('editProductModal').style.display = 'none';
}

async function saveProductEdit() {
    const id = document.getElementById('editProdId').value;
    const name = document.getElementById('editProdName').value;
    const price = document.getElementById('editProdPrice').value;
    const stock = document.getElementById('editProdStock').value;
    const category = document.getElementById('editProdCat').value;
    const fileInput = document.getElementById('editProdImage');

    if (!name || !price || stock === "") return alert("Please fill in all fields.");

    const btn = document.getElementById('saveEditBtn');
    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
        let updateData = {
            name: name,
            price: parseFloat(price),
            stock: parseInt(stock),
            category: category
        };

        // If a new image is selected
        if (fileInput.files.length > 0) {
            const imageUrl = await handleImageUpload(fileInput.files[0]);
            updateData.image = imageUrl;
        }

        await db.ref(`products/${id}`).update(updateData);
        alert("Product updated successfully!");
        closeEditModal();
    } catch (err) {
        alert("Update failed: " + err.message);
    } finally {
        btn.innerText = "Save Changes";
        btn.disabled = false;
        fileInput.value = ""; // Reset file input
    }
}

async function toggleStockStatus(id, currentStock) {
    const newStock = currentStock > 0 ? 0 : 10; 
    try {
        await db.ref(`products/${id}`).update({ stock: newStock });
    } catch (err) {
        alert("Status update failed: " + err.message);
    }
}

function deleteProduct(id) {
    if (confirm('Are you sure you want to delete this product? This will remove it from the store instantly.')) {
        db.ref(`products/${id}`).remove()
            .then(() => alert('Product deleted successfully.'))
            .catch(err => alert('Error deleting product: ' + err.message));
    }
}

function viewFullImage(url) {
    window.open(url, '_blank');
}

function loadTransactions(filter = 'All') {
    db.ref('transactions').orderByChild('createdAt').on('value', snapshot => {
        const tbody = document.getElementById('transactionTableBody');
        let html = '';
        snapshot.forEach(child => {
            const t = child.val();
            if (filter !== 'All' && t.status !== filter) return;
            
            const statusClass = t.status.toLowerCase();
            html = `
                <tr>
                    <td>
                        <strong>${t.customerName}</strong><br>
                        <small>${t.phone}</small>
                    </td>
                    <td>₦${t.amount.toLocaleString()}</td>
                    <td><span class="badge badge-${statusClass}">${t.status}</span></td>
                    <td><code>${t.reference}</code></td>
                    <td>${new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>` + html;
        });
        tbody.innerHTML = html;
    });
}

/**
 * Subscription History Loader
 */
function loadSubscriptionHistory() {
    db.ref('subscription/history').on('value', snapshot => {
        const tbody = document.getElementById('subHistoryTableBody');
        let html = '';
        snapshot.forEach(child => {
            const h = child.val();
            html = `
                <tr>
                    <td>${new Date(h.date).toLocaleDateString()}</td>
                    <td>₦${Number(h.amount).toLocaleString()}</td>
                    <td>${h.months} Month(s)</td>
                    <td><code>${h.reference}</code></td>
                </tr>` + html;
        });
        tbody.innerHTML = html || '<tr><td colspan="4" style="text-align:center">No payment history found.</td></tr>';
    });
}

/**
 * Export Subscription History as PDF
 */
function exportSubHistoryPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFont("helvetica", "bold");
    doc.text("AURACIOUS SIP - Subscription History", 14, 15);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 22);
    
    doc.autoTable({
        html: '#subHistoryTable',
        startY: 30,
        theme: 'striped',
        headStyles: { fillColor: [8, 28, 21] }, // Matches --primary color
        styles: { fontSize: 9 }
    });
    
    doc.save(`Audacious_Sip_Subscription_History_${Date.now()}.pdf`);
}

function updateSubscriptionTimer() {
    const statusBadge = document.getElementById('subStatusBadge');
    const expiryDateDisplay = document.getElementById('expiryFullDate');
    const progressBar = document.getElementById('subProgressBar');
    const timerDisplay = document.getElementById('countdownTimer');
    const overlay = document.getElementById('subInactiveOverlay');

    if (!timerDisplay) return; // Exit if element not found in current view

    if (!currentSubscriptionExpiry) {
        timerDisplay.innerText = "SUBSCRIPTION INACTIVE";
        timerDisplay.className = "timer-value text-danger";
        if (statusBadge) statusBadge.innerText = "INACTIVE";
        if (overlay) overlay.style.display = 'flex';
        return;
    }

    if (overlay) overlay.style.display = 'none';

    const now = Date.now();
    const diff = currentSubscriptionExpiry - now;

    if (expiryDateDisplay) {
        expiryDateDisplay.innerText = `Full Expiry: ${new Date(currentSubscriptionExpiry).toLocaleString()}`;
    }
    
    if (diff <= 0) {
        timerDisplay.innerText = "EXPIRED";
        timerDisplay.className = "timer-value text-danger";
        if (statusBadge) {
            statusBadge.innerText = 'EXPIRED';
            statusBadge.className = 'badge badge-expired';
        }
        if (progressBar) progressBar.style.width = "0%";
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    // Verbose Professional Formatting
    const dLabel = days === 1 ? "Day" : "Days";
    const hLabel = hours === 1 ? "Hour" : "Hours";
    const mLabel = mins === 1 ? "Minute" : "Minutes";
    const sLabel = secs === 1 ? "Second" : "Seconds";

    timerDisplay.innerText = `${days} ${dLabel} ${hours} ${hLabel} ${mins} ${mLabel} ${secs} ${sLabel}`;
    
    if (progressBar) {
        progressBar.style.width = "100%"; // Active state
    }

    // Dynamic Premium UI States
    if (days >= 7) {
        if (statusBadge) {
            statusBadge.innerText = 'ACTIVE';
            statusBadge.className = 'badge badge-successful';
        }
        timerDisplay.className = 'timer-value text-success';
    } else if (days >= 3) {
        if (statusBadge) {
            statusBadge.innerText = 'WARNING';
            statusBadge.className = 'badge badge-pending';
        }
        timerDisplay.className = 'timer-value text-warning';
    } else {
        if (statusBadge) {
            statusBadge.innerText = 'EXPIRING SOON';
            statusBadge.className = 'badge badge-failed blinking';
        }
        timerDisplay.className = 'timer-value text-danger blinking';
    }
}

function loadTrackingOrders() {
    db.ref('orders').orderByChild('createdAt').on('value', snapshot => {
        const tbody = document.getElementById('trackingTableBody');
        let html = '';
        snapshot.forEach(child => {
            const o = child.val();
            const key = child.key;
            const statusClass = o.orderStatus.toLowerCase().replace(/\s+/g, '-');
            
            html = `
                <tr class="tracking-row" data-search="${(o.ticketNumber + o.customerName + o.phone).toLowerCase()}">
                    <td><strong>${o.ticketNumber}</strong></td>
                    <td>${o.customerName}<br><small>${o.phone}</small></td>
                    <td>₦${o.amount.toLocaleString()}</td>
                    <td><span class="badge badge-successful">${o.paymentStatus}</span></td>
                    <td><span class="status-pill status-${statusClass}">${o.orderStatus}</span></td>
                    <td>
                        <select onchange="updateOrderStatus('${key}', this.value)" style="padding:5px; font-size:0.8rem;">
                            <option value="">Update Status</option>
                            <option value="Pending">Pending</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Processing">Processing</option>
                            <option value="Out for Delivery">Out for Delivery</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Cancelled">Cancelled</option>
                        </select>
                    </td>
                </tr>` + html;
        });
        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center">No orders found.</td></tr>';
    });
}

function filterTrackingOrders() {
    const q = document.getElementById('orderSearchInput').value.toLowerCase();
    document.querySelectorAll('.tracking-row').forEach(row => {
        row.style.display = row.dataset.search.includes(q) ? 'table-row' : 'none';
    });
}

async function updateOrderStatus(id, newStatus) {
    if (!newStatus) return;
    try {
        await db.ref(`orders/${id}`).update({ orderStatus: newStatus, updatedAt: Date.now() });
        showToast(`Order status updated to ${newStatus}`);
    } catch (e) {
        showToast("Update failed", "error");
    }
}

/**
 * Social Media Settings Management
 */
function loadSettings() {
    db.ref('settings/social').on('value', snapshot => {
        const social = snapshot.val() || {};
        const platforms = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'twitter', 'youtube'];
        platforms.forEach(p => {
            const input = document.getElementById(`setting-${p}`);
            if (input) input.value = social[p] || '';
        });
    });
}

async function saveSocialLinks() {
    const btn = document.querySelector('.btn-save-settings');
    btn.innerText = "Saving...";
    
    const social = {
        facebook: document.getElementById('setting-facebook').value,
        instagram: document.getElementById('setting-instagram').value,
        tiktok: document.getElementById('setting-tiktok').value,
        whatsapp: document.getElementById('setting-whatsapp').value,
        twitter: document.getElementById('setting-twitter').value,
        youtube: document.getElementById('setting-youtube').value,
        updatedAt: Date.now()
    };

    try {
        await db.ref('settings/social').set(social);
        showToast("Social links updated successfully!");
    } catch (e) {
        showToast("Failed to save settings.", "error");
    } finally {
        btn.innerText = "Save Social Media Links";
    }
}

function calculateSubPrice() {
    const select = document.getElementById('subPlanSelect');
    const customWrapper = document.getElementById('customMonthWrapper');
    if (!select) return { total: 0, months: 0 };

    let months = parseInt(select.value);
    
    if (select.value === 'custom') {
        if (customWrapper) customWrapper.style.display = 'block';
        months = parseInt(document.getElementById('customMonths').value) || 0;
    } else {
        if (customWrapper) customWrapper.style.display = 'none';
    }

    // Dynamic calculation from Developer Config
    const rate = systemPricing.monthlyPrice || 0;
    const total = months * rate;

    const totalDisplay = document.getElementById('subTotalPrice');
    if (totalDisplay) totalDisplay.innerText = `₦${total.toLocaleString()}`;

    return { total, months };
}

async function initiatePaystackSubscriptionPayment() {
    const { total, months } = calculateSubPrice();
    if (months <= 0) return alert("Please select a valid duration.");

    const btn = document.getElementById('renewBtn');
    btn.disabled = true;
    btn.innerText = "Initializing Paystack...";

    // Generate a unique reference for Paystack
    const ref = 'AS-SUB-' + Date.now();

    // Log Pending Transaction to Firebase
    const transData = {
        customerName: "Auracious Sip Admin", // Or dynamically fetch admin name
        email: "admin@auracioussip.com",
        amount: total,
        months: months,
        status: 'Pending',
        reference: ref,
        createdAt: Date.now()
    };
    await db.ref(`transactions/${ref}`).set(transData);

    try {
        const handler = PaystackPop.setup({
            key: PAYSTACK_PUBLIC_KEY,
            email: 'admin@auracioussip.com',
            amount: total * 100, // Paystack expects amount in kobo
            currency: 'NGN',
            ref: ref,
            callback: function(response) {
                const btn = document.getElementById('renewBtn');
                btn.innerText = "Verifying...";
                fetchWithRetry(`${API_URL}/subscription`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ reference: response.reference, months: months, amount: total })
                })
                .then(() => location.reload())
                .catch(err => {
                    showToast("Verification failed: " + err.message, "error");
                    btn.disabled = false;
                    btn.innerText = "Retry Verification";
                });
            },
            onClose: () => {
                db.ref(`transactions/${ref}`).update({ status: 'Canceled' });
                showToast("Payment cancelled.", "info");
                btn.disabled = false;
                btn.innerText = "Renew Platform Access";
            }
        });
        handler.openIframe();
    } catch (err) {
        alert("Could not start payment: " + err.message);
        btn.disabled = false;
        btn.innerText = "Renew Platform Access";
    }
}

// Cloudinary Image Upload
async function handleImageUpload(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData
    });
    const data = await res.json();
    return data.secure_url;
}

document.getElementById('addProductForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.innerText = "Uploading...";
    btn.disabled = true;

    try {
        const file = document.getElementById('prodImage').files[0];
        const imageUrl = await handleImageUpload(file);

        const product = {
            name: document.getElementById('prodName').value,
            price: document.getElementById('prodPrice').value,
            category: document.getElementById('prodCat').value,
            unit: document.getElementById('prodUnit').value,
            image: imageUrl,
            createdAt: Date.now()
        };

        await db.ref('products').push(product);
        alert("Product Added!");
        e.target.reset();
    } catch (err) {
        alert("Upload failed.");
    } finally {
        btn.innerText = "Add Product";
        btn.disabled = false;
    }
});
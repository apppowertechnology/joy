// tinubu.js - Developer Master Control Logic
let masterSubData = null;

function verifyDev() {
    const word = document.getElementById('lockWord').value;
    if (word === "Developerpremiumlock") {
        document.getElementById('devAuth').style.display = 'none';
        document.getElementById('devPanel').style.display = 'block';
        initDevDashboard();
    } else {
        alert("UNAUTHORIZED ACCESS DETECTED.");
    }
}

function initDevDashboard() {
    // Load current pricing config
    db.ref('subscriptionPricing').once('value', snap => {
        let cfg = { monthlyPrice: 100, grace: 3 }; // Removed yearly as it's auto-calculated
        const data = snap.val();

        if (data !== null) {
            if (typeof data === 'object') {
                cfg = { ...cfg, ...data };
            } else {
                cfg.monthlyPrice = Number(data);
            }
        }

        document.getElementById('devMonthlyPrice').value = cfg.monthlyPrice;
        // Auto-fill yearly if missing based on 12-month calculationce
    });

    // Live Clock & Master Ticker
    setInterval(() => {
        document.getElementById('liveClock').innerText = new Date().toLocaleString();
        if (masterSubData) updateUI(masterSubData);
    }, 1000);

    // Sync Data
    db.ref('subscription').on('value', snapshot => {
        masterSubData = snapshot.val() || {};
        updateUI(masterSubData);
    });

    // Load Logs
    db.ref('devLogs').limitToLast(20).on('value', snapshot => {
        const logs = snapshot.val() || {};
        const logContainer = document.getElementById('devLogs');
        logContainer.innerHTML = Object.values(logs).reverse().map(l => `
            <div style="margin-bottom:5px;">
                <span style="color: #888;">[${new Date(l.time).toLocaleTimeString()}]</span> ${l.msg}
            </div>
        `).join('');
    });
}

function clearDevLogs() {
    if (confirm("Are you sure you want to permanently delete all developer logs?")) {
        db.ref('devLogs').remove().then(() => {
            logAction("Developer logs cleared by administrator.");
        }).catch(err => alert("Error clearing logs: " + err.message));
    }
}

function updateUI(sub) {
    const pill = document.getElementById('masterStatusPill');
    const isExpired = sub.expiresAt < Date.now();
    const isLocked = sub.systemLocked === true;

    if (isLocked || isExpired) {
        pill.innerText = isLocked ? "FORCED LOCK" : "EXPIRED";
        pill.className = "status-pill status-locked";
    } else {
        pill.innerText = "SYSTEM ACTIVE";
        pill.className = "status-pill status-active";
    }

    document.getElementById('expiryDisplay').innerText = new Date(sub.expiresAt).toLocaleString();
    
    // Countdown Logic
    const diff = sub.expiresAt - Date.now();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const countdownText = diff > 0 ? `${days}d ${hours}h ${mins}m ${secs}s remaining` : "EXPIRED";
    document.getElementById('countdownDisplay').innerText = countdownText;
}

async function savePricingConfig() {
    const monthlyVal = document.getElementById('devMonthlyPrice').value;
    const graceVal = document.getElementById('devGraceDays').value;

    const monthly = parseFloat(monthlyVal);
    const grace = parseInt(graceVal) || 0;

    if (isNaN(monthly) || monthly < 0) return alert("Please enter a valid monthly price (e.g. 100).");

    try {
        const res = await fetch('/api/subscription', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monthlyPrice: monthly, grace: grace })
        });
        const result = await res.json();
        if (result.success) {
            alert("Subscription price updated successfully.");
            logAction(`Price Updated: ₦${monthly.toLocaleString()} / Month`);
        }
    } catch (err) {
        alert("Failed to update pricing: " + err.message);
    }
}

function logAction(msg) {
    db.ref('devLogs').push({
        time: Date.now(),
        msg: msg
    });
}

function toggleSystemLock(state) {
    if (confirm(`Confirm MASTER ${state ? 'LOCK' : 'UNLOCK'} of AUDACIOUS SIP?`)) {
        db.ref('subscription').update({ systemLocked: state });
        logAction(`System Master Lock set to: ${state}`);
    }
}

function toggleAdminLock(state) {
    db.ref('subscription').update({ adminLocked: state });
    logAction(`Admin Control Lock set to: ${state}`);
}

function setManualExpiry() {
    const dateInput = document.getElementById('manualExpiry').value;
    if (!dateInput) return alert("Select a date.");
    
    const newTimestamp = new Date(dateInput).getTime();
    db.ref('subscription').update({ expiresAt: newTimestamp });
    logAction(`Manual expiry override to: ${dateInput}`);
}

function simulateSub(days) {
    db.ref('subscription').once('value', snapshot => {
        const sub = snapshot.val() || {};
        const current = Number(sub.expiresAt) || Date.now();
        
        let baseTime = current;
        // Logic: If adding time and current is expired, start from NOW.
        // If adding time and current is active, add to existing.
        if (days > 0 && current < Date.now()) {
            baseTime = Date.now();
        }
        
        const adjustment = Math.floor(days * 24 * 60 * 60 * 1000);
        const newExpiry = baseTime + adjustment;
        
        db.ref('subscription').update({ 
            expiresAt: newExpiry,
            updatedAt: Date.now()
        }).then(() => {
            logAction(`Subscription adjusted by ${days} days. New expiry: ${new Date(newExpiry).toLocaleString()}`);
        });
    });
}

function addMonths(months) {
    simulateSub(months * 30);
}

function reduceTimeHours() {
    const hoursInput = document.getElementById('reduceHoursAmount');
    const h = parseFloat(hoursInput?.value);
    
    if (isNaN(h) || h <= 0) return alert("Please enter a valid number of hours to subtract.");

    db.ref('subscription').once('value', snapshot => {
        const sub = snapshot.val() || {};
        const current = Number(sub.expiresAt) || Date.now();
        const adjustment = Math.floor(h * 60 * 60 * 1000);
        const newExpiry = current - adjustment;

        db.ref('subscription').update({
            expiresAt: newExpiry,
            updatedAt: Date.now()
        }).then(() => {
            logAction(`Subscription manually reduced by ${h} hours.`);
            if (hoursInput) hoursInput.value = '';
        });
    });
}

function forceExpire() {
    if (confirm("FORCE INSTANT SYSTEM EXPIRATION?")) {
        db.ref('subscription').update({ expiresAt: Date.now() - 1000 });
        logAction("FORCED INSTANT EXPIRATION TRIGGERED");
    }
}

// Listen for Paystack updates via server.js or client-side confirmed verify
function listenForPayments() {
    // The server.js endpoint /verify-subscription should handle the DB update,
    // and this dashboard will reflect it in real-time.
}

// Add a button to the dev panel to trigger a manual Paystack payment for testing
function testPaystackRenewal() {
    const testMonths = 1; // Default to 1 month for testing
    const testAmount = 100; // Default to ₦100 for testing
    const testRef = 'AS-DEV-TEST-' + Date.now();
    PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY, // Ensure this is available in tinubu.js context if needed
        email: 'test@auracioussip.com',
        amount: testAmount * 100,
        ref: testRef,
        callback: (response) => alert(`Test Payment Success! Ref: ${response.reference}`),
        onClose: () => alert("Test Payment Closed.")
    }).openIframe();
}
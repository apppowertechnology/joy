// verify_config.js - Dry run to test Base64 and JSON parsing
require('dotenv').config();

function verify() {
    console.log("--- AURACIOUS SIP CONFIG VERIFICATION ---");
    
    const b64Value = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!b64Value && !rawJson) {
        console.error("❌ ERROR: No Firebase credentials found in .env");
        return;
    }

    try {
        let serviceAccount;
        if (b64Value) {
            console.log("Testing FIREBASE_SERVICE_ACCOUNT_B64...");
            const decoded = Buffer.from(b64Value.trim(), 'base64').toString('utf8');
            serviceAccount = JSON.parse(decoded);
        } else {
            console.log("Testing FIREBASE_SERVICE_ACCOUNT (Raw JSON)...");
            serviceAccount = JSON.parse(rawJson);
        }

        if (serviceAccount.private_key) {
            const originalKey = serviceAccount.private_key;
            const fixedKey = originalKey.replace(/\\n/g, '\n').trim();
            
            console.log("✅ JSON Structure: VALID");
            console.log("✅ Project ID:", serviceAccount.project_id);
            console.log("✅ Private Key Formatting: " + (fixedKey.includes('\n') ? "CORRECT (Newlines detected)" : "WARNING (No newlines)"));
            
            if (!fixedKey.startsWith("-----BEGIN PRIVATE KEY-----")) {
                console.error("❌ ERROR: Private key does not start with valid PEM header.");
            }
        }
    } catch (e) {
        console.error("❌ FAILED: " + e.message);
    }
}

verify();
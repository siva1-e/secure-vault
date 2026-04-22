// background/background.js
console.log("✅ Full Background script loaded");

let pendingCredential = null;
let registrationDraft = { username: "", email: "", recoveryQuestion: "" };
let registration = { registered: false, user_id: null };
let settings = { cloudSave: false };
let session = { token: null, user_id: null };
let deviceSecret = null;

const CPU_BASE_URL = "http://127.0.0.1:8080";
const SHARED_SECRET = "VeryStrongSharedSecret123"; 

// 🔒 Internal Static Key (Obfuscated hex) - Used for metadata encryption
const _INTERNAL_METADATA_KEY_HEX = "4a6f6e617468616e20416973656e6265726720536563726574204b657920313233"; 

/* --- 1️⃣ Registration Crypto Helpers --- */
async function sha256(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

function generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16))
        .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
}

async function hashPassword(password, salt) {
    return sha256(password + salt);
}

/* --- 2️⃣ Vault & Metadata Encryption Helpers --- */
function bytesToB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

// background/background.js - Add this helper
// background/background.js

async function decryptMetadata(iv_b64, data_b64) {
    const key = await getInternalMetadataKey();
    const iv = b64ToBytes(iv_b64);
    const ct = b64ToBytes(data_b64);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
}
function b64ToBytes(b64) {
    const s = atob(String(b64 || ""));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

// Metadata Encryption Logic (For Time, Username, Email)
async function getInternalMetadataKey() {
    const keyBuffer = new TextEncoder().encode(_INTERNAL_METADATA_KEY_HEX);
    const keyHash = await crypto.subtle.digest("SHA-256", keyBuffer);
    return crypto.subtle.importKey("raw", keyHash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptMetadata(plaintext) {
    const key = await getInternalMetadataKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(String(plaintext)));
    return { iv_b64: bytesToB64(iv), data_b64: bytesToB64(new Uint8Array(ct)) };
}

async function deriveDynamicKey(salt_b64, hour, counter, username) {
    // 1. Check if the user has actually logged in (unlocked the vault)
    if (!session.master_password) {
        throw new Error("VAULT_LOCKED_PLEASE_LOGIN");
    }

    const encoder = new TextEncoder();
    const salt = b64ToBytes(salt_b64);
    
    // 🚀 FIX: Use the Master Password from the session instead of SHARED_SECRET
    const keyMaterialData = encoder.encode(`${session.master_password}${username}${hour}${counter}`);
    
    const baseKey = await crypto.subtle.importKey(
        "raw", 
        keyMaterialData, 
        "PBKDF2", 
        false, 
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 200000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

/* --- background/background.js --- */

async function encryptForVault(plaintext, username, hour, counter) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = new TextEncoder().encode(String(plaintext));

    // 🚀 FIX: Convert salt to Base64 BEFORE passing it to deriveDynamicKey
    const salt_b64 = bytesToB64(salt);
    const key = await deriveDynamicKey(salt_b64, hour, counter, username);

    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
    
    return { 
        salt_b64: salt_b64,
        iv_b64: bytesToB64(iv), 
        ct_b64: bytesToB64(new Uint8Array(ct)),
        expiry: Date.now() + 60000,
        attempts_left: 2
    };
}

/* --- 3️⃣ Networking --- */
async function cpuRequest(path, method, body, token) {
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        const res = await fetch(`${CPU_BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP_${res.status}`);
        return data;
    } catch (err) { console.error("[CPU_ERR]", err.message); throw err; }
}

/* --- 4️⃣ Message Listener --- */
browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "POPUP_GET_STATE") {
        return { ok: true, pending: pendingCredential, registrationDraft, registration, settings, session: { loggedIn: !!session.token, user_id: session.user_id } };
    }

    if (msg.type === "PENDING_CREDENTIAL") {
        pendingCredential = { site: msg.site, username: msg.username, password: msg.password, timestamp: Date.now() };
        await browser.storage.local.set({ pm_pending_capture: pendingCredential });
        return { ok: true }; 
    }

    // background/background.js - Place this inside the message listener

if (msg.type === "POPUP_DECRYPT_RECOVERY_ITEM") {
    try {
        // Use the existing decryptMetadata function to turn the packet back into text
        const plainText = await decryptMetadata(msg.packet.iv_b64, msg.packet.data_b64);
        return { ok: true, plainText };
    } catch (e) {
        console.error("[DECRYPT_RECOVERY_ERR]", e);
        return { ok: false, error: "DECRYPTION_FAILED" };
    }
}

    if (msg.type === "POPUP_DISCARD_PENDING") {
        pendingCredential = null;
        await browser.storage.local.remove("pm_pending_capture");
        return { ok: true };
    }
// background/background.js

/* --- background/background.js --- */

if (msg.type === "POPUP_DECRYPT_VAULT_ITEM") {
    try {
        // 🔐 Critical Check: Ensure the vault is actually unlocked in this session
        if (!session.master_password) {
            return { ok: false, error: "MASTER_PASSWORD_MISSING" };
        }

        // Derive the unique AES key using the password from the active session
        const key = await deriveDynamicKey(
            msg.packet.salt_b64, 
            msg.packet.db_hour, 
            msg.packet.counter, 
            msg.username
        );

        const iv = b64ToBytes(msg.packet.iv_b64);
        const ct = b64ToBytes(msg.packet.data_b64);

        const pt = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ct
        );

        return { ok: true, plainText: new TextDecoder().decode(pt) };
    } catch (e) {
        console.error("❌ Decryption failed:", e);
        return { ok: false, error: "DECRYPTION_FAILED" };
    }
}
// 3. REGISTER (Fixed for Email and Verification)
// background/background.js
// background/background.js
if (msg.type === "POPUP_REGISTER") {
    try {
        const password_salt = generateSalt();
        const password_hash = await hashPassword(msg.masterPassword, password_salt);
        
        const emailBlindIndex = await sha256(msg.email.toLowerCase().trim());

        // Encrypt identifying metadata
        const encUsername = await encryptMetadata(msg.username);
        const encEmail = await encryptMetadata(msg.email);
        const encQuestion = await encryptMetadata(msg.recoveryQuestion);

        // 🔐 FIX: Generate a UNIQUE salt for the recovery answer instead of using "salt"
        const recovery_answer_salt = generateSalt();
        const recovery_answer_hash = await hashPassword(msg.recoveryAnswer, recovery_answer_salt);

        const resp = await cpuRequest("/v1/auth/register", "POST", {
            plain_email: msg.email, 
            email_blind_index: emailBlindIndex,
            username: JSON.stringify(encUsername),
            email: JSON.stringify(encEmail),
            recovery_question: JSON.stringify(encQuestion),
            password_salt,
            password_hash,
            recovery_answer_salt, // 🔐 Send the real salt to the server
            recovery_answer_hash
        });

        if (resp && resp.ok) {
            deviceSecret = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
            
            await browser.storage.local.set({ 
                pm_registered: true, 
                pm_device_secret: deviceSecret,
                pm_user_id: resp.user_id 
            });

            registration.registered = true;
            registration.user_id = resp.user_id;

            return { ok: true, user_id: resp.user_id };
        } else {
            return { ok: false, error: resp.error || "Unknown Error" };
        }
    } catch (err) { 
        console.error("[REG_ERR]", err);
        return { ok: false, error: err.message }; 
    }
}

// background/background.js - Add these listeners

// Step 1: Start Recovery (Get the Question)
// background/background.js

if (msg.type === "POPUP_RECOVERY_START") {
    try {
        // 1. Request the encrypted question from the server
        const resp = await cpuRequest("/v1/recovery/start", "POST", { identifier: msg.identifier });
        
        // cpuRequest throws on !res.ok, so if we are here, we have the data
        
        // 2. Parse the recovery_question string into a JSON object
        const questionObj = JSON.parse(resp.recovery_question);
        
        // 3. Decrypt the metadata using our internal key
        const plainQuestion = await decryptMetadata(questionObj.iv_b64, questionObj.data_b64);

        // 4. Return the plain text question and salt to the popup
        return { 
            ok: true, 
            question: plainQuestion, 
            salt: resp.recovery_answer_salt 
        };
    } catch (err) { 
        console.error("[RECOVERY_START_ERR]", err.message);
        return { ok: false, error: err.message }; 
    }
}
// Step 2: Verify Answer & Reset Password
// Inside browser.runtime.onMessage.addListener in background.js

if (msg.type === "POPUP_RECOVERY_START") {
    try {
        // Find user and get encrypted question
        const resp = await cpuRequest("/v1/recovery/start", "POST", { identifier: msg.identifier });
        
        // Decrypt the question using the hidden internal key
        const qPacket = JSON.parse(resp.recovery_question);
        const decryptedQuestion = await decryptMetadata(qPacket.iv_b64, qPacket.data_b64);
        
        return { ok: true, question: decryptedQuestion, salt: resp.recovery_answer_salt };
    } catch (e) { return { ok: false, error: e.message }; }
}

// background/background.js

/* --- background/background.js --- */

/* --- background/background.js --- */
// background/background.js

// background/background.js

// background/background.js

if (msg.type === "POPUP_RECOVERY_VERIFY_AND_REVEAL") {
    try {
        const answerHash = await hashPassword(msg.recoveryAnswer, msg.recovery_answer_salt);
        
        const verifyResp = await cpuRequest("/v1/recovery/verify", "POST", {
            identifier: msg.identifier,
            recovery_answer_hash: answerHash
        });

        if (!verifyResp.ok) throw new Error("Incorrect safety answer");

        const vaultResp = await cpuRequest("/v1/vault/list_recovery", "POST", {
            identifier: msg.identifier,
            reset_token: verifyResp.reset_token
        });

        // 🚀 Map ALL fields required for deriveDynamicKey
        const items = Array.isArray(vaultResp.items) ? vaultResp.items.map(item => ({
            site_name: item.url_origin,
            username_packet: item.username_packet, 
            password_packet: {               
                iv_b64: item.iv_b64,
                data_b64: item.ct_b64,
                salt_b64: item.salt_b64, // Required for PBKDF2
                db_hour: item.db_hour,   // Required for key derivation
                counter: item.counter    // Required for key derivation
            }
        })) : [];

        // Return items and the current lock status
        return { 
            ok: true, 
            items, 
            isUnlocked: !!session.master_password // Tell UI if master password is in RAM
        };
    } catch (e) {
        console.error("❌ [RECOVERY_ERR]", e.message);
        return { ok: false, error: e.message };
    }
}

// background/background.js - Inside the message listener

if (msg.type === "POPUP_RECOVERY_VERIFY_ANSWER") {
    try {
        // 1. Hash the user's provided answer using the salt from Step 1
        const answerHash = await hashPassword(msg.recoveryAnswer, msg.recovery_answer_salt);

        // 2. Ask server to verify the hash
        const verifyResp = await cpuRequest("/v1/recovery/verify", "POST", {
            identifier: msg.identifier,
            recovery_answer_hash: answerHash
        });

        if (verifyResp.ok) {
            // Return the reset_token to the popup to unlock the final UI
            return { ok: true, reset_token: verifyResp.reset_token };
        } else {
            throw new Error(verifyResp.error || "Incorrect answer");
        }
    } catch (e) {
        return { ok: false, error: e.message };
    }
}


/* --- background/background.js --- */

if (msg.type === "POPUP_RECOVERY_COMPLETE") {
    try {
        // 1. Re-verify the safety answer to ensure the session is still valid
        const answerHash = await hashPassword(msg.recoveryAnswer, msg.recovery_answer_salt);

        // 2. Request a reset token from the server
        const verifyResp = await cpuRequest("/v1/recovery/verify", "POST", {
            identifier: msg.identifier,
            recovery_answer_hash: answerHash
        });

        if (!verifyResp.ok) throw new Error("Verification failed during reset.");

        // 3. Generate a new salt and hash for the new Master Password
        const newSalt = generateSalt();
        const newHash = await hashPassword(msg.newMasterPassword, newSalt);

        // 4. Send the new credentials to the server using the reset token
        const resetResp = await cpuRequest("/v1/recovery/reset", "POST", {
            reset_token: verifyResp.reset_token,
            new_password_hash: newHash,
            new_password_salt: newSalt
        });

        return resetResp;
    } catch (e) { 
        console.error("❌ [RESET_ERR]", e.message);
        return { ok: false, error: e.message }; 
    }
}

if (msg.type === "POPUP_LOGIN") {
    try {
        if (!deviceSecret) {
            const stored = await browser.storage.local.get("pm_device_secret");
            deviceSecret = stored.pm_device_secret || null;
        }

        // 1. Fetch the unique password salt for this user
        const saltResp = await cpuRequest("/v1/auth/salt", "POST", { identifier: msg.identifier });
        if (!saltResp.ok) throw new Error(saltResp.error || "User not found");

        // 2. Hash the password with the retrieved salt
        const password_hash = await hashPassword(msg.masterPassword, saltResp.password_salt);

        // 3. Perform the actual login request
        const loginResp = await cpuRequest("/v1/auth/login", "POST", { 
            identifier: msg.identifier, 
            password_hash 
        });
        
        if (!loginResp.ok) throw new Error(loginResp.error);

        // 🚀 FIX: Save the master password to the session memory so encryption can use it
        session.token = loginResp.token;
        session.user_id = loginResp.user_id;
        session.master_password = msg.masterPassword; 
        
        // 4. Update login timestamp with encrypted metadata
        const loginTimeEnc = await encryptMetadata(new Date().toISOString());
        await cpuRequest("/v1/auth/update_login_time", "POST", { 
            login_timestamp: JSON.stringify(loginTimeEnc) 
        }, session.token);

        // 5. Persist session to local storage
        await browser.storage.local.set({ 
            pm_session: { token: session.token, user_id: session.user_id } 
        });

        return { ok: true, user_id: session.user_id };
    } catch (err) { 
        console.error("[LOGIN_ERR]", err.message);
        return { ok: false, error: err.message }; 
    }
}
if (msg.type === "POPUP_SAVE_PENDING") {

    if (!session.token || !session.master_password) {
        return { ok: false, error: "Please log in/unlock your vault before saving." };
    }

    // Ensure the session is active before attempting to save
    if (!session.token || !session.user_id) {
        const stored = await browser.storage.local.get("pm_session");
        if (stored.pm_session) {
            session.token = stored.pm_session.token;
            session.user_id = stored.pm_session.user_id;
        } else { return { ok: false, error: "VAULT_LOCKED_PLEASE_LOGIN" }; }
    }
    
    if (!pendingCredential) return { ok: false, error: "NO_PENDING_DATA" };

    try {
        const now = new Date();
        const currentHour = now.getHours();
        const timestampStr = now.toISOString();
        const storage = await browser.storage.local.get("pm_save_counter");
        let counter = storage.pm_save_counter || 1;

        // Encrypt the credentials locally using dynamic keys
        const packet = await encryptForVault(pendingCredential.password, pendingCredential.username, currentHour, counter);
        const encTime = await encryptMetadata(timestampStr);
        const encUser = await encryptMetadata(pendingCredential.username);

        // 🚀 SAVE TO MONGODB: Send the data to the server's vault/save endpoint
        const resp = await cpuRequest("/v1/vault/save", "POST", {
            url_origin: pendingCredential.site, 
            username_packet: encUser, 
            created_at_packet: encTime,
            ...packet, // contains salt_b64, iv_b64, ct_b64
            db_hour: currentHour,
            counter: counter
        }, session.token);

        if (resp && resp.ok) {
            await browser.storage.local.set({ pm_save_counter: counter + 1 });
            pendingCredential = null; 
            await browser.storage.local.remove("pm_pending_capture");
            return { ok: true };
        } else {
            throw new Error(resp.error || "Failed to save to MongoDB");
        }
    } catch (err) { 
        return { ok: false, error: err.message }; 
    }
}
});

browser.storage.local.get("pm_pending_capture").then(res => {
    if (res.pm_pending_capture) pendingCredential = res.pm_pending_capture;
});
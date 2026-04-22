// popup/popup.js
console.log("✅ Full Popup script loaded");

let maskedTimeout = null;
let registrationUnlockedLogin = false;
let draftTimer = null;
let recoveryCtx = { identifier: "", email: "", recovery_answer_salt: "", recovery_question: "" };

/* --- 1️⃣ UI TOGGLE & INITIALIZATION --- */
function initAuthToggle() {
    const toggleBtn = document.getElementById('toggleAuthBtn');
    const regSection = document.getElementById('registerSection');
    const loginSection = document.getElementById('loginSection');
    const authTitle = document.getElementById('authSectionTitle');

    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        const isRegVisible = regSection.style.display !== 'none';
        if (isRegVisible) {
            regSection.style.display = 'none';
            loginSection.style.display = 'block';
            authTitle.innerText = 'UNLOCK (THIS DEVICE)';
            toggleBtn.innerText = 'Need an account? Register';
        } else {
            regSection.style.display = 'block';
            loginSection.style.display = 'none';
            authTitle.innerText = 'REGISTRATION (REQUIRED)';
            toggleBtn.innerText = 'Already registered? Login';
        }
    });
}

/* --- 2️⃣ AUTH & SESSION RENDERING --- */
function setLoginUnlocked(unlocked) {
    registrationUnlockedLogin = Boolean(unlocked);
    const loginSection = document.getElementById("loginSection");
    const regSection = document.getElementById("registerSection");
    const toggleBtn = document.getElementById('toggleAuthBtn');
    const authTitle = document.getElementById('authSectionTitle');

    // If already registered, default the UI to the Login view
    if (registrationUnlockedLogin && regSection && loginSection) {
        regSection.style.display = 'none';
        loginSection.style.display = 'block';
        if (toggleBtn) toggleBtn.innerText = 'Need an account? Register';
        if (authTitle) authTitle.innerText = 'UNLOCK (THIS DEVICE)';
    }
}

function renderAuth(session) {
    const authStatus = document.getElementById("authStatus");
    const yesBtn = document.getElementById("yesBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const authWrapper = document.getElementById("authWrapper");

    if (session && session.loggedIn) {
        authStatus.innerHTML = `<div class="row success">✔ Logged in as ${session.user_id}</div>`;
        if (yesBtn) yesBtn.disabled = false;
        if (authWrapper) authWrapper.style.display = "none"; 
        if (logoutBtn) logoutBtn.style.display = "block";
    } else {
        authStatus.innerHTML = `<div class="row pending">● Not logged in</div>`;
        if (yesBtn) yesBtn.disabled = true;
        if (authWrapper) authWrapper.style.display = "block";
        if (logoutBtn) logoutBtn.style.display = "none";
    }
}

/* --- 3️⃣ PENDING CREDENTIALS & VAULT --- */
function renderPending(pending) {
    const status = document.getElementById("status");
    if (!pending) {
        status.innerHTML = `<div class="row pending">● State: IDLE</div>`;
        return;
    }

    status.innerHTML = `
        <div class="row pending">● State: PENDING</div>
        <div class="row">Site: <b>${pending.site}</b></div>
        <div class="row">Username: <b>${pending.username}</b></div>
        <div class="row">Password: <span id="pwd">••••••••</span></div>
    `;

    clearTimeout(maskedTimeout);
    maskedTimeout = setTimeout(() => {
        const pwdSpan = document.getElementById("pwd");
        if (pwdSpan) {
            pwdSpan.textContent = "••••••••";
            pwdSpan.classList.add("mask");
        }
    }, 5000); 
}

/* --- 3️⃣ PENDING CREDENTIALS & VAULT --- */

// REMOVE the old refresh function and PASTE the new one here:
async function refresh() {
    try {
        const state = await browser.runtime.sendMessage({ type: "POPUP_GET_STATE" });
        if (state && state.ok) {
            renderPending(state.pending);
            renderAuth(state.session);
            renderDetails(state);
            applySettings(state.settings);
            applyRegistrationDraft(state.registrationDraft);
            
            const isRegistered = state.registration && state.registration.registered;
            const isLoggedIn = state.session && state.session.loggedIn;

            const authWrapper = document.getElementById("authWrapper");
            
            if (isLoggedIn) {
                // 🚀 If logged in, ensure the entire Login/Register area is hidden
                if (authWrapper) authWrapper.style.display = "none";
                
                refreshVault();
                refreshHashVault();
                refreshCloudVault();
            } else {
                // 🚀 If NOT logged in, show the wrapper and decide between Login or Register
                if (authWrapper) authWrapper.style.display = "block";
                setLoginUnlocked(isRegistered);
            }
        }
    } catch (err) {
        console.error("[POPUP_REFRESH]", err);
    }
}

/* --- 4️⃣ REGISTRATION HELPERS --- */
function initRegistrationSection() {
    document.getElementById("registerBtn").addEventListener("click", async () => {
        const username = document.getElementById("regUsername").value.trim();
        const email = document.getElementById("regEmail").value.trim();
        const email2 = document.getElementById("regEmail2").value.trim();
        const masterPassword = document.getElementById("regMasterPassword").value;
        const masterPassword2 = document.getElementById("regMasterPassword2").value;
        const recoveryQuestion = document.getElementById("recoveryQuestion").value.trim();
        const recoveryAnswer = document.getElementById("recoveryAnswer").value;

        if (!email || email !== email2) { alert("EMAIL_MISMATCH"); return; }
        if (!masterPassword || masterPassword !== masterPassword2) { alert("PASSWORD_MISMATCH"); return; }

        const resp = await browser.runtime.sendMessage({
            type: "POPUP_REGISTER",
            username, email, masterPassword, recoveryQuestion, recoveryAnswer
        });

        const registerStatus = document.getElementById("registerStatus");
        if (resp && resp.ok) {
            registerStatus.innerHTML = `<div class="row success">✔ Registered: ${resp.user_id}</div>`;
            setLoginUnlocked(true);
            refresh();
        } else {
            registerStatus.innerHTML = `<div class="row pending">● ${resp?.error || "REGISTER_FAILED"}</div>`;
        }
    });
}

function initRegistrationDraftSync() {
    const fields = ["regUsername", "regEmail", "recoveryQuestion"];
    fields.forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => {
            clearTimeout(draftTimer);
            draftTimer = setTimeout(async () => {
                await browser.runtime.sendMessage({
                    type: "POPUP_UPDATE_REGISTER_DRAFT",
                    username: document.getElementById("regUsername").value,
                    email: document.getElementById("regEmail").value,
                    recoveryQuestion: document.getElementById("recoveryQuestion").value
                });
            }, 500);
        });
    });
}

function applyRegistrationDraft(draft) {
    if (!draft) return;
    if (document.getElementById("regUsername")) document.getElementById("regUsername").value = draft.username || "";
    if (document.getElementById("regEmail")) document.getElementById("regEmail").value = draft.email || "";
    if (document.getElementById("recoveryQuestion")) document.getElementById("recoveryQuestion").value = draft.recoveryQuestion || "";
}

/* --- 5️⃣ VAULT & RECOVERY HELPERS --- */
async function refreshVault() {
    const list = document.getElementById("vaultList");
    const resp = await browser.runtime.sendMessage({ type: "POPUP_GET_VAULT_LIST" });
    if (resp?.ok) {
        list.innerHTML = resp.items.map(it => `
            <div class="vault-item">
                <div class="row">Site: <b>${it.url_origin}</b></div>
                <div class="row">User: <b>${it.username}</b></div>
                <button class="vault-show-btn" data-idx="${it.idx}">SHOW PASSWORD</button>
                <div id="vaultPwd_${it.idx}" style="display:none; font-family:monospace; margin-top:5px;"></div>
            </div>
        `).join("");
    }
}

function initVaultRevealHandlers() {
    document.getElementById("vaultList").addEventListener("click", async (e) => {
        if (e.target.classList.contains("vault-show-btn")) {
            const idx = e.target.getAttribute("data-idx");
            const pwdEl = document.getElementById(`vaultPwd_${idx}`);
            const resp = await browser.runtime.sendMessage({ type: "POPUP_DECRYPT_VAULT_ENTRY", idx: parseInt(idx) });
            if (resp?.ok) {
                pwdEl.textContent = `Password: ${resp.password}`;
                pwdEl.style.display = "block";
                e.target.style.display = "none";
            }
        }
    });
}

/* --- 6️⃣ CORE BUTTON HANDLERS --- */
// popup/popup.js - Find the initLoginSection function
function initLoginSection() {
    const loginBtn = document.getElementById("loginBtn");
    const identifierInput = document.getElementById("identifier");
    const masterPassInput = document.getElementById("masterPassword");

    if (!loginBtn) return;

    loginBtn.addEventListener("click", async () => {
        const identifier = identifierInput.value.trim();
        const masterPassword = masterPassInput.value;

        if (!identifier || !masterPassword) {
            alert("Please enter both your identifier and master password.");
            return;
        }

        // Send login request to background
        const resp = await browser.runtime.sendMessage({
            type: "POPUP_LOGIN",
            identifier,
            masterPassword
        });

        // Clear the password field for security
        masterPassInput.value = "";

        if (resp && resp.ok) {
            console.log("Unlock successful!");
            await refresh(); // Refresh UI to show "Unlocked: YES"
        } else {
            alert(resp && resp.error ? resp.error : "Unlock failed. Please check your credentials.");
        }
    });

    // Add listener for the LOCK button
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
        await browser.runtime.sendMessage({ type: "POPUP_LOGOUT" });
        await refresh();
    });
}

function initConfirmSection() {
    document.getElementById("yesBtn").addEventListener("click", async () => {
        const cloudSync = document.getElementById("cloudSaveToggle").checked;
        const resp = await browser.runtime.sendMessage({ type: "POPUP_SAVE_PENDING", cloudSync });
        if (resp?.ok) { alert("Saved!"); refresh(); } else { alert(resp?.error || "SAVE_FAILED"); }
    });

    document.getElementById("noBtn").addEventListener("click", async () => {
        await browser.runtime.sendMessage({ type: "POPUP_DISCARD_PENDING" });
        refresh();
    });
}

function renderDetails(state) {
    const el = document.getElementById("detailStatus");
    if (!el) return;
    const reg = state.registration?.registered ? "YES" : "NO";
    const log = state.session?.loggedIn ? "YES" : "NO";
    el.innerHTML = `<div class="row">Registered: <b>${reg}</b> | Unlocked: <b>${log}</b></div>`;
}

function applySettings(s) { if (document.getElementById("cloudSaveToggle")) document.getElementById("cloudSaveToggle").checked = !!s?.cloudSave; }

function initMessageListeners() {
    browser.runtime.onMessage.addListener((msg) => {
        if (msg.type === "PENDING_UPDATED" || msg.type === "AUTH_STATE_CHANGED") refresh();
    });
}

/* --- 7️⃣ RECOVERY (Restored) --- */
/* --- 7️⃣ RECOVERY (Fixed) --- */
/* --- 7️⃣ RECOVERY (Updated for Reveal Logic) --- */
/* --- popup/popup.js --- */
function initRecoverySection() {
    const startBtn = document.getElementById("recoveryStartBtn");
    const verifyBtn = document.getElementById("recoveryVerifyBtn");
    const recoveryStep1 = document.getElementById("recoveryStep1"); 
    const recoveryStep2 = document.getElementById("recoveryStep2");
    const revealArea = document.getElementById("revealedPasswordsArea");

    startBtn?.addEventListener("click", async () => {
        const identifier = document.getElementById("recoveryIdentifier").value.trim();
        const email = document.getElementById("recoveryEmail").value.trim();
        if (!identifier || !email) { alert("Please provide both identifier and email."); return; }

        const resp = await browser.runtime.sendMessage({ 
            type: "POPUP_RECOVERY_START", identifier, email 
        });

        if (resp?.ok) {
            recoveryCtx = { identifier, email, recovery_answer_salt: resp.salt };
            if (recoveryStep1) recoveryStep1.style.display = "none";
            if (recoveryStep2) recoveryStep2.style.display = "block";
            document.getElementById("recoveryQuestionDisplay").innerHTML = `<b>Safety Question:</b> <br>${resp.question}`;
        } else {
            alert("Recovery failed: " + (resp?.error || "User not found"));
        }
    });

// popup/popup.js

// popup/popup.js

/* --- popup.js --- */

/* --- popup.js --- */

/* --- popup.js --- */

/* --- popup.js --- */

/* --- popup.js --- */

verifyBtn?.addEventListener("click", async () => {
    const answer = document.getElementById("recoveryAnswerInput").value;
    const resp = await browser.runtime.sendMessage({
        type: "POPUP_RECOVERY_VERIFY_AND_REVEAL",
        identifier: recoveryCtx.identifier,
        recoveryAnswer: answer,
        recovery_answer_salt: recoveryCtx.recovery_answer_salt
    });

    if (resp.ok) {
        if (recoveryStep2) recoveryStep2.style.display = "none";
        if (revealArea) {
            revealArea.style.display = "block";
            
            const isUnlocked = resp.isUnlocked; 
            revealArea.innerHTML = `
                <h3 style="color: #667eea; text-align: center;">RECOVERED ACCOUNTS:</h3>
                <div style="text-align:center; font-size:11px; margin-bottom:15px; color:${isUnlocked ? '#00ff00' : '#ff4444'};">
                    STATUS: ${isUnlocked ? 'VAULT UNLOCKED' : 'VAULT LOCKED (Passwords hidden)'}
                </div>
            `;

            if (!resp.items || resp.items.length === 0) {
                revealArea.innerHTML += "<p style='text-align:center;'>No items found in vault.</p>";
            } else {
                for (const item of resp.items) {
                    const userDec = await browser.runtime.sendMessage({ 
                        type: "POPUP_DECRYPT_RECOVERY_ITEM", 
                        packet: item.username_packet 
                    });

                    const div = document.createElement("div");
                    div.className = "vault-item-revealed";
                    div.style = "background: #222; padding: 12px; margin-top: 10px; border-left: 4px solid #667eea; border-radius: 4px; text-align:left;";
                    
                    div.innerHTML = `
                        <div style="color: #667eea; font-size: 10px; font-weight: bold; text-transform: uppercase;">Site:</div>
                        <div style="color: #fff; font-weight: bold; margin-bottom: 5px;">${item.site_name}</div>
                        <div style="color: #aaa; font-size: 10px; text-transform: uppercase;">Username:</div>
                        <div style="color: #fff; margin-bottom: 8px;">${userDec.plainText || "Unknown"}</div>
                        <button class="reveal-pwd-btn" style="background:#444; color:#fff; border:none; padding:5px 10px; cursor:pointer; font-size:10px; border-radius:3px;">
                            SHOW PASSWORD
                        </button>
                        <div class="pwd-display" style="display:none; color:#00ff00; font-family:monospace; margin-top:8px; border-top:1px solid #333; padding-top:5px;"></div>
                    `;

                    div.querySelector(".reveal-pwd-btn").addEventListener("click", async (e) => {
                        const pwdDec = await browser.runtime.sendMessage({
                            type: "POPUP_DECRYPT_VAULT_ITEM",
                            packet: item.password_packet,
                            username: userDec.plainText 
                        });
                        
                        const display = div.querySelector(".pwd-display");
                        if (pwdDec && pwdDec.ok) {
                            display.textContent = `Password: ${pwdDec.plainText}`;
                            display.style.color = "#00ff00"; 
                        } else {
                            display.textContent = "Error: Unlock vault in Login tab first.";
                            display.style.color = "#ff4444"; 
                        }
                        display.style.display = "block";
                        e.target.style.display = "none";
                    });

                    revealArea.appendChild(div);
                }
            }
        }

        // 🚀 SHOW THE RESET FORM (Step 3)
        const recoveryStep3 = document.getElementById("recoveryStep3");
        if (recoveryStep3) {
            recoveryStep3.style.display = "block";
        }
        
        alert("Identity verified! Your saved sites are listed. You can also reset your Master Password below.");
    } else {
        alert("Verification failed: " + resp.error);
    }
});

document.getElementById("finalResetBtn")?.addEventListener("click", async () => {
        const newPass = document.getElementById("newMasterPassword").value;
        const confirmPass = document.getElementById("confirmNewMasterPassword").value;
        const safetyAnswer = document.getElementById("recoveryAnswerInput").value;

        if (!newPass || newPass !== confirmPass) {
            alert("New passwords do not match!");
            return;
        }

        if (newPass.length < 8) {
            alert("Password should be at least 8 characters.");
            return;
        }

        const resp = await browser.runtime.sendMessage({
            type: "POPUP_RECOVERY_COMPLETE",
            identifier: recoveryCtx.identifier,
            recoveryAnswer: safetyAnswer,
            recovery_answer_salt: recoveryCtx.recovery_answer_salt,
            newMasterPassword: newPass
        });

        if (resp.ok) {
            alert("Master Password reset successfully! Redirecting to login...");
            location.reload(); 
        } else {
            alert("Reset failed: " + resp.error);
        }
    });
/* --- popup.js --- */

resetBtn?.addEventListener("click", async () => {
    const newPass = document.getElementById("newMasterPasswordInput").value;
    const confirmPass = document.getElementById("confirmNewPasswordInput").value;

    if (newPass !== confirmPass) {
        alert("Passwords do not match!");
        return;
    }

    const resp = await browser.runtime.sendMessage({
        type: "POPUP_RECOVERY_COMPLETE",
        reset_token: recoveryCtx.reset_token, // Obtained from earlier verification
        newMasterPassword: newPass
    });

    if (resp.ok) {
        alert("Master Password Reset Successfully! You can now login.");
        location.reload(); // Return to login screen
    } else {
        alert("Reset failed: " + resp.error);
    }
});
}

/* --- MAIN ENTRY --- */
document.addEventListener("DOMContentLoaded", () => {
    initAuthToggle();
    initConfirmSection();
    initLoginSection();
    initRegistrationSection();
    initRegistrationDraftSync();
    initVaultRevealHandlers();
    initRecoverySection();
    initMessageListeners();
    document.getElementById("vaultRefreshBtn")?.addEventListener("click", refreshVault);
    refresh();
});
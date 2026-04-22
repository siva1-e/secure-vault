// content/content-improved.js
console.log("✅ Enhanced Content script loaded");

let lastCaptureTime = 0;
const CAPTURE_COOLDOWN = 5000; 

/* --- 1️⃣ Field Detection Logic --- */
function isProbablyUsernameInput(el) {
    if (!el || !(el instanceof HTMLInputElement)) return false;
    const t = (el.type || "").toLowerCase();
    if (t === "password") return false;
    const hay = `${el.id} ${el.name} ${el.autocomplete} ${el.placeholder} ${el.className}`.toLowerCase();
    return t === "email" || /user|username|email|login|identifier|account|id/.test(hay);
}

function findUsernameNear(root) {
    const inputs = Array.from(root.querySelectorAll("input"));
    const candidates = inputs.filter(isProbablyUsernameInput);
    return candidates[0] || inputs.find(i => i.type === "email") || inputs.find(i => i.type === "text") || null;
}

function findPasswordNear(root) {
    return root.querySelector("input[type='password']");
}

/* --- 2️⃣ Auto-Fill Logic --- */
async function autoFill() {
    try {
        const state = await browser.runtime.sendMessage({ type: "POPUP_GET_STATE" });
        if (state && state.ok && state.session && state.session.loggedIn) {
            const vaultResp = await browser.runtime.sendMessage({ type: "POPUP_GET_VAULT_LIST" });
            if (vaultResp && vaultResp.ok && vaultResp.items) {
                const entry = vaultResp.items.find(it => it.url_origin === location.origin);
                if (entry) {
                    const resp = await browser.runtime.sendMessage({ 
                        type: "POPUP_DECRYPT_VAULT_ENTRY", 
                        idx: entry.idx 
                    });
                    if (resp && resp.ok) {
                        const userField = findUsernameNear(document);
                        const passField = findPasswordNear(document);
                        if (userField && passField) {
                            userField.value = entry.username;
                            passField.value = resp.password;
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[PM] Auto-fill failed:", err.message);
    }
}

/* --- 3️⃣ Save Notification UI --- */
function showSaveNotification(site, username, password, resumeAction) {
    if (document.getElementById('pm-save-notification')) return;

    const notification = document.createElement('div');
    notification.id = 'pm-save-notification';
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white; padding: 18px; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3); z-index: 2147483647;
        font-family: sans-serif; width: 300px;
    `;

    notification.innerHTML = `
        <div style="font-weight:bold; margin-bottom:10px; font-size:16px;">🔐 Save Password?</div>
        <div style="margin-bottom:15px; font-size:14px; opacity:0.9;">Save credentials for <b>${username}</b>?</div>
        <div style="display:flex; gap:10px;">
            <button id="pm-save-confirm" style="background:white; color:#764ba2; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:bold;">Save</button>
            <button id="pm-save-ignore" style="background:rgba(255,255,255,0.2); color:white; border:none; padding:8px 15px; border-radius:6px; cursor:pointer;">Not now</button>
        </div>
    `;

    document.body.appendChild(notification);

    // CONFIRM SAVE
    document.getElementById('pm-save-confirm').onclick = async () => {
        try {
            await browser.runtime.sendMessage({
                type: "PENDING_CREDENTIAL",
                site: site,
                username: username,
                password: password
            });

            notification.innerHTML = `<div style="font-weight:bold;">✔ Saved to Extension!</div>
                                      <div style="font-size:12px; margin-top:5px;">Redirecting...</div>`;
            
            setTimeout(() => {
                notification.remove();
                if (resumeAction) resumeAction(); 
            }, 1500);
        } catch (err) {
            console.error("[PM] Staging error:", err);
            notification.remove();
            if (resumeAction) resumeAction();
        }
    };

    // IGNORE / DISCARD
    document.getElementById('pm-save-ignore').onclick = () => {
        notification.remove();
        if (resumeAction) resumeAction(); 
    };
}

/* --- 4️⃣ Intercept Logic (Fixed for Practice Sites) --- */
async function captureAndHold(e) {
    const now = Date.now();
    if (now - lastCaptureTime < CAPTURE_COOLDOWN) return;

    const form = e.target.closest("form");
    const root = form || document;
    const userField = findUsernameNear(root);
    const passField = findPasswordNear(root);

    if (userField?.value && passField?.value) {
        lastCaptureTime = now;
        
        // PAUSE the page navigation
        e.preventDefault();
        e.stopPropagation();

        const username = userField.value.trim();
        const password = passField.value;

        const resume = () => {
            if (form) {
                // Manually trigger the original form submission
                HTMLFormElement.prototype.submit.call(form);
            } else {
                // If it wasn't a form, just reload or try to resume the click
                window.location.reload();
            }
        };

        showSaveNotification(location.origin, username, password, resume);
    }
}

// 1. Listen for standard form submissions
document.addEventListener("submit", captureAndHold, true);

// 2. Listen for clicks on "Login/Submit" buttons (Catch for sites like PracticeTestAutomation)
document.addEventListener("click", (e) => {
    const btn = e.target.closest("button, input[type='submit']");
    if (btn) {
        // If the button is inside a form, let the 'submit' listener handle it.
        // If not, we trigger capture manually here.
        if (!btn.form) {
             captureAndHold(e);
        }
    }
}, true);

// Initialize auto-fill
if (document.readyState === "complete" || document.readyState === "interactive") {
    autoFill();
} else {
    window.addEventListener("DOMContentLoaded", autoFill);
}
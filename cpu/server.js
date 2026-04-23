const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { MongoClient } = require("mongodb");
const nodemailer = require("nodemailer");
// ===============================
// Phase-1 First Internal Demo Mode
// ===============================
const DEMO_MODE = process.env.DEMO_MODE !== "false";   // Set DEMO_MODE=false in env for real DB

const PORT = Number(process.env.PORT || 8080);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "password_manager";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

// Static file serving config
const WEBSITE_DIR = path.join(__dirname, "..", "website");
const MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".zip": "application/zip",
    ".xpi": "application/x-xpinstall",
};

// Setup Mailer
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;

const mailer = SMTP_HOST && EMAIL_FROM ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
}) : null;

async function sendEmail(to, subject, text) {
    if (!mailer) throw new Error("EMAIL_NOT_CONFIGURED");
    await mailer.sendMail({ from: EMAIL_FROM, to, subject, text });
}

if (!DEMO_MODE && !MONGODB_URI) throw new Error("Missing MONGODB_URI env var");

// --- Sanitizers for Encrypted Metadata ---
function sanitizeMetadata(s) {
    if (typeof s !== "string") return "";
    const v = s.trim();
    if (v.startsWith('{"iv_b64"')) return v; 
    return v.toLowerCase().slice(0, 1024);
}

function sanitizeUserField(s) {
    if (typeof s !== "string") return "";
    if (s.startsWith('{"iv_b64"')) return s;
    return s.trim().slice(0, 1024);
}

function json(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    console.log(`[RES] ${statusCode} sent.`);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*", 
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end(body);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => { data += chunk; });
        req.on("end", () => {
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("Invalid JSON")); }
        });
        req.on("error", reject);
    });
}

function sha256Hex(input) {
    return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function randomHex(bytes) {
    return crypto.randomBytes(bytes).toString("hex");
}

// --- Static File Server ---
function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end("<h1>404 — Not Found</h1>");
            return;
        }
        res.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": data.length,
            "Cache-Control": "public, max-age=3600",
        });
        res.end(data);
    });
}

async function main() {
    let client = null;
    let db, users, sessions, vault, recovery;

    console.log("Running REAL PROJECT – Phase-1 (Demo DB Mode)");

    if (!DEMO_MODE) {
        // REAL DATABASE CONNECTION (Phase-2 / Production)
        client = new MongoClient(MONGODB_URI);
        console.log("[DB] Connecting to MongoDB...");
        await client.connect();
        console.log("[DB] Connected successfully.");

        db = client.db(DB_NAME);
        users = db.collection("users");
        sessions = db.collection("sessions");
        vault = db.collection("vault_entries");
        recovery = db.collection("recovery");
    } else {
        // DEMO MODE (Phase-1 Internal)
        console.log("[DB] MongoDB integrated (Demo mode – Phase-1)");

        // In-memory mock collections
        users = {
            findOne: async () => null,
            insertOne: async () => ({ acknowledged: true }),
            updateOne: async () => ({ acknowledged: true })
        };

        sessions = {
            findOne: async () => null,
            insertOne: async () => ({ acknowledged: true }),
            deleteOne: async () => ({ acknowledged: true })
        };

        vault = {
            find: () => ({ toArray: async () => [] }),
            insertOne: async () => ({ acknowledged: true })
        };

        recovery = {
            findOne: async () => null,
            updateOne: async () => ({ acknowledged: true }),
            deleteOne: async () => ({ acknowledged: true })
        };
    }

    async function resolveSession(req) {
        if (DEMO_MODE) return null;

        const auth = req.headers.authorization;
        if (!auth) return null;
        const m = /^Bearer\s+(.+)$/i.exec(auth);
        if (!m) return null;
        const token_hash = sha256Hex(m[1].trim());
        const sess = await sessions.findOne({ token_hash });
        if (!sess) return null;
        if (sess.expires_at && new Date(sess.expires_at).getTime() <= Date.now()) {
            await sessions.deleteOne({ token_hash });
            return null;
        }
        return sess;
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        console.log(`[REQ] ${req.method} ${url.pathname}`);

        try {
            // --- CORS Preflight ---
            if (req.method === "OPTIONS") {
                res.writeHead(204, {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization"
                });
                res.end();
                return;
            }

            // --- Health Check ---
            if (url.pathname === "/health") {
                return json(res, 200, {
                    ok: true,
                    status: "alive",
                    phase: "Phase-1",
                    mode: DEMO_MODE ? "Demo DB Mode" : "Live DB"
                });
            }

            // --- 1. EMAIL VERIFICATION ---
            if (req.method === "GET" && url.pathname === "/v1/email/verify") {
                const token = url.searchParams.get("token");
                if (!token) return json(res, 400, { ok: false, error: "MISSING_TOKEN" });
                const token_hash = sha256Hex(token);
                const user = await users.findOne({ 
                    email_verification_token_hash: token_hash,
                    email_verification_expires_at: { $gt: new Date() } 
                });
                if (!user) return res.end("<h1>Invalid Link</h1>");
                await users.updateOne({ user_id: user.user_id }, { 
                    $set: { email_verified: true, email_verified_at: new Date() },
                    $unset: { email_verification_token_hash: "", email_verification_expires_at: "" }
                });
                return res.end("<h1>Verified!</h1>");
            }

            // --- 2. REGISTER ---
            if (req.method === "POST" && url.pathname === "/v1/auth/register") {
                const body = await readJson(req);
                const verify_token = randomHex(32);
                const doc = {
                    user_id: `uid_${randomHex(16)}`,
                    username: body.username,
                    email: body.email,
                    email_blind_index: body.email_blind_index,
                    email_verified: false,
                    email_verification_token_hash: sha256Hex(verify_token),
                    email_verification_expires_at: new Date(Date.now() + 86400000),
                    password_salt: body.password_salt,
                    password_hash: body.password_hash,
                    recovery_question: body.recovery_question,
                    recovery_answer_salt: body.recovery_answer_salt,
                    recovery_answer_hash: body.recovery_answer_hash,
                    login_timestamp: null,
                    created_at: new Date()
                };
                await users.insertOne(doc);
                if (body.plain_email) {
                    const link = `${PUBLIC_BASE_URL}/v1/email/verify?token=${verify_token}`;
                    sendEmail(body.plain_email, "Verify", `Link: ${link}`).catch(() => console.log(`[DEV] Link: ${link}`));
                }
                return json(res, 201, { ok: true, user_id: doc.user_id });
            }

            // --- 3. RECOVERY START ---
            if (req.method === "POST" && url.pathname === "/v1/recovery/start") {
                const body = await readJson(req);
                const idHash = sha256Hex(body.identifier.toLowerCase().trim());
                const user = await users.findOne({ 
                    $or: [{ username: body.identifier }, { email_blind_index: idHash }] 
                });
                if (!user) return json(res, 404, { ok: false, error: "NOT_FOUND" });
                return json(res, 200, { ok: true, recovery_question: user.recovery_question, recovery_answer_salt: user.recovery_answer_salt });
            }

            // --- 4. RECOVERY VERIFY ---
            if (req.method === "POST" && url.pathname === "/v1/recovery/verify") {
                const body = await readJson(req);
                const idHash = sha256Hex(body.identifier.toLowerCase().trim());
                const user = await users.findOne({ 
                    $or: [{ username: body.identifier }, { email_blind_index: idHash }] 
                });
                if (!user || user.recovery_answer_hash !== body.recovery_answer_hash) {
                    return json(res, 401, { ok: false, error: "INVALID_ANSWER" });
                }
                const reset_token = randomHex(32);
                await recovery.updateOne(
                    { identifier: body.identifier }, 
                    { $set: { reset_token_hash: sha256Hex(reset_token), created_at: new Date() } }, 
                    { upsert: true }
                );
                return json(res, 200, { ok: true, reset_token });
            }

            // --- 5. RECOVERY RESET ---
            if (req.method === "POST" && url.pathname === "/v1/recovery/reset") {
                const body = await readJson(req);
                const rec = await recovery.findOne({ reset_token_hash: sha256Hex(body.reset_token) });
                if (!rec || (new Date() - rec.created_at) > 3600000) return json(res, 401, { ok: false, error: "EXPIRED" });
                const idHash = sha256Hex(rec.identifier.toLowerCase().trim());
                await users.updateOne({ $or: [{ username: rec.identifier }, { email_blind_index: idHash }] }, { 
                    $set: { password_hash: body.new_password_hash, password_salt: body.new_password_salt } 
                });
                await recovery.deleteOne({ _id: rec._id });
                return json(res, 200, { ok: true });
            }

            // --- 6. GET SALT ---
            if (req.method === "POST" && url.pathname === "/v1/auth/salt") {
                const body = await readJson(req);
                const identifier = body.identifier;
                const idHash = sha256Hex(identifier.toLowerCase().trim());
                const user = await users.findOne({ 
                    $or: [{ username: identifier }, { email_blind_index: idHash }] 
                });
                if (!user) return json(res, 404, { ok: false, error: "USER_NOT_FOUND" });
                return json(res, 200, { ok: true, password_salt: user.password_salt });
            }

            // --- 7. LOGIN ---
            if (req.method === "POST" && url.pathname === "/v1/auth/login") {
                const body = await readJson(req);
                const idHash = sha256Hex(body.identifier.toLowerCase().trim());
                const user = await users.findOne({ $or: [{ username: body.identifier }, { email_blind_index: idHash }] });
                if (!user || user.password_hash !== body.password_hash) return json(res, 401, { ok: false, error: "INVALID" });
                if (user.email && !user.email_verified) return json(res, 403, { ok: false, error: "EMAIL_NOT_VERIFIED" });
                const token = randomHex(32);
                await sessions.insertOne({ token_hash: sha256Hex(token), user_id: user.user_id, created_at: new Date(), expires_at: new Date(Date.now() + 21600000) });
                return json(res, 200, { ok: true, token, user_id: user.user_id });
            }

            // --- 8. UPDATE LOGIN TIME ---
            if (req.method === "POST" && url.pathname === "/v1/auth/update_login_time") {
                const sess = await resolveSession(req);
                if (!sess) return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
                const body = await readJson(req);
                await users.updateOne({ user_id: sess.user_id }, { $set: { login_timestamp: body.login_timestamp } });
                return json(res, 200, { ok: true });
            }

            // --- 9. VAULT SAVE ---
            if (req.method === "POST" && url.pathname === "/v1/vault/save") {
                const sess = await resolveSession(req);
                if (!sess) return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
                const body = await readJson(req);
                const entry = {
                    user_id: sess.user_id,
                    url_origin: body.url_origin,
                    username_packet: body.username_packet,
                    salt_b64: body.salt_b64,
                    iv_b64: body.iv_b64,
                    ct_b64: body.ct_b64,
                    db_hour: body.db_hour,
                    counter: body.counter,
                    created_at: new Date()
                };
                await vault.insertOne(entry);
                return json(res, 201, { ok: true });
            }

            // --- 10. VAULT LIST RECOVERY ---
            if (req.method === "POST" && url.pathname === "/v1/vault/list_recovery") {
                const body = await readJson(req);
                const tokenHash = sha256Hex(body.reset_token);
                const rec = await recovery.findOne({ reset_token_hash: tokenHash });
                if (!rec) return json(res, 401, { ok: false, error: "UNAUTHORIZED_RECOVERY" });
                const idHash = sha256Hex(rec.identifier.toLowerCase().trim());
                const user = await users.findOne({ 
                    $or: [{ username: rec.identifier }, { email_blind_index: idHash }] 
                });
                const items = await vault.find({ user_id: user.user_id }).toArray();
                return json(res, 200, { ok: true, items });
            }

            // --- STATIC FILE SERVING (Website) ---
            if (req.method === "GET") {
                let filePath = url.pathname;
                
                // Default to index.html
                if (filePath === "/" || filePath === "") {
                    filePath = "/index.html";
                }

                // Security: prevent directory traversal
                const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
                const fullPath = path.join(WEBSITE_DIR, safePath);

                // Ensure the resolved path is within the website directory
                if (!fullPath.startsWith(WEBSITE_DIR)) {
                    return json(res, 403, { ok: false, error: "FORBIDDEN" });
                }

                // Check if file exists
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                    return serveStaticFile(res, fullPath);
                }
            }

            // Default 404
            json(res, 404, { ok: false, error: "NOT_FOUND" });
        } catch (err) {
            console.error(err);
            json(res, 500, { ok: false, error: "ERROR" });
        }
    });

    server.listen(PORT, "0.0.0.0", () => {
        console.log(`\n🚀 SecureVault Server Ready!`);
        console.log(`   API:     http://127.0.0.1:${PORT}/health`);
        console.log(`   Website: http://127.0.0.1:${PORT}/`);
        console.log(`   SSO:     http://127.0.0.1:${PORT}/sso.html\n`);
    });
}

main();
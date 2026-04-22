async function sha256(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt) {
  return sha256(String(password) + String(salt));
}

async function api(baseUrl, path, method, body, token) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data && data.error ? data.error : `HTTP_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg || "";
}

function setCode(code) {
  const el = document.getElementById("code");
  if (el) el.textContent = code || "—";
}

function normalizeBaseUrl(s) {
  const v = String(s || "").trim().replace(/\/+$/, "");
  return v;
}

async function onLogin() {
  setStatus("Logging in...");
  setCode("—");

  const cpuBaseUrl = normalizeBaseUrl(document.getElementById("cpuBaseUrl").value);
  const identifier = String(document.getElementById("identifier").value || "").trim();
  const masterPassword = String(document.getElementById("masterPassword").value || "");

  if (!cpuBaseUrl) {
    setStatus("CPU_BASE_URL_REQUIRED");
    return;
  }
  if (!identifier || !masterPassword) {
    setStatus("IDENTIFIER_AND_PASSWORD_REQUIRED");
    return;
  }

  try {
    const saltResp = await api(cpuBaseUrl, "/v1/auth/salt", "POST", { identifier });
    const password_hash = await hashPassword(masterPassword, saltResp.password_salt);
    const loginResp = await api(cpuBaseUrl, "/v1/auth/login", "POST", { identifier, password_hash });
    const token = loginResp.token;

    const sso = await api(cpuBaseUrl, "/v1/sso/issue", "POST", null, token);
    if (sso && sso.code) {
      setCode(sso.code);
      setStatus("SSO code issued.");
    } else {
      setCode("—");
      setStatus("SSO code sent to your email inbox.");
    }
  } catch (e) {
    setStatus(e && e.message ? e.message : "LOGIN_FAILED");
  } finally {
    document.getElementById("masterPassword").value = "";
  }
}

document.getElementById("loginBtn").addEventListener("click", onLogin);

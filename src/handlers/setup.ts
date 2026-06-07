// /setup — first-time token onboarding.
//
// GET: Bounced here from /authorize/callback when resolveUser decided the user
// doesn't yet have a stored LunchMoney token. Reads the resume token from
// `?rt=`, sets a short-lived session cookie, renders an HTML form for the user
// to paste their LunchMoney API token.
//
// POST: Validates the session cookie + CSRF token, validates the submitted
// LunchMoney token against the LunchMoney API, stores it in KV, then resumes
// the OAuth flow via the resume token recovered from the form.

import {
    verifyResumeToken,
    resumeAuthorization,
    type AppEnv,
} from "@bm1549/remote-mcp-cloudflare";
import { putUserToken } from "../storage.js";
import { validateLunchMoneyToken } from "../validate.js";
import { signSession, verifySession, signCsrf, verifyCsrf } from "../crypto.js";

interface ResumePayload {
    oauthReqInfo: unknown;
    sub: string;
    email: string;
}

// Cloudflare injects KV bindings into the env at runtime; the package's AppEnv
// type doesn't know about them. Cast at the consumer boundary.
interface SetupEnv extends AppEnv {
    USER_TOKENS: KVNamespace;
}

const SESSION_COOKIE = "lm_session";
const SESSION_MAX_AGE = 15 * 60;

export function cspWithNonce(nonce: string): string {
    return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none';`;
}

function newNonce(): string {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    let s = "";
    for (const b of buf) s += b.toString(16).padStart(2, "0");
    return s;
}

export function htmlEscape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
        switch (c) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return c;
        }
    });
}

function htmlHeaders(nonce: string): HeadersInit {
    return {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": cspWithNonce(nonce),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
    };
}

export function readCookie(request: Request, name: string): string | null {
    const header = request.headers.get("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
        const [k, ...rest] = part.trim().split("=");
        if (k === name) return rest.join("=");
    }
    return null;
}

function sessionCookie(value: string, maxAge: number): string {
    // SameSite=Lax (not Strict): /setup is reached via a 302 chain originating
    // at accounts.google.com, and some browsers refuse to send Strict cookies
    // on POSTs from a navigation with cross-site lineage. Lax still blocks
    // CSRF (POSTs from third-party origins) while allowing the same-origin
    // form submission to carry the cookie. CSRF is also defense-in-depth'd
    // by the HMAC-signed `csrf` field bound to `sub`.
    return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function renderForm(opts: {
    email: string;
    csrfToken: string;
    rt: string;
    nonce: string;
    error?: string;
}): string {
    const errorBlock = opts.error
        ? `<div class="error" role="alert">${htmlEscape(opts.error)}</div>`
        : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Connect LunchMoney</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 520px; margin: 3em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.4em; }
  p { line-height: 1.5; }
  label { display: block; font-weight: 600; margin-top: 1em; }
  input[type=password] { width: 100%; padding: 0.6em; font-size: 1em; box-sizing: border-box; }
  button { margin-top: 1.2em; padding: 0.7em 1.4em; font-size: 1em; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5em; }
  button[disabled] { cursor: progress; opacity: 0.75; }
  .meta { color: #666; font-size: 0.9em; }
  .error { background: #fee; border: 1px solid #c00; color: #900; padding: 0.7em 1em; border-radius: 4px; margin-top: 1em; }
  .hint { color: #666; font-size: 0.85em; margin-top: 0.6em; }
  a { color: #06c; }
  .spinner { width: 0.9em; height: 0.9em; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; display: none; animation: spin 0.7s linear infinite; }
  button[disabled] .spinner { display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<h1>Connect LunchMoney</h1>
<p>To finish setting up the LunchMoney connector for Claude, paste your LunchMoney API token below. It's stored encrypted-at-rest in Cloudflare KV and only used to call LunchMoney on your behalf.</p>
<p class="meta">Signed in as <strong>${htmlEscape(opts.email)}</strong>. Get a token at <a href="https://my.lunchmoney.app/developers">my.lunchmoney.app/developers</a>.</p>
${errorBlock}
<form method="POST" action="/setup" id="setup-form">
  <label for="token">LunchMoney API token</label>
  <input id="token" name="token" type="password" autocomplete="off" required minlength="20" spellcheck="false">
  <input type="hidden" name="csrf" value="${htmlEscape(opts.csrfToken)}">
  <input type="hidden" name="rt" value="${htmlEscape(opts.rt)}">
  <button type="submit" id="submit-btn">
    <span class="spinner" aria-hidden="true"></span>
    <span class="label">Save and continue</span>
  </button>
  <p class="hint">Validation hits the LunchMoney API and can take a few seconds.</p>
</form>
<script nonce="${htmlEscape(opts.nonce)}">
  (function () {
    var form = document.getElementById('setup-form');
    var btn = document.getElementById('submit-btn');
    var label = btn.querySelector('.label');
    form.addEventListener('submit', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      label.textContent = 'Validating…';
    });
  })();
</script>
</body>
</html>`;
}

async function handleGet(
    request: Request,
    env: SetupEnv,
): Promise<Response> {
    const url = new URL(request.url);
    const rt = url.searchParams.get("rt");
    if (!rt) {
        return new Response("Missing rt", { status: 400 });
    }
    const payload = await verifyResumeToken<ResumePayload>(env, rt);
    if (!payload || !payload.sub || !payload.email) {
        return new Response("Setup link expired. Re-launch from Claude.", {
            status: 400,
        });
    }
    const session = await signSession(env.STATE_SECRET, {
        sub: payload.sub,
        email: payload.email,
    });
    const csrfToken = await signCsrf(env.STATE_SECRET, payload.sub);
    const nonce = newNonce();
    const body = renderForm({
        email: payload.email,
        csrfToken,
        rt,
        nonce,
    });
    const headers = new Headers(htmlHeaders(nonce));
    headers.append("set-cookie", sessionCookie(session, SESSION_MAX_AGE));
    return new Response(body, { status: 200, headers });
}

async function handlePost(
    request: Request,
    env: SetupEnv,
): Promise<Response> {
    const cookie = readCookie(request, SESSION_COOKIE);
    if (!cookie) {
        return new Response("Missing session. Re-launch from Claude.", {
            status: 400,
        });
    }
    const session = await verifySession(env.STATE_SECRET, cookie);
    if (!session) {
        return new Response("Session expired. Re-launch from Claude.", {
            status: 400,
        });
    }

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return new Response("Invalid form body", { status: 400 });
    }
    const csrf = form.get("csrf");
    const token = form.get("token");
    const rt = form.get("rt");
    if (
        typeof csrf !== "string" ||
        typeof token !== "string" ||
        typeof rt !== "string"
    ) {
        return new Response("Malformed form", { status: 400 });
    }
    const csrfOk = await verifyCsrf(env.STATE_SECRET, csrf, session.sub);
    if (!csrfOk) {
        return new Response("CSRF check failed", { status: 400 });
    }

    const trimmed = token.trim();
    if (!trimmed) {
        const csrfToken = await signCsrf(env.STATE_SECRET, session.sub);
        const nonce = newNonce();
        return new Response(
            renderForm({
                email: session.email,
                csrfToken,
                rt,
                nonce,
                error: "Token cannot be empty.",
            }),
            { status: 200, headers: htmlHeaders(nonce) },
        );
    }

    const result = await validateLunchMoneyToken(trimmed);
    if (!result.ok) {
        const csrfToken = await signCsrf(env.STATE_SECRET, session.sub);
        const nonce = newNonce();
        return new Response(
            renderForm({
                email: session.email,
                csrfToken,
                rt,
                nonce,
                error: result.message,
            }),
            { status: 200, headers: htmlHeaders(nonce) },
        );
    }

    const payload = await verifyResumeToken<ResumePayload>(env, rt);
    if (!payload || payload.sub !== session.sub) {
        return new Response("Setup link expired. Re-launch from Claude.", {
            status: 400,
        });
    }

    const now = new Date().toISOString();
    await putUserToken(env.USER_TOKENS, session.sub, {
        token: trimmed,
        email: session.email,
        createdAt: now,
        lastValidatedAt: now,
    });

    const { redirectTo } = await resumeAuthorization(
        env,
        payload.oauthReqInfo,
        session.sub,
        { sub: session.sub, email: session.email },
    );

    if (!redirectTo) {
        return new Response(
            `Internal: empty redirectTo from completeAuthorization`,
            { status: 500 },
        );
    }

    // Render an interstitial HTML page that does a client-side redirect.
    //
    // We can't use a 302 here: some mobile WebViews (notably Claude's iOS
    // in-app browser) don't follow POST-response redirects to whitelisted
    // OAuth callback URLs. Returning HTML with a JS redirect + meta refresh
    // fallback + visible link works universally — the WebView gets a GET
    // navigation event, which is what its URL-pattern interceptor expects.
    const nonce = newNonce();
    const safe = htmlEscape(redirectTo);
    const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Connecting…</title>
<meta http-equiv="refresh" content="0; url=${safe}">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 420px; margin: 4em auto; padding: 0 1em; text-align: center; color: #222; }
  a { color: #06c; word-break: break-all; }
</style>
</head>
<body>
<p>Token saved. Returning you to Claude…</p>
<p>If you aren't redirected automatically, <a href="${safe}">tap here</a>.</p>
<script nonce="${htmlEscape(nonce)}">
  window.location.replace(${JSON.stringify(redirectTo)});
</script>
</body>
</html>`;
    return new Response(body, { status: 200, headers: htmlHeaders(nonce) });
}

export async function setupHandler(
    request: Request,
    env: AppEnv,
    _ctx: ExecutionContext,
): Promise<Response> {
    const setupEnv = env as SetupEnv;
    if (request.method === "GET") {
        return handleGet(request, setupEnv);
    }
    if (request.method === "POST") {
        return handlePost(request, setupEnv);
    }
    return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, POST" },
    });
}

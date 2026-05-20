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

const CSP =
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none';";

function htmlEscape(s: string): string {
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

function htmlHeaders(): HeadersInit {
    return {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
    };
}

function readCookie(request: Request, name: string): string | null {
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
  button { margin-top: 1.2em; padding: 0.7em 1.4em; font-size: 1em; cursor: pointer; }
  .meta { color: #666; font-size: 0.9em; }
  .error { background: #fee; border: 1px solid #c00; color: #900; padding: 0.7em 1em; border-radius: 4px; margin-top: 1em; }
  a { color: #06c; }
</style>
</head>
<body>
<h1>Connect LunchMoney</h1>
<p>To finish setting up the LunchMoney connector for Claude, paste your LunchMoney API token below. It's stored encrypted-at-rest in Cloudflare KV and only used to call LunchMoney on your behalf.</p>
<p class="meta">Signed in as <strong>${htmlEscape(opts.email)}</strong>. Get a token at <a href="https://my.lunchmoney.app/developers">my.lunchmoney.app/developers</a>.</p>
${errorBlock}
<form method="POST" action="/setup">
  <label for="token">LunchMoney API token</label>
  <input id="token" name="token" type="password" autocomplete="off" required>
  <input type="hidden" name="csrf" value="${htmlEscape(opts.csrfToken)}">
  <input type="hidden" name="rt" value="${htmlEscape(opts.rt)}">
  <button type="submit">Save and continue</button>
</form>
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
    const body = renderForm({
        email: payload.email,
        csrfToken,
        rt,
    });
    const headers = new Headers(htmlHeaders());
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
        return new Response(
            renderForm({
                email: session.email,
                csrfToken,
                rt,
                error: "Token cannot be empty.",
            }),
            { status: 200, headers: htmlHeaders() },
        );
    }

    const result = await validateLunchMoneyToken(trimmed);
    if (!result.ok) {
        const csrfToken = await signCsrf(env.STATE_SECRET, session.sub);
        return new Response(
            renderForm({
                email: session.email,
                csrfToken,
                rt,
                error: result.message,
            }),
            { status: 200, headers: htmlHeaders() },
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

    // Don't clear the session cookie. Let it expire naturally (15 min).
    // Clearing it makes any user-initiated retry (back button, double-click
    // after a slow response) fail with "Missing session" because the second
    // POST arrives with no cookie. putUserToken is idempotent, so a duplicate
    // submit just re-runs harmlessly.
    return new Response(null, { status: 302, headers: { location: redirectTo } });
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

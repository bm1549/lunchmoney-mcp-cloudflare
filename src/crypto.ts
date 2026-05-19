// Session-cookie + CSRF helpers built on the package's signHmac/verifyHmac.
//
// Session cookie: short-lived (15 min) HMAC of `{ sub, email }`, ties a browser
// to a Google identity for the /setup flow.
//
// CSRF token: HMAC of `{ sub }`, bound to the user so it cannot be reused
// across users. TTL 1 hour so the setup form has plenty of time to be filled
// in but doesn't outlive the session by much.

import { signHmac, verifyHmac } from "@bm1549/remote-mcp-cloudflare";

const SESSION_TTL_SECONDS = 15 * 60;
const CSRF_TTL_SECONDS = 60 * 60;

interface SessionPayload {
    sub: string;
    email: string;
}

interface CsrfPayload {
    sub: string;
    /** Distinguishes CSRF tokens from session tokens that happen to share a sub. */
    kind: "csrf";
}

export async function signSession(
    secret: string,
    payload: SessionPayload,
): Promise<string> {
    return signHmac(secret, { ...payload, kind: "session" }, SESSION_TTL_SECONDS);
}

export async function verifySession(
    secret: string,
    token: string,
): Promise<SessionPayload | null> {
    const payload = await verifyHmac<SessionPayload & { kind?: string }>(
        secret,
        token,
    );
    if (!payload || payload.kind !== "session") return null;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
        return null;
    }
    return { sub: payload.sub, email: payload.email };
}

export async function signCsrf(secret: string, sub: string): Promise<string> {
    const payload: CsrfPayload = { sub, kind: "csrf" };
    return signHmac(secret, payload, CSRF_TTL_SECONDS);
}

export async function verifyCsrf(
    secret: string,
    token: string,
    sub: string,
): Promise<boolean> {
    const payload = await verifyHmac<CsrfPayload>(secret, token);
    if (!payload || payload.kind !== "csrf") return false;
    return payload.sub === sub;
}

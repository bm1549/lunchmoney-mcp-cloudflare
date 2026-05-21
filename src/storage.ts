// Per-user LunchMoney API token store, keyed by Google `sub`.
//
// NOTE: tokens are stored as plain JSON. We deliberately do NOT add an
// app-layer encryption envelope and instead rely on Cloudflare KV's at-rest
// encryption. A second layer of encryption inside the worker would only
// protect against an attacker who already has read access to KV but not to
// the worker's secrets — a thin threat model that doesn't justify the
// operational complexity.

export interface StoredUserToken {
    /** The user's LunchMoney API token. Never logged, never put in URLs. */
    token: string;
    /** The user's Google email. Stored for display + audit only. */
    email: string;
    /** ISO timestamp of first successful validation. */
    createdAt: string;
    /** ISO timestamp of the most recent successful validation. */
    lastValidatedAt: string;
}

function keyFor(sub: string): string {
    return `user:${sub}`;
}

export async function getUserToken(
    kv: KVNamespace,
    sub: string,
): Promise<StoredUserToken | null> {
    const raw = await kv.get(keyFor(sub));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as StoredUserToken;
        if (
            typeof parsed.token !== "string" ||
            typeof parsed.email !== "string"
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export async function putUserToken(
    kv: KVNamespace,
    sub: string,
    value: StoredUserToken,
): Promise<void> {
    await kv.put(keyFor(sub), JSON.stringify(value));
}

export async function deleteUserToken(
    kv: KVNamespace,
    sub: string,
): Promise<void> {
    await kv.delete(keyFor(sub));
}

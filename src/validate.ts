// LunchMoney API token validation.
//
// The token is sent only via the Authorization header. We never put it in a
// URL, query string, error response, or log line.

export type ValidateResult =
    | { ok: true }
    | { ok: false; status: number; message: string };

export async function validateLunchMoneyToken(
    token: string,
): Promise<ValidateResult> {
    let resp: Response;
    try {
        resp = await fetch("https://api.lunchmoney.dev/v1/me", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch (err) {
        return {
            ok: false,
            status: 0,
            message: `Network error contacting LunchMoney: ${
                err instanceof Error ? err.message : "unknown"
            }`,
        };
    }
    if (resp.ok) return { ok: true };
    let message: string;
    if (resp.status === 401 || resp.status === 403) {
        message = "LunchMoney rejected the token (unauthorized).";
    } else if (resp.status === 429) {
        message = "LunchMoney rate-limited the validation request; try again.";
    } else if (resp.status >= 500) {
        message = `LunchMoney returned ${resp.status}; try again later.`;
    } else {
        message = `LunchMoney returned ${resp.status}.`;
    }
    return { ok: false, status: resp.status, message };
}

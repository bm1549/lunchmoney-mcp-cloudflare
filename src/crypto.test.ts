import { describe, it, expect } from "vitest";
import { signSession, verifySession, signCsrf, verifyCsrf } from "./crypto.js";

const SECRET = "test-secret-must-be-at-least-32-chars-long";

describe("signSession / verifySession", () => {
    it("round-trips a valid session payload", async () => {
        const token = await signSession(SECRET, { sub: "sub-1", email: "a@b.com" });
        expect(await verifySession(SECRET, token)).toEqual({ sub: "sub-1", email: "a@b.com" });
    });

    it("rejects a CSRF token when verifying as session", async () => {
        const csrf = await signCsrf(SECRET, "sub-1");
        expect(await verifySession(SECRET, csrf)).toBeNull();
    });

    it("rejects a garbage string", async () => {
        expect(await verifySession(SECRET, "not-a-token")).toBeNull();
    });
});

describe("signCsrf / verifyCsrf", () => {
    it("round-trips a valid CSRF token for the correct sub", async () => {
        const token = await signCsrf(SECRET, "sub-1");
        expect(await verifyCsrf(SECRET, token, "sub-1")).toBe(true);
    });

    it("rejects a CSRF token for the wrong sub", async () => {
        const token = await signCsrf(SECRET, "sub-1");
        expect(await verifyCsrf(SECRET, token, "sub-2")).toBe(false);
    });

    it("rejects a session token when verifying as CSRF", async () => {
        const session = await signSession(SECRET, { sub: "sub-1", email: "a@b.com" });
        expect(await verifyCsrf(SECRET, session, "sub-1")).toBe(false);
    });
});

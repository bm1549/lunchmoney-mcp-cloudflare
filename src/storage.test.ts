import { describe, it, expect, afterEach } from "vitest";
import { env as _env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { getUserToken, putUserToken, deleteUserToken } from "./storage.js";
import type { StoredUserToken } from "./storage.js";

// worker-configuration.d.ts is not included in tsconfig (it conflicts with
// the package's BaseEnv.MCP_OBJECT type). Cast to retrieve the KV binding.
const env = _env as unknown as { USER_TOKENS: KVNamespace };

afterEach(async () => { await reset(); });

const SAMPLE: StoredUserToken = {
    token: "lm-test-token",
    email: "user@example.com",
    createdAt: "2026-06-06T00:00:00.000Z",
    lastValidatedAt: "2026-06-06T00:00:00.000Z",
};

describe("getUserToken", () => {
    it("returns null for a missing key", async () => {
        expect(await getUserToken(env.USER_TOKENS, "nobody")).toBeNull();
    });

    it("returns the stored value after putUserToken", async () => {
        await putUserToken(env.USER_TOKENS, "sub-123", SAMPLE);
        expect(await getUserToken(env.USER_TOKENS, "sub-123")).toEqual(SAMPLE);
    });

    it("returns null for invalid JSON", async () => {
        await env.USER_TOKENS.put("user:sub-bad", "not-json");
        expect(await getUserToken(env.USER_TOKENS, "sub-bad")).toBeNull();
    });

    it("returns null when token field is missing", async () => {
        await env.USER_TOKENS.put("user:sub-x", JSON.stringify({ email: "a@b.com" }));
        expect(await getUserToken(env.USER_TOKENS, "sub-x")).toBeNull();
    });

    it("returns null when email field is missing", async () => {
        await env.USER_TOKENS.put("user:sub-y", JSON.stringify({ token: "t" }));
        expect(await getUserToken(env.USER_TOKENS, "sub-y")).toBeNull();
    });
});

describe("deleteUserToken", () => {
    it("removes the stored token so a subsequent get returns null", async () => {
        await putUserToken(env.USER_TOKENS, "sub-del", SAMPLE);
        await deleteUserToken(env.USER_TOKENS, "sub-del");
        expect(await getUserToken(env.USER_TOKENS, "sub-del")).toBeNull();
    });
});

describe("key isolation", () => {
    it("stores separate entries per sub", async () => {
        const other: StoredUserToken = { ...SAMPLE, email: "other@example.com" };
        await putUserToken(env.USER_TOKENS, "sub-a", SAMPLE);
        await putUserToken(env.USER_TOKENS, "sub-b", other);
        expect(await getUserToken(env.USER_TOKENS, "sub-a")).toEqual(SAMPLE);
        expect(await getUserToken(env.USER_TOKENS, "sub-b")).toEqual(other);
    });
});

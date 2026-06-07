import { describe, it, expect } from "vitest";
import { getUserToken, putUserToken, deleteUserToken } from "./storage.js";
import type { StoredUserToken } from "./storage.js";

function makeKV(): KVNamespace {
    const store = new Map<string, string>();
    return {
        get: (key: string) => Promise.resolve(store.get(key) ?? null),
        put: (key: string, value: string) => { store.set(key, value); return Promise.resolve(); },
        delete: (key: string) => { store.delete(key); return Promise.resolve(); },
        list: () => Promise.resolve({ keys: [], list_complete: true, cacheStatus: null }),
        getWithMetadata: (key: string) =>
            Promise.resolve({ value: store.get(key) ?? null, metadata: null, cacheStatus: null }),
    } as unknown as KVNamespace;
}

const SAMPLE: StoredUserToken = {
    token: "lm-test-token",
    email: "user@example.com",
    createdAt: "2026-06-06T00:00:00.000Z",
    lastValidatedAt: "2026-06-06T00:00:00.000Z",
};

describe("getUserToken", () => {
    it("returns null for a missing key", async () => {
        expect(await getUserToken(makeKV(), "nobody")).toBeNull();
    });

    it("returns the stored value after putUserToken", async () => {
        const kv = makeKV();
        await putUserToken(kv, "sub-123", SAMPLE);
        expect(await getUserToken(kv, "sub-123")).toEqual(SAMPLE);
    });

    it("returns null for invalid JSON", async () => {
        const kv = makeKV();
        await kv.put("user:sub-bad", "not-json");
        expect(await getUserToken(kv, "sub-bad")).toBeNull();
    });

    it("returns null when token field is missing", async () => {
        const kv = makeKV();
        await kv.put("user:sub-x", JSON.stringify({ email: "a@b.com" }));
        expect(await getUserToken(kv, "sub-x")).toBeNull();
    });

    it("returns null when email field is missing", async () => {
        const kv = makeKV();
        await kv.put("user:sub-y", JSON.stringify({ token: "t" }));
        expect(await getUserToken(kv, "sub-y")).toBeNull();
    });
});

describe("deleteUserToken", () => {
    it("removes the stored token so a subsequent get returns null", async () => {
        const kv = makeKV();
        await putUserToken(kv, "sub-del", SAMPLE);
        await deleteUserToken(kv, "sub-del");
        expect(await getUserToken(kv, "sub-del")).toBeNull();
    });
});

describe("key isolation", () => {
    it("stores separate entries per sub", async () => {
        const kv = makeKV();
        const other: StoredUserToken = { ...SAMPLE, email: "other@example.com" };
        await putUserToken(kv, "sub-a", SAMPLE);
        await putUserToken(kv, "sub-b", other);
        expect(await getUserToken(kv, "sub-a")).toEqual(SAMPLE);
        expect(await getUserToken(kv, "sub-b")).toEqual(other);
    });
});

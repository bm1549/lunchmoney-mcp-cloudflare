import { describe, it, expect, vi, afterEach } from "vitest";
import { validateLunchMoneyToken } from "./validate.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

function stubFetch(init: { ok: boolean; status: number }): void {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(init));
}

function stubFetchError(message: string): void {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(message)));
}

describe("validateLunchMoneyToken", () => {
    it("returns ok:true for a 200 response", async () => {
        stubFetch({ ok: true, status: 200 });
        expect(await validateLunchMoneyToken("valid-token")).toEqual({ ok: true });
    });

    it("returns unauthorized message for 401", async () => {
        stubFetch({ ok: false, status: 401 });
        expect(await validateLunchMoneyToken("bad-token")).toEqual({
            ok: false,
            status: 401,
            message: "LunchMoney rejected the token (unauthorized).",
        });
    });

    it("returns unauthorized message for 403", async () => {
        stubFetch({ ok: false, status: 403 });
        expect(await validateLunchMoneyToken("bad-token")).toEqual({
            ok: false,
            status: 403,
            message: "LunchMoney rejected the token (unauthorized).",
        });
    });

    it("returns rate-limit message for 429", async () => {
        stubFetch({ ok: false, status: 429 });
        expect(await validateLunchMoneyToken("any-token")).toEqual({
            ok: false,
            status: 429,
            message: "LunchMoney rate-limited the validation request; try again.",
        });
    });

    it("returns server error message for 500", async () => {
        stubFetch({ ok: false, status: 500 });
        expect(await validateLunchMoneyToken("any-token")).toEqual({
            ok: false,
            status: 500,
            message: "LunchMoney returned 500; try again later.",
        });
    });

    it("returns network error for fetch rejection", async () => {
        stubFetchError("connection refused");
        expect(await validateLunchMoneyToken("any-token")).toEqual({
            ok: false,
            status: 0,
            message: "Network error contacting LunchMoney: connection refused",
        });
    });
});

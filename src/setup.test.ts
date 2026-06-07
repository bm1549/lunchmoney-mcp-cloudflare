import { describe, it, expect } from "vitest";
import { htmlEscape, readCookie, cspWithNonce } from "./handlers/setup.js";

describe("htmlEscape", () => {
    it("escapes &", () => expect(htmlEscape("a&b")).toBe("a&amp;b"));
    it("escapes <", () => expect(htmlEscape("<div>")).toBe("&lt;div&gt;"));
    it("escapes >", () => expect(htmlEscape("x>y")).toBe("x&gt;y"));
    it('escapes "', () => expect(htmlEscape('say "hi"')).toBe("say &quot;hi&quot;"));
    it("escapes '", () => expect(htmlEscape("it's")).toBe("it&#39;s"));
    it("leaves safe strings unchanged", () =>
        expect(htmlEscape("hello world")).toBe("hello world"));
    it("escapes multiple special chars", () =>
        expect(htmlEscape(`<b>"a"&'b'</b>`)).toBe("&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/b&gt;"));
});

describe("readCookie", () => {
    function req(cookieHeader: string | null): Request {
        const headers = new Headers();
        if (cookieHeader !== null) headers.set("cookie", cookieHeader);
        return new Request("https://example.com/", { headers });
    }

    it("returns the value when cookie is present", () =>
        expect(readCookie(req("lm_session=abc123"), "lm_session")).toBe("abc123"));
    it("returns null when the cookie header is absent", () =>
        expect(readCookie(req(null), "lm_session")).toBeNull());
    it("returns null when the named cookie is not present", () =>
        expect(readCookie(req("other=value"), "lm_session")).toBeNull());
    it("returns the correct value from multiple cookies", () =>
        expect(readCookie(req("a=1; lm_session=tok; b=2"), "lm_session")).toBe("tok"));
    it("handles cookie values that contain =", () =>
        expect(readCookie(req("lm_session=a=b=c"), "lm_session")).toBe("a=b=c"));
});

describe("cspWithNonce", () => {
    it("includes the nonce in script-src", () =>
        expect(cspWithNonce("abc123")).toContain("'nonce-abc123'"));
    it("includes default-src 'none'", () =>
        expect(cspWithNonce("x")).toContain("default-src 'none'"));
});

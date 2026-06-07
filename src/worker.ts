import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    createOAuthWorker,
    signResumeToken,
    type BaseEnv,
    type AppEnv,
    type GoogleUserInfo,
    type ResolveUserResult,
} from "@bm1549/remote-mcp-cloudflare";
import { createServer } from "@akutishevsky/lunchmoney-mcp/server";
import { initializeConfig } from "@akutishevsky/lunchmoney-mcp/config";
import packageJson from "../package.json" with { type: "json" };
import { getUserToken } from "./storage.js";
import { setupHandler } from "./handlers/setup.js";

interface WorkerEnv extends BaseEnv {
    USER_TOKENS: KVNamespace;
    REGISTER_LIMITER: RateLimit;
}

interface UserProps extends Record<string, unknown> {
    sub: string;
    email: string;
}

export class LunchMoneyMCP extends McpAgent<WorkerEnv, unknown, UserProps> {
    server!: McpServer;

    async init() {
        const sub = this.props?.sub;
        if (!sub) {
            throw new Error("Missing sub in McpAgent props");
        }
        const stored = await getUserToken(this.env.USER_TOKENS, sub);
        if (!stored) {
            // Shouldn't happen — resolveUser would have redirected the user
            // to /setup before this DO was instantiated. If we got here, the
            // KV row was deleted out from under an active grant.
            throw new Error(
                `No LunchMoney token stored for user ${sub}. Sign in again to re-onboard.`,
            );
        }
        initializeConfig(stored.token);
        this.server = createServer(packageJson.version);
    }
}

export default createOAuthWorker(LunchMoneyMCP, {
    userIdSource: "sub",
    resolveUser: async (
        userinfo: GoogleUserInfo,
        env: AppEnv,
        _request: Request,
        oauthReqInfo?: unknown,
    ): Promise<ResolveUserResult> => {
        if (!userinfo.email_verified || !userinfo.email || !userinfo.sub) {
            return { reject: "Email not verified by Google" };
        }
        const email = userinfo.email.toLowerCase();
        const sub = userinfo.sub;

        // Optional beta allowlist. Empty / unset => open signup.
        const allowedRaw = ((env.ALLOWED_EMAILS as string | undefined) ?? "").trim();
        if (allowedRaw) {
            const allowed = allowedRaw
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            if (!allowed.includes(email)) {
                // Matches the package's default error string for parity. We
                // accept the small information leak here; tightening this is
                // a follow-up.
                return { reject: `Forbidden: ${email} is not authorized` };
            }
        }

        const stored = await getUserToken(
            (env as unknown as WorkerEnv).USER_TOKENS,
            sub,
        );
        if (stored) {
            return { userId: sub, props: { sub, email } };
        }

        // First-time user: bounce to /setup to collect a LunchMoney token.
        const resumeToken = await signResumeToken(env, {
            oauthReqInfo,
            sub,
            email,
        });
        return { redirect: "/setup", resumeToken };
    },
    registerPolicy: {
        requirePkce: true,
        allowedRedirectSchemes: ["https", "http-localhost"],
        rejectIpHosts: true,
        maxRedirectUris: 5,
    },
    routes: {
        "/setup": setupHandler,
        // "/settings": stubbed for v1 — see README. Token rotation requires
        // operator-side KV delete in this release.
    },
});

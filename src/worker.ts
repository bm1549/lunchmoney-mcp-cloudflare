import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOAuthWorker, type BaseEnv } from "@bm1549/remote-mcp-cloudflare";
import { createServer } from "@akutishevsky/lunchmoney-mcp/server";
import { initializeConfig } from "@akutishevsky/lunchmoney-mcp/config";
import packageJson from "../package.json" with { type: "json" };

interface WorkerEnv extends BaseEnv {
    LUNCHMONEY_API_TOKEN: string;
}

export class LunchMoneyMCP extends McpAgent<WorkerEnv> {
    server!: McpServer;

    async init() {
        const token = this.env.LUNCHMONEY_API_TOKEN;
        if (!token) {
            throw new Error("Missing LUNCHMONEY_API_TOKEN env binding");
        }
        initializeConfig(token);
        this.server = createServer(packageJson.version);
    }
}

export default createOAuthWorker(LunchMoneyMCP);

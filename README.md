# lunchmoney-mcp-cloudflare

Cloudflare Worker that exposes [`akutishevsky/lunchmoney-mcp`](https://github.com/akutishevsky/lunchmoney-mcp) (41 LunchMoney tools) as a remote MCP endpoint that Claude Desktop or the Claude mobile app can connect to.

Built on top of [`remote-mcp-cloudflare`](https://github.com/bm1549/remote-mcp-cloudflare) — see that repo for the architecture and security model. This repo is the LunchMoney-specific wiring + Cloudflare deploy instructions.

## Prerequisites

- A **Cloudflare account** (free tier is fine).
- A **Google Cloud project** with an OAuth Web Client (consent screen configured, Testing mode is simplest).
- A **LunchMoney API token** — generate one at https://my.lunchmoney.app/developers.
- **Node 22+** (wrangler v4 requires it). On older Node, prefix every command below with the Docker recipe at the bottom.

## Setup

### 1. Clone and install

```sh
git clone https://github.com/bm1549/lunchmoney-mcp-cloudflare.git
cd lunchmoney-mcp-cloudflare
npm install
```

### 2. Authenticate wrangler

The cleanest way is a scoped API Token:

1. Visit https://dash.cloudflare.com/profile/api-tokens
2. Create a token with **Workers Scripts:Edit**, **Workers KV Storage:Edit**, and **Account:Read** permissions.
3. Export it: `export CLOUDFLARE_API_TOKEN=…`

(Avoid the Global API Key — it grants full account access and is harder to rotate. If you must use it, set `CLOUDFLARE_EMAIL` and `CLOUDFLARE_API_KEY` instead.)

### 3. Create the KV namespace

```sh
npx wrangler kv namespace create OAUTH_KV
```

Paste the printed `id` into `wrangler.jsonc` (replacing `REPLACE_WITH_YOUR_KV_ID`).

### 4. First deploy (to mint the workers.dev URL)

```sh
npx wrangler deploy
```

Output gives you `https://lunchmoney-mcp.<your-subdomain>.workers.dev`. The worker is live but `/authorize` will fail until secrets are set — nobody knows the URL yet, so this is fine.

### 5. Register a Google OAuth Web Client

At https://console.cloud.google.com/apis/credentials:

1. Configure the **OAuth consent screen** (External, Testing mode is simplest — add your Gmail addresses as test users).
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Add an authorized redirect URI:
   ```
   https://lunchmoney-mcp.<your-subdomain>.workers.dev/authorize/callback
   ```
4. Copy the **Client ID** and **Client Secret**.

### 6. Set the secrets

```sh
echo -n "<lunchmoney-token>" | npx wrangler secret put LUNCHMONEY_API_TOKEN
echo -n "<google-client-id>" | npx wrangler secret put GOOGLE_CLIENT_ID
echo -n "<google-client-secret>" | npx wrangler secret put GOOGLE_CLIENT_SECRET
echo -n "you@gmail.com" | npx wrangler secret put ALLOWED_EMAILS
openssl rand -hex 32 | npx wrangler secret put STATE_SECRET
```

`ALLOWED_EMAILS` may be a comma-separated list.

### 7. Redeploy with the secrets in place

```sh
npx wrangler deploy
```

### 8. Connect from claude.ai

claude.ai → **Settings → Connectors → Add custom connector**

URL: `https://lunchmoney-mcp.<your-subdomain>.workers.dev/mcp`

The first connect kicks you through Google's consent screen; pick an allowlisted account and you should land back in claude.ai with all 41 LunchMoney tools registered.

## Local development

```sh
cp .dev.vars.example .dev.vars
# fill in real values
npx wrangler dev
```

`wrangler dev` runs the worker locally against real KV and real Durable Objects.

To complete the OAuth dance against the local worker, register `http://localhost:8787/authorize/callback` as an additional redirect URI on the same Google client.

## Old Node? Use the Docker recipe

If you're on Node 18 or 20, `wrangler@4` won't run natively. Run it through a Node 22 container:

```sh
docker run --rm -e CLOUDFLARE_API_TOKEN \
  -v "$PWD:/app" -w /app \
  node:22 npx wrangler@4 deploy
```

Apply the same pattern to `kv namespace create`, `secret put`, `dev`, `tail`, etc. For interactive `secret put`, add `-i`.

## License

MIT

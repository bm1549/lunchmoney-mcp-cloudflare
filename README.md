# lunchmoney-mcp-cloudflare

Deploy [LunchMoney's MCP server](https://github.com/akutishevsky/lunchmoney-mcp) to Cloudflare so Claude (desktop or mobile) can use it as a custom connector. Sign-in is gated by Google + an email allowlist, so the worker stays private to you.

## What you'll need

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [LunchMoney API token](https://my.lunchmoney.app/developers)
- A [Google Cloud account](https://console.cloud.google.com/) (for sign-in)
- Node 22 or newer

## Setup

### 1. Clone, install, log in to Cloudflare

```sh
git clone https://github.com/bm1549/lunchmoney-mcp-cloudflare.git
cd lunchmoney-mcp-cloudflare
npm install
npx wrangler login
```

`wrangler login` opens a browser to authorize wrangler with your Cloudflare account.

### 2. Create a KV namespace

```sh
npx wrangler kv namespace create OAUTH_KV
```

Open `wrangler.jsonc` and paste the printed `id` over `REPLACE_WITH_YOUR_KV_ID`.

### 3. Deploy once to mint your URL

```sh
npx wrangler deploy
```

The output prints a URL like `https://lunchmoney-mcp.<your-subdomain>.workers.dev`. Copy it — you'll need it next.

### 4. Set up Google sign-in

At [Google Cloud → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials):

1. Configure the **OAuth consent screen** → **External** + **Testing**. Add your Gmail address as a test user.
2. Create credentials → **OAuth client ID** → **Web application**.
3. Add an **Authorized redirect URI**:
   ```
   https://lunchmoney-mcp.<your-subdomain>.workers.dev/authorize/callback
   ```
4. Copy the **Client ID** and **Client Secret**.

### 5. Set the worker secrets

```sh
echo -n "<lunchmoney-api-token>"  | npx wrangler secret put LUNCHMONEY_API_TOKEN
echo -n "<google-client-id>"      | npx wrangler secret put GOOGLE_CLIENT_ID
echo -n "<google-client-secret>"  | npx wrangler secret put GOOGLE_CLIENT_SECRET
echo -n "you@gmail.com"           | npx wrangler secret put ALLOWED_EMAILS
openssl rand -hex 32              | npx wrangler secret put STATE_SECRET
```

`ALLOWED_EMAILS` is comma-separated — only addresses on this list can complete sign-in.

### 6. Redeploy

```sh
npx wrangler deploy
```

### 7. Connect from Claude

In [claude.ai](https://claude.ai) → **Settings → Connectors → Add custom connector**.

```
https://lunchmoney-mcp.<your-subdomain>.workers.dev/mcp
```

You'll be bounced through Google sign-in. Pick the allowlisted account, and all 41 LunchMoney tools show up in Claude.

## Troubleshooting

- **Google warns "App is being tested"** — normal in Testing mode. Continue.
- **`Forbidden: <email> is not authorized`** after Google sign-in — that address isn't in `ALLOWED_EMAILS`. Re-run the `secret put ALLOWED_EMAILS` step with the right list.
- **Anything else** — `npx wrangler tail` streams live logs from the deployed worker.

## License

MIT

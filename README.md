# lunchmoney-mcp-cloudflare

Deploy [LunchMoney's MCP server](https://github.com/akutishevsky/lunchmoney-mcp) to Cloudflare so Claude (desktop or mobile) can use it as a custom connector. Sign-in is gated by Google, with an optional Gmail allowlist for beta deployments. Each end-user supplies their own LunchMoney API token on first connect — the operator deploying the worker does not need a LunchMoney token.

## What you'll need

**As the operator** (the person deploying):

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [Google Cloud account](https://console.cloud.google.com/) (to create the OAuth client all end-users authenticate against)
- Node 22 or newer

**As an end-user connecting from Claude:**

- A Google account (one of the allowlisted Gmail addresses, if the operator configured an allowlist)
- A [LunchMoney API token](https://my.lunchmoney.app/developers) — you'll paste this once at the `/setup` page on first connect

## Quick start

```sh
git clone https://github.com/bm1549/lunchmoney-mcp-cloudflare.git
cd lunchmoney-mcp-cloudflare
./setup.sh
```

The wizard walks you through everything below — KV namespaces, deploy, Google OAuth client, secrets, redeploy — and prints the final URL to paste into claude.ai. The wizard targets `wrangler.mt.jsonc` (the multi-tenant worker `lunchmoney-mcp-mt`).

## Setup (manual)

### 1. Clone, install, log in to Cloudflare

```sh
git clone https://github.com/bm1549/lunchmoney-mcp-cloudflare.git
cd lunchmoney-mcp-cloudflare
npm install
npx wrangler login
```

### 2. Create the KV namespaces

```sh
npx wrangler kv namespace create OAUTH_KV_MT
npx wrangler kv namespace create USER_TOKENS_MT
```

Open `wrangler.mt.jsonc` and paste the printed ids over `REPLACE_WITH_OAUTH_KV_MT_ID` and `REPLACE_WITH_USER_TOKENS_MT_ID` respectively.

### 3. Deploy once to mint your URL

```sh
npx wrangler deploy -c wrangler.mt.jsonc
```

The output prints a URL like `https://lunchmoney-mcp-mt.<your-subdomain>.workers.dev`. Copy it — you'll need it next.

### 4. Set up Google sign-in

At [Google Cloud → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials):

1. Configure the **OAuth consent screen** → **External** + **Testing**. Add the Gmail addresses you want to allow as test users.
2. Create credentials → **OAuth client ID** → **Web application**.
3. Add an **Authorized redirect URI**:
   ```
   https://lunchmoney-mcp-mt.<your-subdomain>.workers.dev/authorize/callback
   ```
4. Copy the **Client ID** and **Client Secret**.

### 5. Set the worker secrets

```sh
echo -n "<google-client-id>"      | npx wrangler secret put -c wrangler.mt.jsonc GOOGLE_CLIENT_ID
echo -n "<google-client-secret>"  | npx wrangler secret put -c wrangler.mt.jsonc GOOGLE_CLIENT_SECRET
echo -n "you@gmail.com"           | npx wrangler secret put -c wrangler.mt.jsonc ALLOWED_EMAILS
openssl rand -hex 32              | npx wrangler secret put -c wrangler.mt.jsonc STATE_SECRET
```

`ALLOWED_EMAILS` is **optional** and serves as a beta gate. Leave it unset (or set it to an empty string) to allow any Google account with a verified email. Set it to a comma-separated list to restrict access.

### 6. Redeploy

```sh
npx wrangler deploy -c wrangler.mt.jsonc
```

### 7. Connect from Claude

In [claude.ai](https://claude.ai) → **Settings → Connectors → Add custom connector**:

```
https://lunchmoney-mcp-mt.<your-subdomain>.workers.dev/mcp
```

The first time you connect:

1. You'll be bounced through Google sign-in.
2. After sign-in you'll land on a `/setup` page asking for your LunchMoney API token.
3. Paste a token from [my.lunchmoney.app/developers](https://my.lunchmoney.app/developers) and submit.
4. You'll be returned to Claude with all LunchMoney tools registered.

On subsequent connects you'll skip step 2 — the stored token is reused.

## Token rotation (v1 limitation)

This release does not yet expose a self-serve UI for rotating or deleting a stored token. To rotate, the operator deletes the user's KV row:

```sh
# `sub` is the Google subject id printed in worker logs at sign-in time.
npx wrangler kv key delete --binding USER_TOKENS -c wrangler.mt.jsonc "user:<sub>"
```

The user will then be sent back through `/setup` on their next connect. A `/settings` page for self-serve rotation is a planned follow-up.

## Troubleshooting

- **Google warns "App is being tested"** — normal in Testing mode. Continue.
- **`Forbidden: <email> is not authorized`** after Google sign-in — that address isn't in `ALLOWED_EMAILS`. Either add them to the allowlist or unset it for open signup.
- **`Setup link expired`** at `/setup` — the resume token is good for 30 minutes. Re-launch the connect flow from Claude.
- **Anything else** — `npx wrangler tail -c wrangler.mt.jsonc` streams live logs from the deployed worker.

## License

MIT

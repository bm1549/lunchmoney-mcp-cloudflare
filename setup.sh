#!/usr/bin/env bash
# setup.sh — wizard for first-time deploy of lunchmoney-mcp-cloudflare (multi-tenant).
#
# Walks you through:
#   1. Node version check + npm install
#   2. Cloudflare login (if needed)
#   3. KV namespace creation (OAUTH_KV_MT + USER_TOKENS_MT)
#   4. First deploy (mints your workers.dev URL)
#   5. Google OAuth client setup (manual — opens the browser)
#   6. Setting all worker secrets
#   7. Final deploy
#
# Re-running prompts for every secret again. Safe to re-run, but each run
# overwrites the secrets.
#
# This wizard targets wrangler.mt.jsonc (the multi-tenant worker). In the
# multi-tenant flow each end-user supplies their own LunchMoney token via
# /setup after Google sign-in — there's no longer a single LUNCHMONEY_API_TOKEN
# secret on the worker itself.

set -euo pipefail

BOLD=$'\033[1m'
DIM=$'\033[2m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

WRANGLER_CONFIG="wrangler.mt.jsonc"

step() {
    echo
    echo "${BOLD}>>> $1${RESET}"
}

die() {
    echo "${RED}error: $1${RESET}" >&2
    exit 1
}

read_value() {
    local label="$1"
    local default="${2:-}"
    local value=""
    if [[ -n "$default" ]]; then
        printf '%s [%s]: ' "$label" "$default" >&2
    else
        printf '%s: ' "$label" >&2
    fi
    IFS= read -r value
    if [[ -z "$value" && -n "$default" ]]; then
        value="$default"
    fi
    printf '%s' "$value"
}

read_secret() {
    local label="$1"
    local value=""
    printf '%s: ' "$label" >&2
    IFS= read -rs value
    echo >&2
    printf '%s' "$value"
}

open_browser() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    fi
}

# -----------------------------------------------------------------------------

step "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 22+ first."
node_major=$(node -p "process.versions.node.split('.')[0]")
if (( node_major < 22 )); then
    die "Node $(node -v) is too old. wrangler v4 needs Node 22+."
fi
command -v openssl >/dev/null 2>&1 || die "openssl not found (needed to generate STATE_SECRET)."
echo "Node $(node -v)"
echo "openssl $(openssl version | awk '{print $2}')"

# -----------------------------------------------------------------------------

step "Installing dependencies"
npm install

# -----------------------------------------------------------------------------

step "Cloudflare login"
if npx --no-install wrangler whoami 2>/dev/null | grep -q "associated with"; then
    echo "Already logged in."
else
    npx wrangler login
fi

# -----------------------------------------------------------------------------

step "KV namespaces"

create_kv() {
    # $1 = wrangler kv namespace name (e.g. OAUTH_KV_MT)
    # $2 = placeholder string in $WRANGLER_CONFIG (e.g. REPLACE_WITH_OAUTH_KV_MT_ID)
    local name="$1"
    local placeholder="$2"

    if ! grep -q "$placeholder" "$WRANGLER_CONFIG"; then
        echo "${DIM}$placeholder already substituted in $WRANGLER_CONFIG; skipping $name creation.${RESET}"
        return 0
    fi

    echo "Creating $name…"
    local out
    out=$(npx wrangler kv namespace create "$name")
    echo "$out"
    local new_id
    new_id=$(echo "$out" | grep -oE '[a-f0-9]{32}' | head -1 || true)
    [[ -n "$new_id" ]] || die "Could not detect new KV id for $name. Paste it into $WRANGLER_CONFIG manually and re-run."
    sed -i.bak "s/$placeholder/$new_id/" "$WRANGLER_CONFIG"
    rm -f "$WRANGLER_CONFIG.bak"
    echo "Wrote $name id $new_id into $WRANGLER_CONFIG"
}

create_kv "OAUTH_KV_MT" "REPLACE_WITH_OAUTH_KV_MT_ID"
create_kv "USER_TOKENS_MT" "REPLACE_WITH_USER_TOKENS_MT_ID"

# -----------------------------------------------------------------------------

step "First deploy (mints your workers.dev URL)"
deploy_out=$(npx wrangler deploy -c "$WRANGLER_CONFIG" 2>&1 | tee /dev/tty)
worker_url=$(echo "$deploy_out" | grep -oE 'https://[A-Za-z0-9._-]+\.workers\.dev' | tail -1 || true)
if [[ -z "${worker_url:-}" ]]; then
    worker_url=$(read_value "Worker URL printed above (https://…workers.dev)")
fi
echo
echo "Worker URL: ${BOLD}$worker_url${RESET}"

# -----------------------------------------------------------------------------

step "Google OAuth client"

callback="$worker_url/authorize/callback"

cat <<EOF

In your browser:

  1. Go to ${BOLD}https://console.cloud.google.com/apis/credentials${RESET}
  2. Configure ${BOLD}OAuth consent screen${RESET} → External → Testing
       Add your Gmail address as a test user.
  3. Create credentials → ${BOLD}OAuth client ID${RESET} → ${BOLD}Web application${RESET}
  4. Under ${BOLD}Authorized redirect URIs${RESET} add this exact URL:

       ${GREEN}$callback${RESET}

  5. Copy the Client ID and Client Secret — you'll paste them next.

EOF

open_browser "https://console.cloud.google.com/apis/credentials"

read -r -p "Press Enter when you have the Client ID and Secret ready… " _

# -----------------------------------------------------------------------------

step "Setting worker secrets"

GOOGLE_CLIENT_ID=$(read_value "Google Client ID")
[[ -n "$GOOGLE_CLIENT_ID" ]] || die "Google Client ID is required."

GOOGLE_CLIENT_SECRET=$(read_secret "Google Client Secret")
[[ -n "$GOOGLE_CLIENT_SECRET" ]] || die "Google Client Secret is required."

default_email=""
if command -v git >/dev/null 2>&1; then
    default_email=$(git config --get user.email 2>/dev/null || true)
fi
ALLOWED_EMAILS=$(read_value "Beta allowlist (comma-separated Gmail addresses, or blank for open signup)" "$default_email")

STATE_SECRET=$(openssl rand -hex 32)

echo
echo "${DIM}Pushing secrets to Cloudflare…${RESET}"
printf '%s' "$GOOGLE_CLIENT_ID"     | npx wrangler secret put -c "$WRANGLER_CONFIG" GOOGLE_CLIENT_ID >/dev/null
printf '%s' "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put -c "$WRANGLER_CONFIG" GOOGLE_CLIENT_SECRET >/dev/null
printf '%s' "$ALLOWED_EMAILS"       | npx wrangler secret put -c "$WRANGLER_CONFIG" ALLOWED_EMAILS >/dev/null
printf '%s' "$STATE_SECRET"         | npx wrangler secret put -c "$WRANGLER_CONFIG" STATE_SECRET >/dev/null
echo "Secrets set."

# -----------------------------------------------------------------------------

step "Final deploy"
npx wrangler deploy -c "$WRANGLER_CONFIG"

# -----------------------------------------------------------------------------

cat <<EOF

${GREEN}${BOLD}Done.${RESET}

Add this URL to claude.ai → Settings → Connectors → Add custom connector:

    ${BOLD}${GREEN}$worker_url/mcp${RESET}

First connect bounces each user through Google sign-in. Allowlisted users
(or any Google user, if you left the allowlist blank) will land on a
${BOLD}/setup${RESET} page where they paste their own LunchMoney API token. After that
they're sent back to Claude with all LunchMoney tools registered.

EOF

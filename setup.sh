#!/usr/bin/env bash
# setup.sh — wizard for first-time deploy of lunchmoney-mcp-cloudflare.
#
# Walks you through:
#   1. Node version check + npm install
#   2. Cloudflare login (if needed)
#   3. KV namespace creation
#   4. First deploy (mints your workers.dev URL)
#   5. Google OAuth client setup (manual — opens the browser)
#   6. Setting all worker secrets
#   7. Final deploy
#
# Re-running prompts for every secret again. Safe to re-run, but each run
# overwrites the secrets.

set -eu

BOLD=$'\033[1m'
DIM=$'\033[2m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

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
    local value=""
    printf '%s: ' "$label" >&2
    IFS= read -r value
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

step "KV namespace"

existing_kv=$(grep -oE '"id":[[:space:]]*"[a-f0-9]{20,}"' wrangler.jsonc | head -1 | grep -oE '[a-f0-9]{20,}' || true)

if [[ -n "${existing_kv:-}" ]]; then
    echo "${DIM}Reusing KV namespace already in wrangler.jsonc: $existing_kv${RESET}"
else
    echo "Creating OAUTH_KV…"
    kv_out=$(npx wrangler kv namespace create OAUTH_KV)
    echo "$kv_out"
    new_kv=$(echo "$kv_out" | grep -oE '[a-f0-9]{32}' | head -1 || true)
    [[ -n "$new_kv" ]] || die "Could not detect new KV id. Paste it into wrangler.jsonc manually and re-run."

    # Replace placeholder in wrangler.jsonc.
    if grep -q "REPLACE_WITH_YOUR_KV_ID" wrangler.jsonc; then
        sed -i.bak "s/REPLACE_WITH_YOUR_KV_ID/$new_kv/" wrangler.jsonc
        rm -f wrangler.jsonc.bak
        echo "Wrote KV id $new_kv into wrangler.jsonc"
    else
        echo "${YELLOW}wrangler.jsonc has no REPLACE_WITH_YOUR_KV_ID placeholder.${RESET}"
        echo "${YELLOW}Make sure the OAUTH_KV binding uses id $new_kv.${RESET}"
    fi
fi

# -----------------------------------------------------------------------------

step "First deploy (mints your workers.dev URL)"
deploy_out=$(npx wrangler deploy 2>&1 | tee /dev/tty)
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

LUNCHMONEY_API_TOKEN=$(read_secret "LunchMoney API token (https://my.lunchmoney.app/developers)")
[[ -n "$LUNCHMONEY_API_TOKEN" ]] || die "LunchMoney token is required."

GOOGLE_CLIENT_ID=$(read_value "Google Client ID")
[[ -n "$GOOGLE_CLIENT_ID" ]] || die "Google Client ID is required."

GOOGLE_CLIENT_SECRET=$(read_secret "Google Client Secret")
[[ -n "$GOOGLE_CLIENT_SECRET" ]] || die "Google Client Secret is required."

ALLOWED_EMAILS=$(read_value "Allowed Gmail addresses (comma-separated)")
[[ -n "$ALLOWED_EMAILS" ]] || die "At least one email is required."

STATE_SECRET=$(openssl rand -hex 32)

echo
echo "${DIM}Pushing secrets to Cloudflare…${RESET}"
printf '%s' "$LUNCHMONEY_API_TOKEN" | npx wrangler secret put LUNCHMONEY_API_TOKEN >/dev/null
printf '%s' "$GOOGLE_CLIENT_ID"     | npx wrangler secret put GOOGLE_CLIENT_ID >/dev/null
printf '%s' "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET >/dev/null
printf '%s' "$ALLOWED_EMAILS"       | npx wrangler secret put ALLOWED_EMAILS >/dev/null
printf '%s' "$STATE_SECRET"         | npx wrangler secret put STATE_SECRET >/dev/null
echo "Secrets set."

# -----------------------------------------------------------------------------

step "Final deploy"
npx wrangler deploy

# -----------------------------------------------------------------------------

cat <<EOF

${GREEN}${BOLD}Done.${RESET}

Add this URL to claude.ai → Settings → Connectors → Add custom connector:

    ${BOLD}${GREEN}$worker_url/mcp${RESET}

First connect bounces you through Google. Pick one of the allowlisted
accounts and you should land back in Claude with all LunchMoney tools
registered.

EOF

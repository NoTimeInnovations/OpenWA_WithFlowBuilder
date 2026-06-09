#!/usr/bin/env bash
# Connect to the EC2 instance over SSH and deploy OpenWA with HTTPS.
# Run from your local machine:  bash deploy/deploy.sh
#
# Override any value via env, e.g.:
#   SSH_USER=ec2-user DOMAIN=foo.example.com bash deploy/deploy.sh
set -euo pipefail

EC2_IP="${EC2_IP:-13.235.70.130}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/Documents/Server Keys/server-aws/OpenWA.pem}"
DOMAIN="${DOMAIN:-openwa.menuthere.com}"
REPO_URL="${REPO_URL:-https://github.com/NoTimeInnovations/OpenWA_WithFlowBuilder.git}"
REMOTE_DIR="${REMOTE_DIR:-OpenWA_WithFlowBuilder}"

if [ ! -f "$SSH_KEY" ]; then
  echo "❌ SSH key not found: $SSH_KEY"
  echo "   Set SSH_KEY=/path/to/OpenWA.pem and retry."
  exit 1
fi
chmod 600 "$SSH_KEY" 2>/dev/null || true

echo "▶ Connecting to ${SSH_USER}@${EC2_IP} to deploy ${DOMAIN} …"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${SSH_USER}@${EC2_IP}" \
  'bash -s' -- "$REPO_URL" "$REMOTE_DIR" "$DOMAIN" <<'REMOTE'
set -euo pipefail
REPO_URL="$1"; REMOTE_DIR="$2"; DOMAIN="$3"

# Ensure git is available for the clone.
if ! command -v git >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y git
fi

# Clone (first run) or fast-forward update (redeploys).
if [ -d "$REMOTE_DIR/.git" ]; then
  echo "▶ Updating existing checkout…"
  git -C "$REMOTE_DIR" pull --ff-only
else
  echo "▶ Cloning ${REPO_URL}…"
  git clone --depth 1 "$REPO_URL" "$REMOTE_DIR"
fi

cd "$REMOTE_DIR"
chmod +x deploy/remote-bootstrap.sh
DOMAIN="$DOMAIN" bash deploy/remote-bootstrap.sh
REMOTE

echo ""
echo "✅ Finished. Once Caddy has its certificate, open: https://${DOMAIN}"
echo "   If the cert doesn't issue, confirm EC2 security-group ports 80 + 443 are open"
echo "   and Cloudflare SSL/TLS mode is 'Full (strict)' (or set the DNS record to DNS-only)."

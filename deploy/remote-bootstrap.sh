#!/usr/bin/env bash
# Runs ON the EC2 instance. Installs Docker, generates a production .env,
# and brings up the OpenWA stack (API + dashboard + Caddy/HTTPS).
# Idempotent: safe to re-run for redeploys (preserves the generated master key).
set -euo pipefail

DOMAIN="${DOMAIN:-openwa.menuthere.com}"
cd "$(dirname "$0")/.."   # repo root (this script lives in deploy/)

echo "▶ Bootstrapping OpenWA for ${DOMAIN} on $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-this host}")"

# 1) Swap — cheap OOM insurance for headless Chromium on small instances.
if ! sudo swapon --show | grep -q .; then
  echo "▶ Creating 2G swapfile…"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 2) Docker (+ compose plugin, included by get.docker.com).
if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Installing Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

# 3) Production env — generated once; master key is preserved across redeploys.
ENVFILE="deploy/.env.prod"
if [ ! -f "$ENVFILE" ]; then
  MASTER_KEY="$(openssl rand -hex 24)"
  cat > "$ENVFILE" <<ENV
NODE_ENV=production
DOMAIN=${DOMAIN}
# Admin master key for the dashboard / API (keep this secret):
API_MASTER_KEY=${MASTER_KEY}
# SQLite with synchronize=true so all tables (incl. flows) auto-create:
DATABASE_TYPE=sqlite
DATABASE_NAME=/app/data/openwa.sqlite
DATABASE_SYNCHRONIZE=true
ENGINE_TYPE=whatsapp-web.js
PUPPETEER_HEADLESS=true
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu
STORAGE_TYPE=local
REDIS_ENABLED=false
QUEUE_ENABLED=false
CORS_ORIGINS=https://${DOMAIN}
ENV
  echo "==================================================================="
  echo "  Generated ${ENVFILE}."
  echo "  >>> SAVE YOUR ADMIN MASTER KEY (login to the dashboard with it): "
  echo "      API_MASTER_KEY=${MASTER_KEY}"
  echo "==================================================================="
fi

# 4) Build & start.
echo "▶ Building & starting containers (first build takes a few minutes)…"
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build

# 5) Wait for the API to report healthy.
echo "▶ Waiting for the API to become healthy…"
for i in $(seq 1 40); do
  if sudo docker exec openwa-api node -e "require('http').get('http://localhost:2785/api/health',r=>process.exit(r.statusCode===200?0:1))" 2>/dev/null; then
    echo "✓ API healthy"
    break
  fi
  sleep 3
done

echo "▶ Containers:"
sudo docker compose -f deploy/docker-compose.prod.yml ps
echo ""
echo "▶ Caddy is now requesting a Let's Encrypt certificate for ${DOMAIN}."
echo "  This needs: EC2 security group inbound 80 + 443 open, and ${DOMAIN}"
echo "  resolving to this server (directly, or via Cloudflare with SSL mode 'Full (strict)')."
echo "  Watch cert progress with:  sudo docker logs -f openwa-caddy"

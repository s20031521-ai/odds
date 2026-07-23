#!/bin/bash
set -euo pipefail

# === Chiikawa UX Redesign Deploy ===
# Run from your local machine that has SSH access to the VM

VM_HOST="118.140.60.206"
VM_PORT="169"
VM_USER="hugo"
SUDO_PASS="Hugohk1991"
SSH_KEY="$HOME/.ssh/astra_vm_ed25519"
STACK_ROOT="/opt/odds-tool"

echo "=== Step 1: Sync code ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" << 'ENDSSH'
cd /opt/odds-tool/build
git fetch origin master
git reset --hard origin/master
echo "Code synced to $(git rev-parse --short HEAD)"
ENDSSH

echo ""
echo "=== Step 2: Setup sudo + validate ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" << ENDSSH
printf '#!/bin/sh\nprintf "%%s\\n" "$SUDO_PASS"\n' > /tmp/.ap.sh
chmod +x /tmp/.ap.sh
export SUDO_ASKPASS=/tmp/.ap.sh

cd $STACK_ROOT/build
sudo -A docker compose config --quiet && echo "CONFIG-OK"
ENDSSH

echo ""
echo "=== Step 3: Build images ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" << ENDSSH
export SUDO_ASKPASS=/tmp/.ap.sh
cd $STACK_ROOT/build

# Tag rollback
sudo -A docker tag odds-tool-api:latest odds-tool-api:rollback 2>/dev/null || true
sudo -A docker tag odds-tool-caddy:latest odds-tool-caddy:rollback 2>/dev/null || true

sudo -A docker compose build api caddy
echo "BUILD-OK"
ENDSSH

echo ""
echo "=== Step 4: Deploy app tier ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" << ENDSSH
export SUDO_ASKPASS=/tmp/.ap.sh
cd $STACK_ROOT/build

sudo -A docker compose up -d postgres
sleep 3
sudo -A docker compose up -d api caddy
sleep 3

# Health check
sudo -A docker ps --filter name=odds-tool --format '{{.Names}} {{.Status}}'
ENDSSH

echo ""
echo "=== Step 5: Smoke tests ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" << 'ENDSSH'
export SUDO_ASKPASS=/tmp/.ap.sh
cd /opt/odds-tool/build

echo "--- Internal readiness ---"
sudo -A docker run --rm --network odds-tool_app_net --entrypoint node odds-tool-api:latest   -e "const q=async(u)=>{try{const r=await fetch(u);console.log(u,r.status)}catch(e){console.log(u,'ERR')}};await q('http://api:8787/internal/health/ready');await q('http://caddy/internal/health/ready');await q('http://caddy/api/v1/session');"

echo ""
echo "--- Public smoke ---"
curl -s -o /dev/null -w "root: %{http_code}
" https://odds.ballballchu.com.hk/
curl -s -o /dev/null -w "api/results: %{http_code}
" https://odds.ballballchu.com.hk/api/v1/results
curl -s -o /dev/null -w "internal/health: %{http_code}
" https://odds.ballballchu.com.hk/internal/health/ready
curl -sI https://odds.ballballchu.com.hk/ 2>&1 | grep -ci "strict-transport-security" | xargs -I{} echo "HSTS: {}"
ENDSSH

echo ""
echo "=== Step 6: Restart collector ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" << ENDSSH
export SUDO_ASKPASS=/tmp/.ap.sh
cd $STACK_ROOT/build
sudo -A docker compose up -d collector
sleep 5
sudo -A docker logs odds-tool-collector-1 --tail=10
ENDSSH

echo ""
echo "=== Step 7: Cleanup ==="
ssh -i "$SSH_KEY" -p "$VM_PORT" "$VM_USER@$VM_HOST" "rm -f /tmp/.ap.sh"

echo ""
echo "=== Deploy complete! ==="
echo "Visit: https://odds.ballballchu.com.hk"

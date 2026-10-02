#!/usr/bin/env bash
# Sobe a demo do saque privado (Cloak): API de mentira (porta 3018) + site (porta 3100) na rede REAL (mainnet).
#   bash scripts/cloak-demo.sh        (Ctrl+C para parar os dois)
# Chave do RPC: variavel HELIUS_KEY, ou lida de apps/server/.env.devnet (a mesma chave Helius, so troca o host para mainnet).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KEY="${HELIUS_KEY:-}"
if [ -z "$KEY" ] && [ -f "$ROOT/apps/server/.env.devnet" ]; then
  KEY="$(grep -m1 '^SOLANA_RPC_URL=' "$ROOT/apps/server/.env.devnet" | sed -nE 's/.*api-key=([^&" ]+).*/\1/p')"
fi
[ -n "$KEY" ] || { echo "Defina HELIUS_KEY (chave do Helius) e rode de novo."; exit 1; }

for p in 3018 3100; do
  if netstat -ano 2>/dev/null | grep -qE "[:.]$p .*LISTEN"; then echo "A porta $p ja esta em uso. Pare o que estiver nela e rode de novo."; exit 1; fi
done

node "$ROOT/scripts/cloak-demo-api.mjs" &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT INT TERM

cd "$ROOT/apps/web"
echo "Site em http://localhost:3100/criador/saque-privado (aguarde 'Ready')"
# NEXT_PUBLIC_PRIVY_APP_ID vazio = login de desenvolvimento (carteira criada no navegador), sem Privy.
NEXT_PUBLIC_CLOAK_ENABLED=1 \
NEXT_PUBLIC_CLOAK_RPC_URL="https://mainnet.helius-rpc.com/?api-key=$KEY" \
API_DEV_URL=http://localhost:3018 \
NEXT_PUBLIC_PRIVY_APP_ID= \
npx next dev -p 3100

#!/usr/bin/env bash
# Preparação única da VPS para o Solvers (rodar NA VPS como deploy, com sudo).
# Segue o VPS_GUIDE: /var/www/solvers, PM2 solvers-api na 3017, PG16 (5433) + pgvector, nginx + certbot.
set -euo pipefail
APP=/var/www/solvers
DOMAIN=${DOMAIN:-solvers.wondervelop.com}

sudo mkdir -p $APP/{releases,shared,keys,logs,deliverables,shared/submissions,shared/packages}
sudo chown -R deploy:deploy $APP
chmod 700 $APP/keys $APP/shared/submissions $APP/shared/packages

# Banco: PG16 na porta 5433 com pgvector.
sudo apt-get install -y postgresql-16-pgvector >/dev/null
if ! sudo -u postgres psql -p 5433 -tAc "select 1 from pg_roles where rolname='solvers_user'" | grep -q 1; then
  PASS=$(openssl rand -hex 16)
  sudo -u postgres psql -p 5433 -c "CREATE USER solvers_user WITH PASSWORD '$PASS';"
  sudo -u postgres psql -p 5433 -c "CREATE DATABASE solvers OWNER solvers_user;"
  echo "DATABASE_URL=postgres://solvers_user:$PASS@127.0.0.1:5433/solvers" > $APP/shared/db.env
  chmod 600 $APP/shared/db.env
  echo "✔ banco criado (credencial em $APP/shared/db.env)"
fi
sudo -u postgres psql -p 5433 -d solvers -c "CREATE EXTENSION IF NOT EXISTS vector;"

# .env de produção (segredos gerados aqui; nunca sai da VPS).
if [ ! -f $APP/shared/.env ]; then
  . $APP/shared/db.env
  cat > $APP/shared/.env <<ENV
NODE_ENV=production
PORT=3017
PUBLIC_API_URL=https://$DOMAIN
PUBLIC_WEB_URL=https://$DOMAIN
SIWS_DOMAIN=$DOMAIN
DATABASE_URL=$DATABASE_URL
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
USDC_MINT=4Ut3YnnVQjQ6UgedWFtd3PmDN1E25iZpq47YtoNYdTi3
FEE_PAYER_KEYPAIR=$APP/keys/fee-payer.json
VERIFIER_KEYPAIR=$APP/keys/verifier.json
USAGE_AUTHORITY_KEYPAIR=$APP/keys/usage.json
HELIUS_WEBHOOK_SECRET=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
SERVER_KEK=$(openssl rand -base64 32)
FAUCET_ENABLED=true
GUARANTEE_MIN_SALES=0
GUARANTEE_MIN_RATING=0
AGENTS_DIR=$APP/agents
DELIVERABLES_DIR=$APP/deliverables
SUBMISSIONS_DIR=$APP/shared/submissions
PUBLISHED_DIR=$APP/shared/packages
ADMIN_WALLETS=
VERIFIER_MODE=docker
VERIFIER_IMAGE=solvers-react-test
ENV
  chmod 600 $APP/shared/.env
  echo "✔ .env criado em $APP/shared/.env (copie as chaves fee-payer/verifier/usage para $APP/keys)"
fi

# Verificador da garantia: acesso ao Docker (o usuário deploy no grupo docker equivale a root no host).
if ! id -nG deploy | grep -qw docker; then sudo usermod -aG docker deploy; echo "deploy adicionado ao grupo docker (relogar)"; fi

# nginx + HTTPS: só quando o DNS já aponta para esta VPS.
IP=$(curl -fsS https://api.ipify.org || true)
if [ "$(dig +short $DOMAIN | tail -n1)" = "$IP" ]; then
  sudo cp $APP/app/infra/nginx/solvers /etc/nginx/sites-available/solvers
  if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
    # Usa a conta Let's Encrypt já registrada na VPS (ou CERTBOT_EMAIL, se definido).
    sudo certbot certonly --nginx -d $DOMAIN --non-interactive --agree-tos ${CERTBOT_EMAIL:+-m $CERTBOT_EMAIL}
  fi
  sudo ln -sfn /etc/nginx/sites-available/solvers /etc/nginx/sites-enabled/solvers
  sudo nginx -t && sudo systemctl reload nginx
  echo "✔ nginx e HTTPS ativos em https://$DOMAIN"
else
  echo "⚠ DNS de $DOMAIN ainda não aponta para $IP. Crie o registro A e rode este script de novo."
fi

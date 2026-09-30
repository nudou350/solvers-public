#!/usr/bin/env bash
# Preparação única da VPS para o Solvers (rodar NA VPS como deploy, com sudo).
# Segue o VPS_GUIDE: /var/www/solvers, PM2 solvers-api na 3017, PG16 (5433) + pgvector, nginx + certbot.
set -euo pipefail
APP=/var/www/solvers
DOMAIN=${DOMAIN:-solvers.wondervelop.com}

sudo mkdir -p $APP/{releases,shared,keys,logs,deliverables}
sudo chown -R deploy:deploy $APP
chmod 700 $APP/keys

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

# Verificador da garantia: imagem de testes e acesso ao Docker.
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

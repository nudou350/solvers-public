#!/usr/bin/env bash
# Deploy do Solvers na VPS (rodar na máquina de desenvolvimento, na raiz do repositório).
# Envia o commit atual (git archive), instala, compila, migra e recarrega o PM2.
#   bash infra/deploy.sh            # usa deploy@<VPS_IP>
set -euo pipefail
HOST=${DEPLOY_HOST:-deploy@<VPS_IP>}
APP=/var/www/solvers
SHA=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- apps packages agents infra programs scripts)" ]; then
  echo "Há mudanças não commitadas; o deploy envia só o que está no commit $SHA." >&2
fi

echo "▶ enviando $SHA"
git archive --format=tar HEAD | ssh "$HOST" "set -e; mkdir -p $APP/releases/$SHA && tar -x -C $APP/releases/$SHA"

ssh "$HOST" bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
SHA=$1
APP=/var/www/solvers
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
command -v pnpm >/dev/null || corepack enable pnpm
cd $APP/releases/$SHA
# O .env e as chaves ficam fora do release.
ln -sfn $APP/shared/.env apps/server/.env
pnpm install --frozen-lockfile --prod=false >/dev/null
pnpm --filter @solvers/shared --filter @solvers/client --filter @solvers/chain --filter @solvers/server build
ln -sfn $APP/releases/$SHA $APP/app
ln -sfn $APP/app/apps/server $APP/backend
ln -sfn $APP/app/agents $APP/agents
cd $APP/backend && node --env-file=.env dist/db/migrate.js
# Imagem do verificador da garantia (só reconstrói se o harness mudar).
docker build -q -t solvers-react-test $APP/app/agents/frontend-react/verifier >/dev/null && echo "✔ imagem solvers-react-test"
cd $APP
if pm2 describe solvers-api >/dev/null 2>&1; then pm2 reload solvers-api --update-env; else pm2 start app/infra/ecosystem.config.cjs; fi
pm2 save >/dev/null
# Mantém só os 3 releases mais recentes.
ls -1t $APP/releases | tail -n +4 | xargs -r -I{} rm -rf $APP/releases/{}
sleep 3; curl -fsS http://127.0.0.1:3017/health && echo " ✔ solvers-api no ar ($SHA)"
REMOTE

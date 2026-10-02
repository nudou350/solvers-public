#!/usr/bin/env bash
# Deploy do Solvers na VPS (rodar na máquina de desenvolvimento, na raiz do repositório).
# Envia o commit atual (git archive), instala, compila (API e vitrine), prepara o release
# (imagem do verificador e migração, ainda sem ativar), troca os symlinks, recarrega o PM2 e
# confere a saúde. Se algo falhar depois da troca, volta sozinho ao release anterior.
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
APP=${APP_DIR:-/var/www/solvers}          # APP_DIR só existe para simulação local; na VPS vale o padrão
REL=$APP/releases/$SHA
HEALTH_TRIES=${HEALTH_TRIES:-15}          # 15 x 2 s = ~30 s de observação
HEALTH_INTERVAL=${HEALTH_INTERVAL:-2}
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
command -v pnpm >/dev/null || corepack enable pnpm

# ---- 1. Prepara o release novo (nada aqui mexe no que está no ar) ----
cd "$REL"
# O .env e as chaves ficam fora do release.
ln -sfn "$APP/shared/.env" apps/server/.env
# Dados de criadores (ZIPs enviados e pacotes publicados) vivem em shared/, fora do release: sobrevivem à limpeza abaixo.
# Só o usuário do deploy lê (o nginx não precisa). Nunca apagados por este script.
mkdir -p "$APP/shared/submissions" "$APP/shared/packages"
chmod 700 "$APP/shared/submissions" "$APP/shared/packages"
# Sem estas variáveis o servidor gravaria em ./data dentro do release, que o deploy apaga. Falha aqui, antes de trocar qualquer coisa.
for V in SUBMISSIONS_DIR PUBLISHED_DIR; do
  grep -q "^$V=." "$APP/shared/.env" || { echo "✖ $V não está definida em $APP/shared/.env (veja infra/.env.example)" >&2; exit 1; }
done
grep -q "^ADMIN_WALLETS=." "$APP/shared/.env" || echo "⚠ ADMIN_WALLETS vazia em $APP/shared/.env: ninguém consegue revisar submissões no site" >&2
pnpm install --frozen-lockfile --prod=false >/dev/null
pnpm --filter @solvers/shared --filter @solvers/client --filter @solvers/chain --filter @solvers/server build
# Vitrine: as variáveis NEXT_PUBLIC_* (ex: NEXT_PUBLIC_PRIVY_APP_ID) entram no build; ficam em shared/web.env.
pnpm --filter @solvers/api-client build
( set -a; [ -f "$APP/shared/web.env" ] && . "$APP/shared/web.env"; set +a; pnpm --filter @solvers/web build )
# Imagem do verificador da garantia (só reconstrói se o harness mudar).
docker build -q -t solvers-react-test "$REL/agents/frontend-react/verifier" >/dev/null
echo "✔ imagem solvers-react-test"
# Migração a partir do release novo. Como o banco é compartilhado com o código que ainda está no ar,
# as migrações precisam ser compatíveis com o release anterior (só aditivas).
( cd "$REL/apps/server" && node --env-file=.env dist/db/migrate.js )

# ---- 2. Ativa, com rollback automático ----
pm2_info() { # pm2_info <processo> <restart_time|status>
  pm2 jlist 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const line = s.split("\n").filter((l) => l.startsWith("[")).pop() || "[]";
      const p = JSON.parse(line).find((x) => x.name === process.argv[1]);
      console.log(p ? p.pm2_env[process.argv[2]] : "");
    });' "$1" "$2"
}

swap_link() { # troca atômica: swap_link <nome> <destino>
  ln -sfn "$2" "$APP/.$1.new" && mv -T "$APP/.$1.new" "$APP/$1"
}

activate() { # activate <release>
  swap_link app "$1"
  swap_link backend "$APP/app/apps/server"
  swap_link frontend "$APP/app/apps/web"
  swap_link agents "$APP/app/agents"
}

# O worker só existe a partir do release que traz dist/worker/index.js. Num rollback para um release sem ele, o processo é
# parado (não removido) em vez de entrar em crash loop.
has_worker() { [ -f "$APP/app/apps/server/dist/worker/index.js" ]; }

reload_all() {
  cd "$APP"
  local PROCS=(solvers-api solvers-web)
  has_worker && PROCS+=(solvers-worker)
  for P in "${PROCS[@]}"; do
    if [ "$P" = solvers-worker ] && [ -n "$(pm2_info "$P" status)" ] && [ "$(pm2_info "$P" status)" != online ]; then
      pm2 restart "$P" --update-env   # worker parado por um rollback anterior: reload não garante religar
    elif pm2 describe "$P" >/dev/null 2>&1; then pm2 reload "$P" --update-env; else pm2 start app/infra/ecosystem.config.cjs --only "$P"; fi
  done
  if ! has_worker; then pm2 stop solvers-worker >/dev/null 2>&1 || true; fi
}

# O reload do solvers-api derruba as conexões abertas, inclusive um upload de ZIP em andamento (o criador reenvia).
# Antes de recarregar, espera (até UPLOAD_WAIT s) enquanto algum SUBMISSIONS_DIR/<id>/package.zip* estiver sendo gravado
# (mtime dos últimos 10 s); depois segue de qualquer jeito. Um upload mais longo que isso ainda é cortado.
wait_for_uploads() {
  local waited=0 dir="$APP/shared/submissions"
  while [ "$waited" -lt "${UPLOAD_WAIT:-120}" ] && [ -n "$(find "$dir" -type f -name 'package.zip*' -newermt '10 seconds ago' 2>/dev/null | head -n 1)" ]; do
    [ "$waited" -eq 0 ] && echo "… upload em andamento em $dir; aguardando até ${UPLOAD_WAIT:-120}s antes de recarregar"
    sleep 5; waited=$((waited + 5))
  done
}

PREV=$(readlink -f "$APP/app" 2>/dev/null || true)
SWITCHED=0
DONE=0

rollback() {
  set +e
  trap - EXIT
  echo "✖ deploy de $SHA falhou depois da troca de release" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "↩ voltando para $(basename "$PREV")" >&2
    activate "$PREV"
    reload_all
    echo "↩ rollback concluído; o release $SHA continua em $REL para diagnóstico" >&2
  else
    echo "Sem release anterior para restaurar; verifique 'pm2 logs solvers-api'." >&2
  fi
  exit 1
}
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$SWITCHED" -eq 1 ] && [ "$DONE" -eq 0 ]; then rollback; fi
  exit "$rc"
}
trap on_exit EXIT

wait_for_uploads
SWITCHED=1
activate "$REL"
reload_all

# ---- 3. Health check (~30 s): responde, não reinicia sozinho e fica online ----
# O worker não serve HTTP: só se confere que ficou online e não entrou em crash loop (como api e web).
BASE_API=$(pm2_info solvers-api restart_time); BASE_WEB=$(pm2_info solvers-web restart_time); BASE_WORKER=$(pm2_info solvers-worker restart_time)
streak=0
for _ in $(seq 1 "$HEALTH_TRIES"); do
  sleep "$HEALTH_INTERVAL"
  if [ "$(pm2_info solvers-api restart_time)" != "$BASE_API" ] || [ "$(pm2_info solvers-web restart_time)" != "$BASE_WEB" ] \
    || [ "$(pm2_info solvers-worker restart_time)" != "$BASE_WORKER" ]; then
    echo "✖ um processo do PM2 reiniciou sozinho depois do reload (crash loop)" >&2; exit 1
  fi
  if curl -fsS --max-time 5 http://127.0.0.1:3017/health >/dev/null 2>&1 && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:4017/ >/dev/null 2>&1; then
    streak=$((streak + 1))
  else
    streak=0
  fi
done
if [ "$streak" -lt 3 ]; then echo "✖ health check não ficou estável (ok consecutivos: $streak)" >&2; exit 1; fi
for P in solvers-api solvers-web $(has_worker && echo solvers-worker); do
  [ "$(pm2_info "$P" status)" = "online" ] || { echo "✖ $P não está online" >&2; exit 1; }
done
echo "✔ solvers-api e solvers-web$(has_worker && echo ' e solvers-worker') no ar ($SHA)"

DONE=1
pm2 save >/dev/null

# ---- 4. Limpeza: mantém o ativo, o anterior e o mais recente dos demais ----
KEEP=(-e "$SHA")
[ -n "$PREV" ] && KEEP+=(-e "$(basename "$PREV")")
ls -1t "$APP/releases" | grep -vxF "${KEEP[@]}" | tail -n +2 | xargs -r -I{} rm -rf "$APP/releases/{}" || true
REMOTE

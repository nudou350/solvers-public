#!/usr/bin/env bash
# Compila o programa Anchor (rodar no WSL/Linux com Solana CLI, Anchor, rsync e pnpm) e publica o IDL
# no cliente TypeScript. Falha se qualquer etapa falhar ou se o .so/IDL não forem gerados agora.
#   bash scripts/chain/build-program.sh
#   SKIP_CLIENT_GEN=1 bash scripts/chain/build-program.sh   # sem pnpm (só programa + IDL copiado)
#   STRICT_CLIENT=1 ...                                      # falha se o cliente gerado mudou no git
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
need anchor "Instale o Anchor (avm) e confira ~/.avm/bin ou ~/.cargo/bin."
need cargo "Instale o Rust (rustup); esperado em ~/.cargo/bin."
need rsync "sudo apt install rsync"
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}
DST=$HOME/solvers-build
KEY=$HOME/solvers-keys/program.json
[ -s "$KEY" ] || { echo "falta $KEY (keypair do programa)" >&2; exit 1; }

mkdir -p "$DST/target/deploy"
rsync -a --delete --exclude node_modules --exclude target --exclude .git --exclude apps --exclude .turbo "$SRC/" "$DST/"
cp "$KEY" "$DST/target/deploy/solvers-keypair.json"
cd "$DST"

# Remove os artefatos antigos: um build que falha não pode ser "salvo" por arquivos de execuções anteriores.
rm -f target/deploy/solvers.so target/idl/solvers.json target/types/solvers.ts

# O log vai para arquivo para o status do anchor não se perder num pipe; mostramos só o fim.
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
if ! anchor build --arch "${ARCH:-v1}" >"$LOG" 2>&1; then
  grep -v -E '^\s*Compiling' "$LOG" | tail -n "${TAILN:-60}" || true
  echo "✖ anchor build falhou" >&2
  exit 1
fi
{ grep -v -E '^\s*Compiling' "$LOG" || true; } | tail -n "${TAILN:-60}"

[ -s target/deploy/solvers.so ] || { echo "✖ anchor build não gerou target/deploy/solvers.so" >&2; exit 1; }
[ -s target/idl/solvers.json ] || { echo "✖ anchor build não gerou target/idl/solvers.json" >&2; exit 1; }

mkdir -p "$SRC/target/idl" "$SRC/target/types" "$SRC/target/deploy"
cp target/idl/solvers.json "$SRC/target/idl/"
cp target/idl/solvers.json "$SRC/packages/solvers-client/idl/"
[ ! -f target/types/solvers.ts ] || cp target/types/solvers.ts "$SRC/target/types/"
cp target/deploy/solvers.so "$SRC/target/deploy/"
ls -la target/deploy

# Cliente TypeScript (Codama) a partir do IDL novo, e compilação para validar que ele fecha.
if [ "${SKIP_CLIENT_GEN:-0}" = "1" ]; then
  echo "⚠ SKIP_CLIENT_GEN=1: cliente não regenerado; rode 'pnpm --filter @solvers/client generate' depois." >&2
else
  command -v pnpm >/dev/null || { echo "✖ pnpm não encontrado; instale-o ou use SKIP_CLIENT_GEN=1" >&2; exit 1; }
  (
    cd "$SRC"
    pnpm --filter @solvers/client generate
    pnpm --filter @solvers/client build
    if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1 && ! git diff --quiet -- packages/solvers-client; then
      echo "⚠ o cliente/IDL mudou em relação ao git: revise e commite packages/solvers-client." >&2
      [ "${STRICT_CLIENT:-0}" != "1" ] || exit 1
    fi
  )
fi
echo "✔ programa compilado e cliente gerado"

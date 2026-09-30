#!/usr/bin/env bash
# Testes LiteSVM do programa (rodar no WSL/Linux). Os testes carregam $DST/target/deploy/solvers.so,
# então o script exige um .so mais novo que o código-fonte, ou reconstrói com BUILD=1.
#   bash scripts/chain/test-program.sh
#   BUILD=1 bash scripts/chain/test-program.sh     # roda build-program.sh antes
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
need cargo "Instale o Rust (rustup); esperado em ~/.cargo/bin."
need rsync "sudo apt install rsync"
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}
DST=$HOME/solvers-build
SO=$DST/target/deploy/solvers.so

if [ "${BUILD:-0}" = "1" ]; then
  SRC=$SRC bash "$SRC/scripts/chain/build-program.sh"
fi

mkdir -p "$DST"
rsync -a --exclude node_modules --exclude target --exclude .git --exclude apps --exclude .turbo "$SRC/" "$DST/"

[ -s "$SO" ] || { echo "✖ falta $SO: rode scripts/chain/build-program.sh (ou BUILD=1)" >&2; exit 1; }
STALE=$(find "$DST/programs/solvers/src" "$DST/programs/solvers/Cargo.toml" "$DST/Cargo.toml" "$DST/Cargo.lock" -type f -newer "$SO" -print | head -n 5)
if [ -n "$STALE" ]; then
  echo "✖ $SO é mais antigo que o código do programa; os testes usariam um binário velho:" >&2
  echo "$STALE" >&2
  echo "Rode scripts/chain/build-program.sh (ou BUILD=1)." >&2
  exit 1
fi

cd "$DST"
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
STATUS=0
cargo test -p solvers --test program >"$LOG" 2>&1 || STATUS=$?
{ grep -v -E '^\s*(Compiling|Downloaded|Downloading)' "$LOG" || true; } | tail -n "${TAILN:-80}"
if [ "$STATUS" -ne 0 ]; then echo "✖ cargo test falhou (status $STATUS)" >&2; exit "$STATUS"; fi
# Garante que algum teste realmente rodou (0 testes também sai com status 0).
grep -E 'test result: ok\. [1-9][0-9]* passed' "$LOG" >/dev/null || { echo "✖ nenhum teste executado" >&2; exit 1; }
echo "✔ testes do programa passaram"

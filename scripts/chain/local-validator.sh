#!/usr/bin/env bash
# Validador local com o programa e o Metaplex Core (rodar no WSL/Linux, a partir de qualquer pasta).
#   bash scripts/chain/local-validator.sh
#   EXTRA_ARGS="--slots-per-epoch 100000000" bash scripts/chain/local-validator.sh   # flags extras (e2e-v2 usa isto para poder avançar o relógio)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
# Resolve os caminhos do projeto antes de qualquer cd (o $0 pode ser relativo).
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}
SO=${SO:-$HOME/solvers-build/target/deploy/solvers.so}
FIXTURE=$SRC/programs/solvers/tests/fixtures/mpl_core.so
LEDGER=${LEDGER:-$HOME/solvers-ledger}

need solana-test-validator "Instale a Solana CLI; esperado em ~/.local/share/solana/install/active_release/bin."
[ -s "$SO" ] || { echo "✖ falta $SO: rode scripts/chain/build-program.sh" >&2; exit 1; }
[ -s "$FIXTURE" ] || { echo "✖ falta $FIXTURE" >&2; exit 1; }

cd "$HOME"
exec solana-test-validator --reset --quiet --limit-ledger-size 50000000 --ledger "$LEDGER" \
  --upgradeable-program DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW "$SO" EA2Nz3yBuF28hHC4xYBnSR4B3bJVWuDUt3VSsCV9KoGr \
  --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d "$FIXTURE" \
  --mint J4riUZWJELvMbYwcXuQ3iDHcF6LaFFEmSXDLH618AGy4 ${EXTRA_ARGS:-}

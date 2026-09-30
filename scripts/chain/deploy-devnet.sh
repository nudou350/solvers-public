#!/bin/bash
# Deploy do programa na devnet (rodar no WSL/Linux com Solana CLI e Anchor instalados).
# Pré-requisito: carteira admin (~/solvers-keys/admin.json) com ~5 SOL de devnet (https://faucet.solana.com).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
need solana "Instale a Solana CLI; esperado em ~/.local/share/solana/install/active_release/bin."
need solana-keygen "Instale a Solana CLI."
KEYS=${KEYS_DIR:-$HOME/solvers-keys}
SO=${SO:-$HOME/solvers-build/target/deploy/solvers.so}
[ -s "$SO" ] || { echo "falta $SO: rode scripts/chain/build-program.sh" >&2; exit 1; }
solana config set --url https://api.devnet.solana.com --keypair $KEYS/admin.json >/dev/null
echo "Admin: $(solana address) saldo: $(solana balance)"
solana program deploy $SO --program-id $KEYS/program.json --keypair $KEYS/admin.json --upgrade-authority $KEYS/admin.json --with-compute-unit-price 1000
solana program show $(solana-keygen pubkey $KEYS/program.json)

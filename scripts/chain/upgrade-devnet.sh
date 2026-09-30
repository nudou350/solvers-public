#!/usr/bin/env bash
# Atualiza (upgrade) o programa na devnet, no MESMO program id. Rodar no WSL/Linux com a Solana CLI.
#   bash scripts/chain/upgrade-devnet.sh          # dry-run (padrão): só LÊ da devnet e imprime o plano
#   bash scripts/chain/upgrade-devnet.sh --yes    # executa (escreve na devnet; o --yes é a autorização)
#   ... --yes --return-excess                     # ao final devolve ao fee-payer o que sobrar no admin acima de 0,5 SOL
# Com --yes, nesta ordem: backup do .so em produção -> transferência fee-payer -> admin (se faltar saldo)
# -> `solana program extend` (se o .so cresceu) -> upgrade -> conferência -> saldo final do admin
# (sem --return-excess nada é devolvido ao fee-payer).
# Variáveis: KEYS_DIR (~/solvers-keys), SO (~/solvers-build/target/deploy/solvers.so), BACKUP_DIR
# (~/solvers-build/backup), RPC_URL (devnet pública), MARGIN_BYTES (1024), FEE_MARGIN_LAMPORTS (50000000),
# FEEPAYER_RESERVE_LAMPORTS (1000000000), ADMIN_KEEP_LAMPORTS (500000000).
# Nunca imprime conteúdo de chaves: só endereços públicos.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

YES=0
RETURN_EXCESS=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --return-excess) RETURN_EXCESS=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "✖ argumento desconhecido: $a (use --yes ou nada)" >&2; exit 2 ;;
  esac
done
[ "$RETURN_EXCESS" = 0 ] || [ "$YES" = 1 ] || { echo "✖ --return-excess só vale junto com --yes" >&2; exit 2; }

die() { echo "✖ $*" >&2; exit 1; }

need solana "Instale a Solana CLI; esperado em ~/.local/share/solana/install/active_release/bin."
need solana-keygen "Instale a Solana CLI."
need awk "sudo apt install gawk"
need cmp "sudo apt install diffutils"
need sha256sum "coreutils"

KEYS=${KEYS_DIR:-$HOME/solvers-keys}
SO=${SO:-$HOME/solvers-build/target/deploy/solvers.so}
BACKUP_DIR=${BACKUP_DIR:-$HOME/solvers-build/backup}
URL=${RPC_URL:-https://api.devnet.solana.com}
MARGIN_BYTES=${MARGIN_BYTES:-1024}
FEE_MARGIN=${FEE_MARGIN_LAMPORTS:-50000000}      # 0,05 SOL para taxas e sobra mínima na conta do admin
FEEPAYER_RESERVE=${FEEPAYER_RESERVE_LAMPORTS:-1000000000}  # o fee-payer também paga taxas/rent do servidor: deve manter 1 SOL
ADMIN_KEEP=${ADMIN_KEEP_LAMPORTS:-500000000}     # --return-excess: o admin fica com este saldo (0,5 SOL)
ROUND=100000000                                  # transferência arredondada para cima em 0,1 SOL
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
EXTEND_CHUNK=10240                               # o loader exige blocos de EXATAMENTE 10240 bytes (mínimo = máximo por instrução)
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}

# --- pré-requisitos (aborta antes de qualquer escrita) -------------------------------------------------
for k in admin fee-payer program; do
  [ -s "$KEYS/$k.json" ] || die "falta a keypair $KEYS/$k.json"
done
[ -s "$SO" ] || die "falta $SO: rode scripts/chain/build-program.sh"
[ "$(head -c4 "$SO" | od -An -c | tr -d ' ')" = '177ELF' ] || die "$SO não parece um ELF (.so inválido)"

GENESIS=$(solana genesis-hash --url "$URL" 2>/dev/null) || die "não consegui consultar $URL"
[ "$GENESIS" = "$DEVNET_GENESIS" ] || die "a rede em $URL NÃO é a devnet (genesis $GENESIS). Abortando."

ADMIN=$(solana-keygen pubkey "$KEYS/admin.json")
FEEPAYER=$(solana-keygen pubkey "$KEYS/fee-payer.json")
PROGRAM=$(solana-keygen pubkey "$KEYS/program.json")

# --- estado atual on-chain ------------------------------------------------------------------------------
SHOW=$(solana program show "$PROGRAM" --url "$URL") || die "o programa $PROGRAM não existe na devnet (use deploy-devnet.sh)"
show_field() { printf '%s\n' "$SHOW" | sed -n "s/^$1: *//p" | head -n1; }
AUTH=$(show_field "Authority")
[ "$AUTH" = "$ADMIN" ] || die "upgrade authority on-chain ($AUTH) ≠ admin.json ($ADMIN): esta keypair não consegue atualizar"
CUR_LEN=$(show_field "Data Length" | awk '{print $1}')
CUR_SLOT=$(show_field "Last Deployed In Slot")
[[ "$CUR_LEN" =~ ^[0-9]+$ && "$CUR_SLOT" =~ ^[0-9]+$ ]] || die "não consegui ler Data Length/Slot de 'solana program show'"

NEW_LEN=$(stat -c %s "$SO")

# .so mais velho que o código do programa = binário desatualizado (mesma regra do test-program.sh)
STALE=$(find "$SRC/programs/solvers/src" "$SRC/programs/solvers/Cargo.toml" "$SRC/Cargo.toml" "$SRC/Cargo.lock" \
  -type f -newer "$SO" -print 2>/dev/null | head -n 5 || true)

# --- custos (tudo em lamports) --------------------------------------------------------------------------
rent() { solana rent "$1" --lamports --url "$URL" | awk '/Rent-exempt minimum/ {print $3}'; }
sol() { awk -v l="$1" 'BEGIN { s = ""; if (l < 0) { s = "-"; l = -l } printf "%s%d.%09d", s, int(l/1000000000), l%1000000000 }'; }
bal() { solana balance "$1" --lamports --url "$URL" | awk '{print $1}'; }

if [ "$NEW_LEN" -gt "$CUR_LEN" ]; then
  EXTEND=$(( (NEW_LEN - CUR_LEN + MARGIN_BYTES + EXTEND_CHUNK - 1) / EXTEND_CHUNK * EXTEND_CHUNK ))  # múltiplo de 10240
else EXTEND=0; fi
BUFFER_RENT=$(rent $((37 + NEW_LEN)))            # buffer: 37 bytes de cabeçalho + .so (devolvido ao final)
if [ "$EXTEND" -gt 0 ]; then
  # ProgramData: 45 bytes de cabeçalho + .so
  EXTEND_RENT=$(( $(rent $((45 + CUR_LEN + EXTEND))) - $(rent $((45 + CUR_LEN))) ))
else
  EXTEND_RENT=0
fi
NEED=$((BUFFER_RENT + EXTEND_RENT + FEE_MARGIN))
ADMIN_BAL=$(bal "$ADMIN")
FP_BAL=$(bal "$FEEPAYER")
if [ "$ADMIN_BAL" -ge "$NEED" ]; then
  TRANSFER=0
else
  MISSING=$((NEED - ADMIN_BAL))
  TRANSFER=$(( (MISSING + ROUND - 1) / ROUND * ROUND ))
fi
FP_AFTER=$((FP_BAL - TRANSFER))

SOURCE_TAG=$(date +%Y%m%d-%H%M%S)
BACKUP="$BACKUP_DIR/solvers-slot${CUR_SLOT}-${SOURCE_TAG}.so"

# --- plano ----------------------------------------------------------------------------------------------
echo "== Plano de upgrade na devnet ($([ "$YES" = 1 ] && echo EXECUÇÃO || echo DRY-RUN, nada será escrito)) =="
echo "Programa ............ $PROGRAM"
echo "Admin (authority) ... $ADMIN   saldo $(sol "$ADMIN_BAL") SOL"
echo "Fee-payer ........... $FEEPAYER   saldo $(sol "$FP_BAL") SOL"
echo "ProgramData atual ... $CUR_LEN bytes (último deploy no slot $CUR_SLOT)"
echo "Novo .so ............ $NEW_LEN bytes  ($SO, $(sha256sum "$SO" | cut -c1-16)…)"
if [ "$EXTEND" -gt 0 ]; then
  echo "Extensão ............ +$EXTEND bytes (= $((NEW_LEN - CUR_LEN)) de crescimento + $MARGIN_BYTES de margem, arredondado para blocos de $EXTEND_CHUNK) -> depósito $(sol "$EXTEND_RENT") SOL"
else
  echo "Extensão ............ não precisa (o novo .so cabe: $NEW_LEN <= $CUR_LEN)"
fi
echo "Buffer do upgrade ... $(sol "$BUFFER_RENT") SOL (emprestado; volta ao admin ao final)"
echo "Margem p/ taxas ..... $(sol "$FEE_MARGIN") SOL"
echo "Admin precisa ....... $(sol "$NEED") SOL  | tem $(sol "$ADMIN_BAL") SOL"
if [ "$TRANSFER" -gt 0 ]; then
  echo "Transferência ....... $(sol "$TRANSFER") SOL do fee-payer para o admin (fee-payer fica com $(sol "$FP_AFTER") SOL)"
else
  echo "Transferência ....... nenhuma (saldo do admin já basta)"
fi
echo "Reserva do fee-payer  $(sol "$FEEPAYER_RESERVE") SOL mínimos após a transferência$([ "$RETURN_EXCESS" = 1 ] && echo "; ao final devolve o excedente do admin acima de $(sol "$ADMIN_KEEP") SOL")"
echo "Backup do .so atual . $BACKUP"
BUFFERS=$(solana program show --buffers --buffer-authority "$ADMIN" --url "$URL" 2>/dev/null | grep -Ev '^(Buffer Address|-+)' || true)
if [ -n "$(printf '%s' "$BUFFERS" | tr -d '[:space:]')" ]; then
  echo "⚠ buffers antigos do admin (SOL preso de upgrade que falhou; 'solana program close --buffers' recupera):"
  printf '%s\n' "$BUFFERS"
fi

BLOCK=0
if [ -n "$STALE" ]; then
  BLOCK=1
  echo "✖ $SO é mais antigo que o código do programa; o upgrade publicaria um binário velho:" >&2
  echo "$STALE" >&2
  echo "  Rode scripts/chain/build-program.sh." >&2
fi
if [ "$TRANSFER" -gt 0 ] && [ "$FP_AFTER" -lt "$FEEPAYER_RESERVE" ]; then
  BLOCK=1
  echo "✖ o fee-payer ($(sol "$FP_BAL") SOL) não cobre a transferência de $(sol "$TRANSFER") SOL mantendo $(sol "$FEEPAYER_RESERVE") SOL de reserva." >&2
fi

if [ "$YES" != 1 ]; then
  echo
  if [ "$BLOCK" = 1 ]; then echo "✖ dry-run: há impedimentos acima; corrija antes de usar --yes." >&2; exit 1; fi
  echo "✔ dry-run concluído, nada foi escrito. Para executar: bash scripts/chain/upgrade-devnet.sh --yes"
  exit 0
fi
[ "$BLOCK" = 0 ] || die "impedimentos acima; nenhuma escrita foi feita."

# --- execução (escreve na devnet) -----------------------------------------------------------------------
trap 'echo "✖ falhou durante o upgrade. Nada foi revertido automaticamente. Confira: solana program show '"$PROGRAM"' --url '"$URL"'; buffers presos: solana program show --buffers --buffer-authority '"$ADMIN"' --url '"$URL"' (recupere com solana program close --buffers). Rollback: veja docs/devnet-upgrade.md." >&2' ERR

echo; echo "[1/6] backup do .so em produção"
mkdir -p "$BACKUP_DIR"
solana program dump "$PROGRAM" "$BACKUP" --url "$URL" >/dev/null
[ -s "$BACKUP" ] || die "backup vazio: $BACKUP"
cp "$SO" "$BACKUP_DIR/solvers-novo-${SOURCE_TAG}.so"
echo "     $BACKUP ($(stat -c %s "$BACKUP") bytes, sha256 $(sha256sum "$BACKUP" | cut -c1-16)…)"

echo "[2/6] saldo do admin"
if [ "$TRANSFER" -gt 0 ]; then
  echo "     transferindo $(sol "$TRANSFER") SOL: fee-payer $FEEPAYER -> admin $ADMIN (autorizado por --yes)"
  solana transfer --from "$KEYS/fee-payer.json" --fee-payer "$KEYS/fee-payer.json" "$ADMIN" "$(sol "$TRANSFER")" \
    --allow-unfunded-recipient --url "$URL"
else
  echo "     suficiente, sem transferência"
fi

echo "[3/6] extensão do ProgramData"
if [ "$EXTEND" -gt 0 ]; then
  LEFT=$EXTEND
  while [ "$LEFT" -gt 0 ]; do
    STEP=$EXTEND_CHUNK
    solana program extend "$PROGRAM" "$STEP" --keypair "$KEYS/admin.json" --url "$URL"
    LEFT=$((LEFT - STEP))
  done
else
  echo "     não necessária"
fi

echo "[4/6] upgrade"
solana program deploy "$SO" --program-id "$KEYS/program.json" --upgrade-authority "$KEYS/admin.json" \
  --keypair "$KEYS/admin.json" --url "$URL" --with-compute-unit-price 1000

echo "[5/6] conferência"
SHOW=$(solana program show "$PROGRAM" --url "$URL")
NEW_SLOT=$(show_field "Last Deployed In Slot")
AFTER_LEN=$(show_field "Data Length" | awk '{print $1}')
[ "$NEW_SLOT" -gt "$CUR_SLOT" ] || die "Last Deployed Slot não mudou ($CUR_SLOT -> $NEW_SLOT): o upgrade não foi aplicado"
[ "$AFTER_LEN" -ge "$NEW_LEN" ] || die "Data Length on-chain ($AFTER_LEN) < novo .so ($NEW_LEN)"
CHK=$(mktemp); trap 'rm -f "$CHK"' EXIT
solana program dump "$PROGRAM" "$CHK" --url "$URL" >/dev/null
cmp -n "$NEW_LEN" "$CHK" "$SO" || die "o conteúdo on-chain difere do .so enviado"
echo "     slot $CUR_SLOT -> $NEW_SLOT, Data Length $CUR_LEN -> $AFTER_LEN, conteúdo idêntico ao .so ($NEW_LEN bytes)"

echo "[6/6] saldos finais"
END_BAL=$(bal "$ADMIN")
END_FP=$(bal "$FEEPAYER")
echo "     admin ....... $(sol "$END_BAL") SOL (antes de tudo: $(sol "$ADMIN_BAL"))"
echo "     fee-payer ... $(sol "$END_FP") SOL (antes de tudo: $(sol "$FP_BAL"))"
if [ "$RETURN_EXCESS" = 1 ]; then
  BACK=$((END_BAL - ADMIN_KEEP))
  if [ "$BACK" -gt 0 ]; then
    echo "     devolvendo $(sol "$BACK") SOL do admin ao fee-payer (admin fica com ~$(sol "$ADMIN_KEEP") SOL; autorizado por --return-excess)"
    solana transfer --from "$KEYS/admin.json" --fee-payer "$KEYS/admin.json" "$FEEPAYER" "$(sol "$BACK")" --url "$URL"
    echo "     admin ....... $(sol "$END_BAL") -> $(sol "$(bal "$ADMIN")") SOL"
    echo "     fee-payer ... $(sol "$END_FP") -> $(sol "$(bal "$FEEPAYER")") SOL"
  else
    echo "     nada a devolver (admin com $(sol "$END_BAL") SOL, abaixo de $(sol "$ADMIN_KEEP"))"
  fi
else
  echo "     (nada devolvido ao fee-payer; use --return-excess ou 'solana transfer' depois)"
fi
echo "✔ upgrade concluído. Backup do .so anterior: $BACKUP"
echo "  Próximos passos e rollback: docs/devnet-upgrade.md"

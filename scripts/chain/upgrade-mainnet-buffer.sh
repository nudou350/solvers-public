#!/usr/bin/env bash
# Prepara um upgrade do programa na MAINNET sem NUNCA tocar na upgrade authority (que é o vault do Squads v4).
# Este script só cria e entrega o BUFFER; quem executa o upgrade é a proposta aprovada (2 de 3) no Squads.
#   bash scripts/chain/upgrade-mainnet-buffer.sh --squad-vault <vault> --program-id <programa> --deploy-key <arquivo>          # dry-run
#   bash scripts/chain/upgrade-mainnet-buffer.sh --squad-vault <vault> --program-id <programa> --deploy-key <arquivo> --yes    # grava
#   ... --rehearsal-devnet                 # ensaio na devnet (genesis da devnet, RPC da devnet) com um Squad de teste
# Dry-run (padrão): só LÊ da rede e imprime o plano (hash do .so, saldo, custos). Com --yes: write-buffer com a chave de DEPLOY,
# set-buffer-authority para o vault, conferência do buffer (autoridade + conteúdo) e hash do buffer. Não assina nada com a
# upgrade authority e não faz upgrade, extend nem transferência: os próximos passos (extend, proposta no Squads) são impressos.
# A chave de deploy é uma keypair SEPARADA do admin on-chain e da upgrade authority; o script recusa chave com "admin" no nome.
# Variáveis: SO (~/solvers-build/target/deploy/solvers.so), RPC_URL (mainnet pública; use um provedor próprio), SRC (raiz do repo),
# FEE_MARGIN_LAMPORTS (50000000), PRIORITY_MICROLAMPORTS (1000), MARGIN_BYTES (1024), ADMIN_PUBKEY (opcional: recusa se igual à chave de deploy).
# Nunca imprime conteúdo de chaves: só endereços públicos.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

die() { echo "✖ $*" >&2; exit 1; }
usage_err() { echo "✖ $*" >&2; echo "  (veja: bash $0 --help)" >&2; exit 2; }

YES=0
REHEARSAL=0
VAULT=""
PROGRAM=""
DEPLOY_KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --rehearsal-devnet) REHEARSAL=1 ;;
    --squad-vault) [ $# -ge 2 ] || usage_err "--squad-vault exige um endereço"; VAULT=$2; shift ;;
    --program-id) [ $# -ge 2 ] || usage_err "--program-id exige um endereço"; PROGRAM=$2; shift ;;
    --deploy-key) [ $# -ge 2 ] || usage_err "--deploy-key exige o caminho do arquivo"; DEPLOY_KEY=$2; shift ;;
    -h|--help) sed -n '2,/^set -euo/{/^set -euo/!p}' "$0"; exit 0 ;;
    *) usage_err "argumento desconhecido: $1" ;;
  esac
  shift
done
[ -n "$VAULT" ] || usage_err "falta --squad-vault <endereço do vault do Squads>"
[ -n "$PROGRAM" ] || usage_err "falta --program-id <endereço do programa na mainnet>"
[ -n "$DEPLOY_KEY" ] || usage_err "falta --deploy-key <arquivo da keypair de deploy>"

need python3 "sudo apt install python3 (valida endereços base58)"

# b58_32 <texto>: sai 0 se for base58 válido de exatamente 32 bytes (sem tocar na rede).
b58_32() {
  python3 - "$1" <<'PY'
import sys
A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
s = sys.argv[1]
if not s or len(s) > 44:
    sys.exit(1)
n = 0
for c in s:
    i = A.find(c)
    if i < 0:
        sys.exit(1)
    n = n * 58 + i
b = n.to_bytes((n.bit_length() + 7) // 8, "big")
b = b"\0" * (len(s) - len(s.lstrip("1"))) + b
sys.exit(0 if len(b) == 32 else 1)
PY
}
b58_32 "$VAULT" || usage_err "--squad-vault '$VAULT' não é um endereço base58 de 32 bytes"
b58_32 "$PROGRAM" || usage_err "--program-id '$PROGRAM' não é um endereço base58 de 32 bytes"
[ "$VAULT" != "$PROGRAM" ] || usage_err "--squad-vault e --program-id são o mesmo endereço"
case "$(basename "$DEPLOY_KEY" | tr '[:upper:]' '[:lower:]')" in
  *admin*) usage_err "--deploy-key '$DEPLOY_KEY': a chave de deploy NÃO pode ser a do admin (use uma keypair separada)" ;;
esac

need solana "Instale a Solana CLI; esperado em ~/.local/share/solana/install/active_release/bin."
need solana-keygen "Instale a Solana CLI."
need awk "sudo apt install gawk"
need cmp "sudo apt install diffutils"
need sha256sum "coreutils"

MAINNET_GENESIS=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d  # docs.anza.xyz/clusters/available ("Genesis Hashes", conferido em 2026-10-01)
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
if [ "$REHEARSAL" = 1 ]; then
  EXPECT_GENESIS=$DEVNET_GENESIS; NET=devnet; URL=${RPC_URL:-https://api.devnet.solana.com}
else
  EXPECT_GENESIS=$MAINNET_GENESIS; NET=mainnet-beta; URL=${RPC_URL:-https://api.mainnet-beta.solana.com}
fi
SO=${SO:-$HOME/solvers-build/target/deploy/solvers.so}
MARGIN_BYTES=${MARGIN_BYTES:-1024}
FEE_MARGIN=${FEE_MARGIN_LAMPORTS:-50000000}   # 0,05 SOL: ~700 transações do write-buffer + taxa de prioridade + sobra
PRIORITY=${PRIORITY_MICROLAMPORTS:-1000}
EXTEND_CHUNK=10240                            # o loader exige blocos de EXATAMENTE 10240 bytes por instrução de extend
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}

# --- pré-requisitos locais (aborta antes de qualquer escrita) -------------------------------------------
[ -s "$DEPLOY_KEY" ] || die "falta a keypair de deploy $DEPLOY_KEY"
[ -s "$SO" ] || die "falta $SO: gere o binário (build verificável: docs/mainnet-runbook.md; ou scripts/chain/build-program.sh)"
[ "$(head -c4 "$SO" | od -An -c | tr -d ' ')" = '177ELF' ] || die "$SO não parece um ELF (.so inválido)"

DEPLOYER=$(solana-keygen pubkey "$DEPLOY_KEY") || die "não consegui ler a pubkey de $DEPLOY_KEY"
[ "$DEPLOYER" != "$VAULT" ] || die "a chave de deploy não pode ser o próprio vault do Squads"
[ "$DEPLOYER" != "$PROGRAM" ] || die "a chave de deploy não pode ser a keypair do programa"
if [ -n "${ADMIN_PUBKEY:-}" ] && [ "$DEPLOYER" = "$ADMIN_PUBKEY" ]; then die "a chave de deploy é a do admin on-chain (ADMIN_PUBKEY): use uma keypair separada"; fi

# --- rede ------------------------------------------------------------------------------------------------
GENESIS=$(solana genesis-hash --url "$URL" 2>/dev/null) || die "não consegui consultar $URL"
[ "$GENESIS" = "$EXPECT_GENESIS" ] || die "a rede em $URL NÃO é a $NET (genesis $GENESIS, esperado $EXPECT_GENESIS). Abortando."

# --- estado on-chain: o programa precisa existir e ter o vault como upgrade authority ------------------
SHOW=$(solana program show "$PROGRAM" --url "$URL" 2>&1) \
  || die "o programa $PROGRAM não existe na $NET. O deploy inicial é feito com a chave de deploy (docs/mainnet-runbook.md); este script é só para upgrades."
show_field() { printf '%s\n' "$SHOW" | sed -n "s/^$1: *//p" | head -n1; }
AUTH=$(show_field "Authority")
[ "$AUTH" = "$VAULT" ] || die "upgrade authority on-chain ($AUTH) ≠ --squad-vault ($VAULT): o upgrade não passaria pelo Squads informado. Confira os dois endereços (e se o set-upgrade-authority foi feito)."
CUR_LEN=$(show_field "Data Length" | awk '{print $1}')
CUR_SLOT=$(show_field "Last Deployed In Slot")
[[ "$CUR_LEN" =~ ^[0-9]+$ && "$CUR_SLOT" =~ ^[0-9]+$ ]] || die "não consegui ler Data Length/Slot de 'solana program show'"

NEW_LEN=$(stat -c %s "$SO")
SO_SHA=$(sha256sum "$SO" | cut -d' ' -f1)

# .so mais velho que o código do programa = binário desatualizado (mesma regra do upgrade-devnet.sh)
STALE=$(find "$SRC/programs/solvers/src" "$SRC/programs/solvers/Cargo.toml" "$SRC/Cargo.toml" "$SRC/Cargo.lock" \
  -type f -newer "$SO" -print 2>/dev/null | head -n 5 || true)

# --- custos (lamports) -----------------------------------------------------------------------------------
rent() { solana rent "$1" --lamports --url "$URL" | awk '/Rent-exempt minimum/ {print $3}'; }
sol() { awk -v l="$1" 'BEGIN { s = ""; if (l < 0) { s = "-"; l = -l } printf "%s%d.%09d", s, int(l/1000000000), l%1000000000 }'; }
BUFFER_RENT=$(rent $((37 + NEW_LEN)))         # buffer: 37 bytes de cabeçalho + .so (volta ao endereço de reembolso quando o upgrade roda)
if [ "$NEW_LEN" -gt "$CUR_LEN" ]; then
  EXTEND=$(( (NEW_LEN - CUR_LEN + MARGIN_BYTES + EXTEND_CHUNK - 1) / EXTEND_CHUNK * EXTEND_CHUNK ))
  EXTEND_RENT=$(( $(rent $((45 + CUR_LEN + EXTEND))) - $(rent $((45 + CUR_LEN))) ))  # ProgramData: 45 bytes de cabeçalho + .so
else EXTEND=0; EXTEND_RENT=0; fi
NEED=$((BUFFER_RENT + EXTEND_RENT + FEE_MARGIN))
BAL=$(solana balance "$DEPLOYER" --lamports --url "$URL" | awk '{print $1}')
[[ "$BAL" =~ ^[0-9]+$ ]] || die "não consegui ler o saldo de $DEPLOYER"

# --- plano ----------------------------------------------------------------------------------------------
echo "== Buffer de upgrade na $NET ($([ "$YES" = 1 ] && echo EXECUÇÃO || echo DRY-RUN, nada será escrito)) =="
echo "Programa ............ $PROGRAM"
echo "Upgrade authority ... $AUTH (= --squad-vault; este script NÃO a assina)"
echo "Chave de deploy ..... $DEPLOYER   saldo $(sol "$BAL") SOL"
echo "ProgramData atual ... $CUR_LEN bytes (último deploy no slot $CUR_SLOT)"
echo "Novo .so ............ $NEW_LEN bytes  ($SO)"
echo "sha256 do .so ....... $SO_SHA"
if [ "$EXTEND" -gt 0 ]; then
  echo "Extensão ............ +$EXTEND bytes antes da proposta executar -> depósito $(sol "$EXTEND_RENT") SOL (não volta)"
else
  echo "Extensão ............ não precisa (o novo .so cabe: $NEW_LEN <= $CUR_LEN)"
fi
echo "Buffer .............. $(sol "$BUFFER_RENT") SOL (emprestado; volta ao endereço de reembolso quando o upgrade roda)"
echo "Margem p/ taxas ..... $(sol "$FEE_MARGIN") SOL | prioridade $PRIORITY micro-lamports/CU"
echo "Chave de deploy precisa $(sol "$NEED") SOL | tem $(sol "$BAL") SOL"
if command -v solana-verify >/dev/null 2>&1; then echo "solana-verify ....... presente (o hash do buffer será conferido com ele)"
else echo "solana-verify ....... AUSENTE (o hash do buffer será conferido por dump + sha256 do .so)"; fi
BUFFERS=$(solana program show --buffers --buffer-authority "$DEPLOYER" --url "$URL" 2>/dev/null | grep -Ev '^(Buffer Address|-+)' || true)
if [ -n "$(printf '%s' "$BUFFERS" | tr -d '[:space:]')" ]; then
  echo "⚠ buffers antigos da chave de deploy (SOL preso; 'solana program close --buffers' recupera):"
  printf '%s\n' "$BUFFERS"
fi

BLOCK=0
if [ -n "$STALE" ]; then
  BLOCK=1
  echo "✖ $SO é mais antigo que o código do programa; o upgrade publicaria um binário velho:" >&2
  echo "$STALE" >&2
fi
if [ "$BAL" -lt "$NEED" ]; then
  BLOCK=1
  echo "✖ saldo da chave de deploy ($(sol "$BAL") SOL) < necessário ($(sol "$NEED") SOL). Envie SOL de uma carteira SUA para $DEPLOYER (o servidor não financia)." >&2
fi

if [ "$YES" != 1 ]; then
  echo
  if [ "$BLOCK" = 1 ]; then echo "✖ dry-run: há impedimentos acima; corrija antes de usar --yes." >&2; exit 1; fi
  echo "✔ dry-run concluído, nada foi escrito. Confira o vault ($VAULT) contra o painel do Squads e rode de novo com --yes."
  exit 0
fi
[ "$BLOCK" = 0 ] || die "impedimentos acima; nenhuma escrita foi feita."

# --- execução (escreve na rede) --------------------------------------------------------------------------
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
BUFFER=""
trap 'echo "✖ falhou. Nada foi revertido. Buffer criado: ${BUFFER:-(nenhum)}. Buffers presos da chave de deploy: solana program show --buffers --buffer-authority '"$DEPLOYER"' --url '"$URL"' (recupere com solana program close --buffers). Se o set-buffer-authority já rodou, o buffer pertence ao vault e só o Squads o fecha." >&2; rm -rf "$TMP"' ERR

echo; echo "[1/4] write-buffer (assina a chave de deploy $DEPLOYER)"
solana program write-buffer "$SO" --keypair "$DEPLOY_KEY" --url "$URL" --with-compute-unit-price "$PRIORITY" --use-rpc \
  | tee "$TMP/write.out"
BUFFER=$(sed -n 's/^Buffer: *//p' "$TMP/write.out" | head -n1)
b58_32 "$BUFFER" || die "não consegui ler o endereço do buffer da saída do write-buffer"

echo "[2/4] set-buffer-authority -> vault do Squads $VAULT"
solana program set-buffer-authority "$BUFFER" --new-buffer-authority "$VAULT" --keypair "$DEPLOY_KEY" --url "$URL"

echo "[3/4] conferência do buffer"
BSHOW=$(solana program show "$BUFFER" --url "$URL")
BAUTH=$(printf '%s\n' "$BSHOW" | sed -n 's/^Authority: *//p' | head -n1)
[ "$BAUTH" = "$VAULT" ] || die "a autoridade do buffer ($BAUTH) ≠ vault ($VAULT)"
solana program dump "$BUFFER" "$TMP/buffer.bin" --url "$URL" >/dev/null
cmp -n "$NEW_LEN" "$TMP/buffer.bin" "$SO" || die "o conteúdo do buffer difere do .so enviado"
BUF_SHA=$(head -c "$NEW_LEN" "$TMP/buffer.bin" | sha256sum | cut -d' ' -f1)
[ "$BUF_SHA" = "$SO_SHA" ] || die "sha256 do buffer ($BUF_SHA) ≠ sha256 do .so ($SO_SHA)"
echo "     autoridade = vault; conteúdo idêntico ao .so ($NEW_LEN bytes)"

echo "[4/4] hash do buffer"
echo "     sha256 do .so e do buffer ... $SO_SHA"
if command -v solana-verify >/dev/null 2>&1; then
  echo "     solana-verify get-buffer-hash: $(solana-verify get-buffer-hash "$BUFFER" --url "$URL" 2>&1 | tail -n1)"
fi

cat <<EOF

✔ buffer pronto. NADA foi implantado: o programa continua na versão anterior até a proposta do Squads executar.
  Buffer .............. $BUFFER   (autoridade: $VAULT)
  Programa ............ $PROGRAM
  Hash esperado ....... $SO_SHA   (deve ser igual ao do build verificável)

Próximos passos (docs/mainnet-runbook.md, "Upgrade de rotina"):
EOF
if [ "$EXTEND" -gt 0 ]; then
  echo "  0. ANTES da proposta: o .so cresce, então estenda o ProgramData (não exige a authority; paga a chave de deploy):"
  echo "       solana program extend $PROGRAM $EXTEND --keypair $DEPLOY_KEY --url $URL"
fi
cat <<EOF
  1. Compare o hash acima com o do build verificável feito por outra pessoa/máquina (solana-verify get-buffer-hash $BUFFER).
  2. No Squads (vault $VAULT), crie a proposta de upgrade do programa $PROGRAM com o buffer $BUFFER e reembolso do
     rent do buffer para um endereço SEU (ex.: $DEPLOYER). Os outros membros conferem programa, buffer e hash antes de aprovar.
  3. Com 2 de 3 aprovações, execute a proposta. Depois: solana program show $PROGRAM --url $URL (Last Deployed Slot mudou) e
     solana program dump $PROGRAM <arquivo> --url $URL (sha256 igual ao acima).
  4. Se o upgrade não for adiante, feche o buffer pelo Squads para recuperar o SOL (a chave de deploy já não é a autoridade).
EOF

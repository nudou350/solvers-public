#!/usr/bin/env bash
# Backup CRIPTOGRAFADO (AES-256) do que não se pode perder para usar o projeto na devnet. Rodar no WSL,
# no SEU terminal (a senha é digitada aqui, nunca passa por chat nem fica em arquivo):
#   bash scripts/chain/backup-devnet.sh
# Gera um arquivo .tar.gz.gpg na Área de Trabalho do Windows. Variáveis opcionais:
#   OUT_DIR=<pasta>   onde gravar (padrão: Área de Trabalho)       SKIP_DB=1   não inclui o dump do Postgres
#   KEYS_DIR=<pasta>  chaves da devnet (padrão: ~/solvers-keys)    REPO_ROOT=<pasta>  raiz do repositório
#   BACKUP_PASSPHRASE=<senha>  só para teste automatizado; no uso normal deixe o script perguntar.
# Inclui: chaves da devnet, .env do servidor e do web, dump do banco de dev e as notas de memória do Claude.
# NÃO imprime nenhuma chave nem valor de .env. Para abrir:  gpg -d ARQUIVO.tar.gz.gpg | tar xz
set -euo pipefail
umask 077
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ROOT=${REPO_ROOT:-$HERE}
# Dentro de um worktree os arquivos ignorados pelo git (.env etc.) ficam no repositório principal.
case "$ROOT" in */.claude/worktrees/*) ROOT=${ROOT%%/.claude/worktrees/*} ;; esac
KEYS=${KEYS_DIR:-$HOME/solvers-keys}

need gpg "sudo apt install gnupg"
need tar "sudo apt install tar"

winpath() { powershell.exe -NoProfile -Command "$1" 2>/dev/null | tr -d '\r'; }
if [ -z "${OUT_DIR:-}" ]; then
  DESK=$(winpath '[Environment]::GetFolderPath("Desktop")')
  [ -n "$DESK" ] || { echo "✖ não achei a Área de Trabalho; passe OUT_DIR=<pasta>" >&2; exit 1; }
  OUT_DIR=$(wslpath "$DESK")
fi
[ -d "$OUT_DIR" ] || { echo "✖ pasta de saída não existe: $OUT_DIR" >&2; exit 1; }

STAGE=$(mktemp -d /dev/shm/solvers-bkp.XXXXXX 2>/dev/null || mktemp -d)
TGZ="$STAGE.tgz"
cleanup() {
  if command -v shred >/dev/null 2>&1; then find "$STAGE" -type f -exec shred -u {} + 2>/dev/null || true; fi
  rm -rf "$STAGE" "$TGZ"
}
trap cleanup EXIT

copied=0
put() { # put <origem> <destino relativo ao stage>
  local src=$1 dst=$2
  [ -e "$src" ] || { echo "  - ausente (ignorado): $dst"; return 0; }
  mkdir -p "$STAGE/$(dirname "$dst")"
  cp -a "$src" "$STAGE/$dst"
  copied=$((copied + 1))
  echo "  + $dst"
}

echo "Coletando (nenhum conteúdo é impresso):"
if [ -d "$KEYS" ]; then
  mkdir -p "$STAGE/wsl-solvers-keys"
  for f in "$KEYS"/*; do [ -f "$f" ] && put "$f" "wsl-solvers-keys/$(basename "$f")"; done
else
  echo "  ! pasta de chaves não existe: $KEYS"
fi
put "$HOME/.config/solana/solvers-admin.json" "wsl-config-solana/solvers-admin.json"
for rel in apps/server/.env apps/server/.env.devnet apps/server/.env.test apps/server/.keys apps/web/.env.local AGENTS.md; do
  put "$ROOT/$rel" "repo/$rel"
done
WINHOME=$(winpath '$env:USERPROFILE' || true)
if [ -n "$WINHOME" ]; then
  MEM="$(wslpath "$WINHOME")/.claude/projects/C--Users-<user>-Documents-Projetos-solver/memory"
  put "$MEM" "claude-memory"
fi

if [ "${SKIP_DB:-0}" != "1" ] && command -v pg_dump >/dev/null 2>&1 && [ -f "$ROOT/apps/server/.env" ]; then
  DBURL=$(grep -E '^DATABASE_URL=' "$ROOT/apps/server/.env" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true)
  if [ -n "$DBURL" ]; then
    mkdir -p "$STAGE/db"
    if timeout 180 pg_dump --format=custom --no-owner --dbname="$DBURL" --file="$STAGE/db/solvers-dev.dump" 2>/dev/null; then
      copied=$((copied + 1)); echo "  + db/solvers-dev.dump"
    else
      rm -f "$STAGE/db/solvers-dev.dump"; echo "  ! pg_dump falhou (banco desligado?); rode de novo com o Postgres ligado ou SKIP_DB=1"
    fi
  fi
fi
[ "$copied" -gt 0 ] || { echo "✖ nada foi coletado" >&2; exit 1; }

# Manifesto: nomes, tamanhos, hashes e ENDEREÇOS PÚBLICOS das chaves (nunca o conteúdo secreto).
{
  echo "Backup Solvers devnet, $(date -Is)"
  echo
  echo "== Endereços públicos das chaves (wsl-solvers-keys)"
  for f in "$STAGE"/wsl-solvers-keys/*.json; do
    [ -f "$f" ] || continue
    printf '%-18s %s\n' "$(basename "$f" .json)" "$(solana-keygen pubkey "$f" 2>/dev/null || echo '(não é keypair)')"
  done
  echo
  echo "== Arquivos (tamanho, caminho)"
  (cd "$STAGE" && find . -type f -not -name MANIFEST.txt -printf '%s %P\n' | sort -k2)
  echo
  echo "== Como restaurar"
  echo "  wsl-solvers-keys/*      -> ~/solvers-keys/  (chmod 600)"
  echo "  wsl-config-solana/*     -> ~/.config/solana/"
  echo "  repo/<caminho>          -> mesmo caminho dentro do repositório (.env, .env.devnet, .keys, AGENTS.md)"
  echo "  db/solvers-dev.dump     -> pg_restore --no-owner --dbname=<url de um banco novo com pgvector> db/solvers-dev.dump"
  echo "  claude-memory/          -> ~/.claude/projects/C--Users-<user>-Documents-Projetos-solver/memory/"
} > "$STAGE/MANIFEST.txt"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  PASS=$BACKUP_PASSPHRASE
else
  [ -t 0 ] || { echo "✖ rode num terminal interativo (a senha é digitada, não fica salva)" >&2; exit 1; }
  read -rsp "Senha do backup (mín. 12 caracteres; guarde no Bitwarden): " PASS; echo
  read -rsp "Repita a senha: " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "✖ as senhas não conferem" >&2; exit 1; }
  unset PASS2
fi
[ "${#PASS}" -ge 12 ] || { echo "✖ senha curta demais (mínimo 12 caracteres)" >&2; exit 1; }

OUT="$OUT_DIR/Solvers-devnet-backup-$(date +%Y%m%d-%H%M).tar.gz.gpg"
tar -C "$STAGE" -czf "$TGZ" .
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
  --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none -o "$OUT" "$TGZ" 3< <(printf '%s' "$PASS")

# Conferência: descriptografa de volta e compara a quantidade de arquivos com a do stage.
EXPECTED=$(cd "$STAGE" && find . -type f | wc -l)
GOT=$(gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$OUT" 3< <(printf '%s' "$PASS") | tar -tz | grep -vc '/$' || true)
unset PASS
[ "$EXPECTED" = "$GOT" ] || { echo "✖ conferência falhou: esperado $EXPECTED arquivos, leu $GOT" >&2; exit 1; }

echo
echo "✔ Backup criado e conferido ($GOT arquivos): $OUT"
echo "  tamanho: $(du -h "$OUT" | cut -f1)   sha256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo "Próximos passos: guarde a senha no Bitwarden e copie o arquivo para um 2º lugar (HD externo ou nuvem: ele é criptografado)."
echo "Para abrir (WSL ou Git Bash):  gpg -d '$(basename "$OUT")' | tar xz"

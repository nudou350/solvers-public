# Incluído (source) pelos outros scripts: acrescenta ao PATH as pastas das ferramentas que só entram pelo
# shell de login/interativo (ex.: `wsl bash script` não as enxerga). Só adiciona se existirem e se ainda
# não estiverem no PATH; o que já está no PATH tem prioridade.
for _d in "$HOME/.cargo/bin" "$HOME/.avm/bin" "$HOME/.local/share/solana/install/active_release/bin"; do
  if [ -d "$_d" ]; then
    case ":$PATH:" in *":$_d:"*) ;; *) PATH="$PATH:$_d" ;; esac
  fi
done
unset _d
export PATH

# need <comando> <dica>: falha com mensagem clara se o comando não existir.
need() {
  command -v "$1" >/dev/null 2>&1 || { echo "✖ '$1' não encontrado no PATH. $2" >&2; exit 1; }
}

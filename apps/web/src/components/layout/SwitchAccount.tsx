"use client";
// "Trocar conta". Com o Privy é o logout normal. Com a carteira de desenvolvimento, sair e entrar de novo
// voltaria para a mesma carteira; por isso oferecemos "usar outra carteira de teste" (apaga a semente e gera outra).
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";

export function SwitchAccount({ disabled, label = "Trocar conta" }: { disabled?: boolean; label?: string }) {
  const { walletKind, me, logout, switchDevWallet } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (walletKind !== "dev")
    return (
      <button type="button" className="link-btn" onClick={() => void logout()} disabled={disabled}>
        {label}
      </button>
    );

  async function switchWallet() {
    setBusy(true);
    try {
      const m = await switchDevWallet();
      setOpen(false);
      toast({ tone: "ok", title: "Nova carteira de teste", text: `Você entrou com a carteira ${short(m.wallet)}.` });
    } catch (e) {
      toast({ tone: "bad", title: "Não deu para trocar de carteira", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={gap(10, { alignItems: "flex-end", flexBasis: open ? "100%" : undefined })}>
      <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open} disabled={disabled || busy}>
        {label}
      </button>
      {open ? (
        <div className="card-flat pad-s col" role="group" aria-label="Trocar de carteira de teste" style={gap(10, { alignSelf: "stretch", background: "var(--surface)" })}>
          <span className="small">
            Nesta versão de teste, a carteira {me ? short(me.wallet) : ""} foi criada por este navegador. Usar outra apaga a atual daqui: o que foi comprado com ela deixa de aparecer.
          </span>
          <div className="row wrapx" style={gap(8)}>
            <Button size="sm" icon="wallet" loading={busy} onClick={switchWallet}>
              Usar outra carteira de teste
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void logout()} disabled={busy}>
              Só sair
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

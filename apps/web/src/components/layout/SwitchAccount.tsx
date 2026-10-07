"use client";
// "Trocar conta". Com o Privy é o logout normal. Com a carteira de desenvolvimento, sair e entrar de novo
// voltaria para a mesma carteira; por isso oferecemos "usar outra carteira de teste" (apaga a semente e gera outra).
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";

export function SwitchAccount({ disabled, label }: { disabled?: boolean; label?: string }) {
  const t = useTranslations("common.switchAccount");
  const errorText = useErrorText();
  const text = label ?? t("label");
  const { walletKind, me, logout, switchDevWallet } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (walletKind !== "dev")
    return (
      <button type="button" className="link-btn" onClick={() => void logout()} disabled={disabled}>
        {text}
      </button>
    );

  async function switchWallet() {
    setBusy(true);
    try {
      const m = await switchDevWallet();
      setOpen(false);
      toast({ tone: "ok", title: t("newWallet"), text: t("signedInWith", { wallet: short(m.wallet) }) });
    } catch (e) {
      toast({ tone: "bad", title: t("switchFailed"), text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={gap(10, { alignItems: "flex-end", flexBasis: open ? "100%" : undefined })}>
      <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open} disabled={disabled || busy}>
        {text}
      </button>
      {open ? (
        <div className="card-flat pad-s col" role="group" aria-label={t("group")} style={gap(10, { alignSelf: "stretch", background: "var(--surface)" })}>
          <span className="small">
            {t("explain", { wallet: me ? short(me.wallet) : "" })}
          </span>
          <div className="row wrapx" style={gap(8)}>
            <Button size="sm" icon="wallet" loading={busy} onClick={switchWallet}>
              {t("useOther")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void logout()} disabled={busy}>
              {t("justSignOut")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

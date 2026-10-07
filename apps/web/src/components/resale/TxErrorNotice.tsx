"use client";
// Erro de transação da revenda (já traduzido por txErrorMessage), com a ação que faz sentido: entrar de novo ou tentar outra vez.
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Notice, useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import type { TxErrorInfo } from "@/lib/tx";

export function TxErrorNotice({ error, onRetry, extraActions }: { error: TxErrorInfo; onRetry?: () => void; extraActions?: ReactNode }) {
  const { login } = useSession();
  const toast = useToast();
  const t = useTranslations("resale.txError");
  const doLogin = () => login().catch((e: unknown) => toast({ tone: "bad", title: t("loginFailed"), text: (e as Error).message }));
  const actions =
    error.action === "login" ? (
      <Button size="sm" onClick={doLogin}>
        {t("login")}
      </Button>
    ) : error.action === "retry" && onRetry ? (
      <Button size="sm" icon="refresh" onClick={onRetry}>
        {t("retry")}
      </Button>
    ) : null;
  return (
    <Notice
      tone="bad"
      role="alert"
      title={error.title}
      actions={
        actions || extraActions ? (
          <>
            {actions}
            {extraActions}
          </>
        ) : undefined
      }
    >
      {error.text}
    </Notice>
  );
}

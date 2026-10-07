"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useErrorText } from "@/lib/error-text";
import { useSession } from "@/lib/session";
import { Button } from "./Button";
import { Empty } from "./Empty";
import type { IconName } from "./Icon";
import { Loading } from "./Spinner";
import { useToast } from "./Toast";

export type AuthGateProps = {
  icon?: IconName;
  title: string;
  text: string;
  /** Ações extras ao lado de "Entrar" (ex: "Como publicar"). */
  actions?: ReactNode;
  children?: ReactNode;
};

/** Só mostra `children` com a sessão aberta. Deslogado: o estado "Entre para ver..." com o botão de login. */
export function AuthGate({ icon = "lock", title, text, actions, children }: AuthGateProps) {
  const { status, login, loggingIn } = useSession();
  const toast = useToast();
  const t = useTranslations("common.ui");
  const errorText = useErrorText();
  if (status === "loading") return <Loading />;
  if (status === "anon")
    return (
      <Empty
        icon={icon}
        title={title}
        action={
          <>
            <Button
              loading={loggingIn}
              onClick={() => login().catch((e: unknown) => toast({ tone: "bad", title: t("signInFailed"), text: errorText(e) }))}
            >
              {t("signIn")}
            </Button>
            {actions}
          </>
        }
      >
        {text}
      </Empty>
    );
  return <>{children}</>;
}

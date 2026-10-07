"use client";
// Consentimento do conector (OAuth): o Claude/ChatGPT abre /oauth/authorize, o servidor guarda o pedido e
// redireciona para cá. A pessoa entra (e-mail/Privy ou carteira de dev), a carteira da sessão assina o
// login do pedido e a chave das memórias, e voltamos para o assistente com o código de autorização.
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";

type Info = { clientName: string; redirectHost: string; verified: boolean; memoryMessage: string; extensionUrl: string };

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};

/** Erro do /oauth/authorize/*: guarda o código (RFC 6749) e a descrição em inglês do servidor, para traduzir na tela. */
class OAuthFailure extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, fallback: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
  if (!res.ok) throw new OAuthFailure(body.error_description ?? body.error ?? fallback, body.error);
  return body;
}

export function ConnectView({ req }: { req: string | null }) {
  const { status, me, login, logout, loggingIn, requireWallet } = useSession();
  const t = useTranslations("connect");
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(req ? null : t("invalidRequest"));
  const [step, setStep] = useState<string | null>(null);
  // Texto de reserva em ref: `t` muda de identidade a cada render e não pode reiniciar o efeito de carregamento.
  const genericError = useRef(t("genericError"));
  genericError.current = t("genericError");
  // Mensagens conhecidas do servidor (em inglês) viram texto do idioma da página; o resto aparece como veio.
  const localize = (e: Error) => {
    const code = e instanceof OAuthFailure ? e.code : undefined;
    if (code === "too_many_requests") return t("errTooMany");
    if (code === "access_denied") return t("errMemoryKey");
    if (code === "invalid_request") return /expired/i.test(e.message) ? t("errExpired") : t("errSignature");
    return e.message;
  };

  useEffect(() => {
    if (!req) return;
    let alive = true;
    getJson<Info>(`/oauth/authorize/info?req=${encodeURIComponent(req)}`, genericError.current)
      .then((i) => alive && setInfo(i))
      .catch((e: Error) => alive && setError(localize(e)));
    return () => {
      alive = false;
    };
  }, [req]);

  async function authorize() {
    if (!req || !info || !me) return;
    setError(null);
    try {
      const wallet = await requireWallet();
      if (wallet.address !== me.wallet) throw new Error(t("walletMismatch"));
      setStep(t("stepConfirming"));
      const n = await getJson<{ message: string }>(`/oauth/authorize/nonce?req=${encodeURIComponent(req)}&wallet=${wallet.address}`, t("genericError"));
      const enc = new TextEncoder();
      const signature = toB64(await wallet.signMessage(enc.encode(n.message)));
      setStep(t("stepMemories"));
      const memorySignature = toB64(await wallet.signMessage(enc.encode(info.memoryMessage)));
      setStep(t("stepConnecting"));
      const done = await getJson<{ redirectTo: string }>("/oauth/authorize/complete", t("genericError"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ req, wallet: wallet.address, message: n.message, signature, memorySignature }),
      });
      setStep(t("stepDone", { client: info.clientName }));
      window.location.href = done.redirectTo;
    } catch (e) {
      setStep(null);
      setError(localize(e as Error) || t("somethingWrong"));
    }
  }

  const who = me ? (me.displayName ?? me.email ?? short(me.wallet)) : null;

  return (
    <section className="wrap" style={{ paddingTop: 48, paddingBottom: 64, maxWidth: 560 }}>
      <Card pad="l">
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="shield-check" size="l" />
            <h1 style={{ margin: 0, fontSize: 24 }}>{t("title")}</h1>
          </div>

          {!info && !error ? <Loading text={t("loadingRequest")} /> : null}

          {info ? (
            <>
              <p style={{ margin: 0 }}>{t.rich("intro", { client: info.clientName, b: (c) => <strong>{c}</strong> })}</p>
              <p style={{ margin: 0, fontSize: 14 }}>
                {t("returnsTo")} <code>{info.redirectHost}</code>{" "}
                {info.verified ? t("verified") : null}
              </p>
              {!info.verified ? (
                <Notice tone="warn" title={t("unverifiedTitle")}>
                  {t("unverifiedBody")}
                </Notice>
              ) : null}

              {status === "loading" ? <Loading /> : null}

              {status === "anon" ? (
                <>
                  <p style={{ margin: 0 }}>{t("signInPrompt")}</p>
                  <Button block loading={loggingIn} onClick={() => login().catch((e: Error) => setError(localize(e)))}>
                    {t("signIn")}
                  </Button>
                </>
              ) : null}

              {status === "authed" && me ? (
                <>
                  <p style={{ margin: 0 }}>
                    {t("connectingAs")} <strong>{who}</strong>{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => logout().catch(() => undefined)}
                      disabled={!!step}
                      style={{ background: "none", border: 0, padding: 0, color: "var(--brand)", cursor: "pointer" }}
                    >
                      {t("switchAccount")}
                    </button>
                  </p>
                  <Button block loading={!!step} onClick={authorize}>
                    {t("authorize", { client: info.clientName })}
                  </Button>
                </>
              ) : null}

              <div role="status" aria-live="polite" style={{ minHeight: 20, fontSize: 14 }}>
                {step}
              </div>
            </>
          ) : null}

          {error ? (
            <Notice tone="bad" title={t("failedTitle")} role="alert">
              {error}
            </Notice>
          ) : null}

          {info ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
              {t.rich("walletHint", { link: (c) => <a href={info.extensionUrl}>{c}</a> })}
            </p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

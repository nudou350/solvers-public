"use client";
// Consentimento do conector (OAuth): o Claude/ChatGPT abre /oauth/authorize, o servidor guarda o pedido e
// redireciona para cá. A pessoa entra (e-mail/Privy ou carteira de dev), a carteira da sessão assina o
// login do pedido e a chave das memórias, e voltamos para o assistente com o código de autorização.
import { useEffect, useState } from "react";
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

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(body.error_description ?? body.error ?? "Não deu para continuar.");
  return body;
}

export function ConnectView({ req }: { req: string | null }) {
  const { status, me, login, logout, loggingIn, requireWallet } = useSession();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(req ? null : "Pedido de conexão inválido. Volte ao Claude ou ChatGPT e conecte de novo.");
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    getJson<Info>(`/oauth/authorize/info?req=${encodeURIComponent(req)}`)
      .then((i) => alive && setInfo(i))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [req]);

  async function authorize() {
    if (!req || !info || !me) return;
    setError(null);
    try {
      const wallet = await requireWallet();
      if (wallet.address !== me.wallet) throw new Error("A carteira não é a da sessão. Saia e entre de novo.");
      setStep("Confirmando que a carteira é sua…");
      const n = await getJson<{ message: string }>(`/oauth/authorize/nonce?req=${encodeURIComponent(req)}&wallet=${wallet.address}`);
      const enc = new TextEncoder();
      const signature = toB64(await wallet.signMessage(enc.encode(n.message)));
      setStep("Protegendo suas memórias…");
      const memorySignature = toB64(await wallet.signMessage(enc.encode(info.memoryMessage)));
      setStep("Conectando…");
      const done = await getJson<{ redirectTo: string }>("/oauth/authorize/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ req, wallet: wallet.address, message: n.message, signature, memorySignature }),
      });
      setStep(`Pronto! Voltando para o ${info.clientName}…`);
      window.location.href = done.redirectTo;
    } catch (e) {
      setStep(null);
      setError((e as Error).message || "Algo deu errado. Tente de novo.");
    }
  }

  const who = me ? (me.displayName ?? me.email ?? short(me.wallet)) : null;

  return (
    <section className="wrap" style={{ paddingTop: 48, paddingBottom: 64, maxWidth: 560 }}>
      <Card pad="l">
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="shield-check" size="l" />
            <h1 style={{ margin: 0, fontSize: 24 }}>Conectar sua conta do Solver</h1>
          </div>

          {!info && !error ? <Loading text="Carregando o pedido de conexão…" /> : null}

          {info ? (
            <>
              <p style={{ margin: 0 }}>
                <strong>{info.clientName}</strong> quer usar os seus especialistas do Solver. Ele vai ver as suas licenças e poderá
                usar as suas memórias. <strong>Isto não autoriza pagamentos.</strong>
              </p>
              <p style={{ margin: 0, fontSize: 14 }}>
                Volta para: <code>{info.redirectHost}</code>{" "}
                {info.verified ? "(verificado)" : null}
              </p>
              {!info.verified ? (
                <Notice tone="warn" title="Aplicativo não verificado">
                  Só continue se foi você quem iniciou esta conexão agora.
                </Notice>
              ) : null}

              {status === "loading" ? <Loading /> : null}

              {status === "anon" ? (
                <>
                  <p style={{ margin: 0 }}>Entre com o seu e-mail para escolher a conta que será conectada.</p>
                  <Button block loading={loggingIn} onClick={() => login().catch((e: Error) => setError(e.message))}>
                    Entrar
                  </Button>
                </>
              ) : null}

              {status === "authed" && me ? (
                <>
                  <p style={{ margin: 0 }}>
                    Conectando como <strong>{who}</strong>{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => logout().catch(() => undefined)}
                      disabled={!!step}
                      style={{ background: "none", border: 0, padding: 0, color: "var(--brand)", cursor: "pointer" }}
                    >
                      (não é você? trocar conta)
                    </button>
                  </p>
                  <Button block loading={!!step} onClick={authorize}>
                    Autorizar {info.clientName}
                  </Button>
                </>
              ) : null}

              <div role="status" aria-live="polite" style={{ minHeight: 20, fontSize: 14 }}>
                {step}
              </div>
            </>
          ) : null}

          {error ? (
            <Notice tone="bad" title="Não deu para conectar" role="alert">
              {error}
            </Notice>
          ) : null}

          {info ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
              Usa Phantom, Solflare ou Backpack? <a href={info.extensionUrl}>Conectar com a carteira do navegador</a>. Atenção:
              é outra conta, com outras compras.
            </p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

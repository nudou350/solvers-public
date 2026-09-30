"use client";
// Cobrança Pix da demo: QR (ou QR de mentira no modo simulado), copia e cola, valor, expiração
// e consulta a cada 3 s até o USDC de teste ser creditado. O status do servidor decide; o relógio local só avisa.
import type { PixCharge } from "@solvers/api-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { brlValue, copyText, usdc } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { txErrorMessage, type TxErrorInfo } from "@/lib/tx";
import { FakeQr } from "./FakeQr";
import s from "./checkout.module.css";

const POLL_MS = 3000;
/** Depois do prazo, continua consultando por mais este tempo até o servidor decidir (o provedor pode atrasar). */
const GRACE_MS = 2 * 60_000;
/** Aprovado há mais que isto e ainda sem crédito: mostra uma mensagem tranquila e consulta com menos frequência. */
const SLOW_CREDIT_MS = 2 * 60_000;
const SLOW_POLL_MS = 15_000;

function mmss(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

export function PixPanel({
  charge,
  ownerWallet,
  totalUsdc,
  onUpdate,
  onCredited,
  onRestart,
}: {
  charge: PixCharge;
  /** Carteira dona da cobrança: só ela (a sessão atual) consulta e simula este Pix. */
  ownerWallet: string;
  /** Total da compra: se o Pix cobre só a diferença, explicamos. */
  totalUsdc: number;
  onUpdate: (c: PixCharge) => void;
  onCredited: (c: PixCharge) => void;
  onRestart: () => void;
}) {
  const { api, config, me, login, loggingIn } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);
  const [gone, setGone] = useState(false);
  const [offline, setOffline] = useState(false);
  const failures = useRef(0);
  const cb = useRef({ onUpdate, onCredited });
  cb.current = { onUpdate, onCredited };
  const walletNow = useRef(me?.wallet ?? null);
  walletNow.current = me?.wallet ?? null;

  // Quem manda é o status do servidor. O relógio daqui só avisa que o prazo acabou e dispara uma última consulta:
  // ele pode estar adiantado, e o Pix pago no limite ainda é creditado.
  const left = new Date(charge.expiresAt).getTime() - now;
  const pending = charge.status === "pending";
  const approved = charge.status === "approved";
  const due = pending && left <= 0;
  const sessionOk = me?.wallet === ownerWallet;
  // Pendente consulta até um pouco depois do prazo (o provedor pode demorar a confirmar); aprovado consulta até creditar.
  const lapsed = pending && left < -GRACE_MS;
  // Crédito demorado: depois de ~2 min aprovado, avisa com calma e consulta mais devagar.
  const [slowCredit, setSlowCredit] = useState(false);
  useEffect(() => {
    if (!approved) return setSlowCredit(false);
    const t = setTimeout(() => setSlowCredit(true), SLOW_CREDIT_MS);
    return () => clearTimeout(t);
  }, [approved]);
  const polling = (pending || approved) && sessionOk && !gone && !lapsed;

  // Consulta a cobrança a cada 3 s até ser creditada (ou o servidor dar como expirada).
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const check = async () => {
      try {
        const c = await api.getPixCharge(charge.id);
        if (!alive) return;
        failures.current = 0;
        setOffline(false);
        cb.current.onUpdate(c);
        if (c.status === "credited") cb.current.onCredited(c);
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setGone(true);
        // 401: a sessão se refaz sozinha; sessionOk vira false e o painel pede para entrar de novo.
        else if (!(e instanceof ApiError && e.status === 401) && ++failures.current >= 3) setOffline(true);
      }
    };
    const t = setInterval(check, slowCredit ? SLOW_POLL_MS : POLL_MS);
    if (due) void check(); // o prazo acabou agora: uma consulta imediata antes de dar o Pix como vencido
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, charge.id, polling, due, ownerWallet, slowCredit]);

  useEffect(() => {
    if (!pending || lapsed) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending, lapsed]);

  // Só aceita base64 puro no QR (vai para um data: URL).
  const qrPng = charge.qrCodeBase64 && /^[A-Za-z0-9+/=]+$/.test(charge.qrCodeBase64) ? charge.qrCodeBase64 : null;

  async function simulate() {
    setSimulating(true);
    setError(null);
    try {
      const c = await api.simulatePixPayment(charge.id);
      if (walletNow.current !== ownerWallet) return; // a conta mudou no meio: descarta
      onUpdate(c);
      if (c.status === "credited") onCredited(c);
    } catch (e) {
      setError(txErrorMessage(e));
    } finally {
      setSimulating(false);
    }
  }

  async function copy() {
    if (charge.qrCode && (await copyText(charge.qrCode))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  if (charge.status === "credited")
    return (
      <Notice tone="ok" title="Pix recebido">
        {usdc(charge.amountUsdc)} de teste chegaram na sua carteira. Concluindo a compra…
      </Notice>
    );

  const restart = (
    <Button variant="secondary" size="sm" icon="refresh" onClick={onRestart}>
      Gerar outro Pix
    </Button>
  );

  if (gone)
    return (
      <Notice tone="warn" role="alert" title="Não encontramos este Pix nesta conta" actions={restart}>
        Ele pode ter sido gerado por outra conta. Se você já pagou, o valor entra na conta que gerou o Pix. Gere um novo código para continuar aqui.
      </Notice>
    );

  if (!sessionOk && (pending || approved))
    return (
      <Notice
        tone="warn"
        role="alert"
        title="Sua sessão terminou"
        actions={
          <>
            <Button size="sm" loading={loggingIn} onClick={() => void login().catch(() => {})}>
              Entrar de novo
            </Button>
            {restart}
          </>
        }
      >
        Entre na mesma conta para continuar acompanhando este Pix. Se você já pagou, o saldo entra na conta quando o pagamento for confirmado.
      </Notice>
    );

  // Pagamento aprovado: não some por causa do relógio, só termina quando o saldo é creditado.
  if (approved && slowCredit)
    return (
      <Notice
        tone="info"
        title="Seu pagamento foi recebido"
        actions={
          <Button variant="secondary" size="sm" onClick={onRestart}>
            Sair desta tela
          </Button>
        }
      >
        O saldo pode demorar um pouco mais; você pode fechar esta tela, ele entra sozinho.
      </Notice>
    );
  if (approved)
    return (
      <div className={s.status} role="status" aria-live="polite">
        <Spinner size="s" />
        <span className="small">
          <b>Pagamento recebido, creditando saldo…</b>
          <span className="muted"> Não precisa pagar de novo. A compra continua sozinha.</span>
          {offline ? <span className="muted"> Não conseguimos confirmar agora; tentando de novo.</span> : null}
        </span>
      </div>
    );

  if (charge.status === "expired" || charge.status === "failed")
    return (
      <Notice
        tone="warn"
        title={charge.status === "failed" ? "O Pix não foi aprovado" : "Este Pix expirou"}
        actions={restart}
      >
        Nada foi cobrado. Gere um novo código para continuar.
      </Notice>
    );

  // O prazo acabou no relógio, mas o servidor ainda não deu o Pix como vencido: sem afirmar que nada foi cobrado.
  if (due)
    return (
      <Notice tone="warn" title="O prazo deste Pix terminou" actions={restart}>
        Se você já pagou, o saldo entra em instantes e a compra continua aqui. Se ainda não pagou, gere um novo código.
        {offline ? " Não conseguimos confirmar agora; tentando de novo." : ""}
      </Notice>
    );

  const partial = charge.amountUsdc < totalUsdc - 1e-6;

  return (
    <div className="col" style={gap(16)}>
      <div className={s.pix}>
        <div className={s.qrBox}>
          {qrPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${qrPng}`} alt="QR Code do Pix" />
          ) : (
            <>
              <FakeQr text={charge.qrCode ?? charge.id} />
              <span className={s.stamp} aria-hidden>
                TESTE
              </span>
            </>
          )}
        </div>
        <div className="col" style={gap(14)}>
          <div className="col" style={gap(2)}>
            <span className="muted small">Valor do Pix</span>
            <span className="display num" style={{ fontSize: 40, lineHeight: 1.05 }}>
              {brlValue(charge.amountBrl)}
            </span>
            <span className="small muted num">Você recebe {usdc(charge.amountUsdc)} de teste na sua carteira</span>
          </div>
          {partial ? <p className="small muted">O seu saldo já cobre uma parte: o Pix completa só o que falta.</p> : null}
          <div className={s.status} role="status" aria-live="polite">
            <Spinner size="s" />
            <span className="small">
              Aguardando o pagamento
              <span className="muted"> · expira em {mmss(left)}</span>
              {offline ? <span className="muted"> · Não conseguimos confirmar agora; tentando de novo.</span> : null}
            </span>
          </div>
        </div>
      </div>

      {charge.qrCode ? (
        <div className="field">
          <label className="label" htmlFor="pix-copia-cola">
            Pix copia e cola
          </label>
          <div className="row m-col" style={gap(10)}>
            <input id="pix-copia-cola" className="input mono" readOnly value={charge.qrCode} style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" icon={copied ? "check" : "copy"} onClick={copy}>
              {copied ? "Copiado" : "Copiar código"}
            </Button>
          </div>
        </div>
      ) : null}

      {charge.simulated ? (
        <p className="tiny faint">
          <Icon name="info" size="s" /> Cobrança de teste: este código não pode ser pago num banco. Use o botão abaixo para simular o pagamento.
        </p>
      ) : (
        <p className="tiny faint">Abra o app do seu banco, escolha Pix e leia o QR Code ou cole o código. A confirmação aparece aqui sozinha.</p>
      )}

      {error ? <Notice tone="bad" role="alert" title={error.title}>{error.text}</Notice> : null}

      <div className="row wrapx" style={gap(10)}>
        {config?.pix.simulate ? (
          <Button variant="primary" icon="bolt" loading={simulating} onClick={simulate}>
            Simular pagamento (teste)
          </Button>
        ) : null}
        {charge.ticketUrl ? (
          <Button variant="ghost" href={charge.ticketUrl} iconRight="external">
            Abrir o Pix no Mercado Pago
          </Button>
        ) : null}
        <button type="button" className="link-btn small" onClick={onRestart}>
          Cancelar e escolher outra forma
        </button>
      </div>
    </div>
  );
}

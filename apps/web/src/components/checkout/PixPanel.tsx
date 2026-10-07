"use client";
// Cobrança Pix da demo: QR (ou QR de mentira no modo simulado), copia e cola, valor, expiração
// e consulta a cada 3 s até o USDC de teste ser creditado. O status do servidor decide; o relógio local só avisa.
import type { PixCharge } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { copyText, useFormat } from "@/lib/format";
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
  const t = useTranslations("checkout.pix");
  const f = useFormat();
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
    const timer = setTimeout(() => setSlowCredit(true), SLOW_CREDIT_MS);
    return () => clearTimeout(timer);
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
    const timer = setInterval(check, slowCredit ? SLOW_POLL_MS : POLL_MS);
    if (due) void check(); // o prazo acabou agora: uma consulta imediata antes de dar o Pix como vencido
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, charge.id, polling, due, ownerWallet, slowCredit]);

  useEffect(() => {
    if (!pending || lapsed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
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
      setError(txErrorMessage(e, f.locale));
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
      <Notice tone="ok" title={t("received.title")}>
        {t("received.text", { amount: f.usdc(charge.amountUsdc) })}
      </Notice>
    );

  const restart = (
    <Button variant="secondary" size="sm" icon="refresh" onClick={onRestart}>
      {t("restart")}
    </Button>
  );

  if (gone)
    return (
      <Notice tone="warn" role="alert" title={t("gone.title")} actions={restart}>
        {t("gone.text")}
      </Notice>
    );

  if (!sessionOk && (pending || approved))
    return (
      <Notice
        tone="warn"
        role="alert"
        title={t("sessionEnded.title")}
        actions={
          <>
            <Button size="sm" loading={loggingIn} onClick={() => void login().catch(() => {})}>
              {t("sessionEnded.login")}
            </Button>
            {restart}
          </>
        }
      >
        {t("sessionEnded.text")}
      </Notice>
    );

  // Pagamento aprovado: não some por causa do relógio, só termina quando o saldo é creditado.
  if (approved && slowCredit)
    return (
      <Notice
        tone="info"
        title={t("slowCredit.title")}
        actions={
          <Button variant="secondary" size="sm" onClick={onRestart}>
            {t("slowCredit.leave")}
          </Button>
        }
      >
        {t("slowCredit.text")}
      </Notice>
    );
  if (approved)
    return (
      <div className={s.status} role="status" aria-live="polite">
        <Spinner size="s" />
        <span className="small">
          <b>{t("crediting.title")}</b>
          <span className="muted">{t("crediting.text")}</span>
          {offline ? <span className="muted"> {t("offline")}</span> : null}
        </span>
      </div>
    );

  if (charge.status === "expired" || charge.status === "failed")
    return (
      <Notice
        tone="warn"
        title={charge.status === "failed" ? t("failed") : t("expired")}
        actions={restart}
      >
        {t("nothingCharged")}
      </Notice>
    );

  // O prazo acabou no relógio, mas o servidor ainda não deu o Pix como vencido: sem afirmar que nada foi cobrado.
  if (due)
    return (
      <Notice tone="warn" title={t("due.title")} actions={restart}>
        {t("due.text")}
        {offline ? ` ${t("offline")}` : ""}
      </Notice>
    );

  const partial = charge.amountUsdc < totalUsdc - 1e-6;

  return (
    <div className="col" style={gap(16)}>
      <div className={s.pix}>
        <div className={s.qrBox}>
          {qrPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${qrPng}`} alt={t("qrAlt")} />
          ) : (
            <>
              <FakeQr text={charge.qrCode ?? charge.id} />
              <span className={s.stamp} aria-hidden>
                {t("stamp")}
              </span>
            </>
          )}
        </div>
        <div className="col" style={gap(14)}>
          <div className="col" style={gap(2)}>
            <span className="muted small">{t("amountLabel")}</span>
            <span className="display num" style={{ fontSize: 40, lineHeight: 1.05 }}>
              {f.brlValue(charge.amountBrl)}
            </span>
            <span className="small muted num">{t("youReceive", { amount: f.usdc(charge.amountUsdc) })}</span>
          </div>
          {partial ? <p className="small muted">{t("partial")}</p> : null}
          <div className={s.status} role="status" aria-live="polite">
            <Spinner size="s" />
            <span className="small">
              {t("waiting")}
              <span className="muted">{t("expiresIn", { time: mmss(left) })}</span>
              {offline ? <span className="muted"> · {t("offline")}</span> : null}
            </span>
          </div>
        </div>
      </div>

      {charge.qrCode ? (
        <div className="field">
          <label className="label" htmlFor="pix-copia-cola">
            {t("copyLabel")}
          </label>
          <div className="row m-col" style={gap(10)}>
            <input id="pix-copia-cola" className="input mono" readOnly value={charge.qrCode} style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" icon={copied ? "check" : "copy"} onClick={copy}>
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      ) : null}

      {charge.simulated ? (
        <p className="tiny faint">
          <Icon name="info" size="s" /> {t("simulatedNote")}
        </p>
      ) : (
        <p className="tiny faint">{t("realNote")}</p>
      )}

      {error ? <Notice tone="bad" role="alert" title={error.title}>{error.text}</Notice> : null}

      <div className="row wrapx" style={gap(10)}>
        {config?.pix.simulate ? (
          <Button variant="primary" icon="bolt" loading={simulating} onClick={simulate}>
            {t("simulate")}
          </Button>
        ) : null}
        {charge.ticketUrl ? (
          <Button variant="ghost" href={charge.ticketUrl} iconRight="external">
            {t("openMp")}
          </Button>
        ) : null}
        <button type="button" className="link-btn small" onClick={onRestart}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

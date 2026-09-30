"use client";
// Cobrança Pix da demo: QR (ou QR de mentira no modo simulado), copia e cola, valor, expiração
// e consulta a cada 3 s até o USDC de teste ser creditado.
import type { PixCharge } from "@solvers/api-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { brlValue, copyText, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { txErrorMessage, type TxErrorInfo } from "@/lib/tx";
import { FakeQr } from "./FakeQr";
import s from "./checkout.module.css";

const POLL_MS = 3000;

function mmss(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

export function PixPanel({
  charge,
  totalUsdc,
  onUpdate,
  onCredited,
  onRestart,
}: {
  charge: PixCharge;
  /** Total da compra: se o Pix cobre só a diferença, explicamos. */
  totalUsdc: number;
  onUpdate: (c: PixCharge) => void;
  onCredited: (c: PixCharge) => void;
  onRestart: () => void;
}) {
  const { api, config } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);
  const cb = useRef({ onUpdate, onCredited });
  cb.current = { onUpdate, onCredited };

  const waiting = charge.status === "pending" || charge.status === "approved";
  const left = new Date(charge.expiresAt).getTime() - now;
  // Expirou pelo relógio local: para de consultar (o servidor também a dá como expirada).
  const expired = charge.status === "expired" || (waiting && left <= 0);
  const polling = waiting && !expired;

  // Consulta a cobrança a cada 3 s até ser creditada (ou expirar).
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const c = await api.getPixCharge(charge.id);
        if (!alive) return;
        cb.current.onUpdate(c);
        if (c.status === "credited") cb.current.onCredited(c);
      } catch {
        /* falha momentânea: tenta de novo no próximo ciclo */
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, charge.id, polling]);

  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [polling]);

  // Só aceita base64 puro no QR (vai para um data: URL).
  const qrPng = charge.qrCodeBase64 && /^[A-Za-z0-9+/=]+$/.test(charge.qrCodeBase64) ? charge.qrCodeBase64 : null;

  async function simulate() {
    setSimulating(true);
    setError(null);
    try {
      const c = await api.simulatePixPayment(charge.id);
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

  if (expired || charge.status === "failed")
    return (
      <Notice
        tone="warn"
        title={charge.status === "failed" ? "O Pix não foi aprovado" : "Este Pix expirou"}
        actions={
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRestart}>
            Gerar outro Pix
          </Button>
        }
      >
        Nada foi cobrado. Gere um novo código para continuar.
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
              {charge.status === "approved" ? "Pagamento aprovado. Creditando o USDC…" : "Aguardando o pagamento"}
              <span className="muted"> · expira em {mmss(left)}</span>
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

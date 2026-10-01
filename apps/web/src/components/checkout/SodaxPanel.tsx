"use client";
// Pagamento SODAX da demo: mostra a cotação usada e, no botão, SIMULA o pagamento (credita USDC de teste).
// Nenhum dinheiro real é movido: o SODAX só tem mainnet. Na versão real, a pessoa confirma o pagamento na carteira
// da outra rede e o SODAX entrega o USDC aqui; o resto do fluxo (compra com o saldo) é o mesmo.
import type { PixCharge, SodaxQuote } from "@solvers/api-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { brl, cryptoAmount, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { txErrorMessage, type TxErrorInfo } from "@/lib/tx";
import s from "./checkout.module.css";

const POLL_MS = 3000;

export function SodaxPanel({
  charge,
  quote,
  ownerWallet,
  onUpdate,
  onCredited,
  onRestart,
}: {
  charge: PixCharge;
  /** Cotação que a pessoa viu ao pagar (null se a tela foi reaberta sem ela). */
  quote: SodaxQuote | null;
  /** Carteira dona da cobrança: só ela (a sessão atual) consulta e simula. */
  ownerWallet: string;
  onUpdate: (c: PixCharge) => void;
  onCredited: (c: PixCharge) => void;
  onRestart: () => void;
}) {
  const { api, config, me, login, loggingIn } = useSession();
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);
  const [gone, setGone] = useState(false);
  const cb = useRef({ onUpdate, onCredited });
  cb.current = { onUpdate, onCredited };
  const walletNow = useRef(me?.wallet ?? null);
  walletNow.current = me?.wallet ?? null;
  const rate = config?.brlPerUsd ?? null;
  const sessionOk = me?.wallet === ownerWallet;
  const approved = charge.status === "approved";

  // O simulate já credita na mesma chamada; só consulta se o crédito ficou pendente (approved).
  useEffect(() => {
    if (!approved || !sessionOk || gone) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const c = await api.getPixCharge(charge.id);
        if (!alive) return;
        cb.current.onUpdate(c);
        if (c.status === "credited") cb.current.onCredited(c);
      } catch (e) {
        if (alive && e instanceof ApiError && e.status === 404) setGone(true);
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, charge.id, approved, sessionOk, gone]);

  async function pay() {
    setSimulating(true);
    setError(null);
    try {
      const c = await api.simulateSodaxPayment(charge.id);
      if (walletNow.current !== ownerWallet) return; // a conta mudou no meio: descarta
      onUpdate(c);
      if (c.status === "credited") onCredited(c);
    } catch (e) {
      setError(txErrorMessage(e));
    } finally {
      setSimulating(false);
    }
  }

  const restart = (
    <Button variant="secondary" size="sm" icon="refresh" onClick={onRestart}>
      Começar de novo
    </Button>
  );

  if (charge.status === "credited")
    return (
      <Notice tone="ok" title="Pagamento recebido">
        {usdc(charge.amountUsdc)} de teste chegaram na sua carteira. Concluindo a compra…
      </Notice>
    );
  if (gone)
    return (
      <Notice tone="warn" role="alert" title="Não encontramos este pagamento nesta conta" actions={restart}>
        Ele pode ter sido criado por outra conta. Comece de novo para continuar aqui.
      </Notice>
    );
  if (!sessionOk && (charge.status === "pending" || approved))
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
        Entre na mesma conta para continuar este pagamento.
      </Notice>
    );
  if (approved)
    return (
      <div className={s.status} role="status" aria-live="polite">
        <Spinner size="s" />
        <span className="small">
          <b>Pagamento recebido, creditando saldo…</b>
          <span className="muted"> Não precisa pagar de novo. A compra continua sozinha.</span>
        </span>
      </div>
    );
  if (charge.status === "expired" || charge.status === "failed")
    return (
      <Notice tone="warn" title={charge.status === "failed" ? "O pagamento não foi aprovado" : "Este pagamento expirou"} actions={restart}>
        Nada foi cobrado. Comece de novo para continuar.
      </Notice>
    );

  return (
    <div className="col" style={gap(16)}>
      <div className="col" style={gap(2)}>
        <span className="muted small">Pagamento com SODAX</span>
        {quote ? (
          <>
            <span className="display num" style={{ fontSize: 36, lineHeight: 1.05 }}>
              ≈ {cryptoAmount(quote.payAmount, quote.source.symbol)}
            </span>
            <span className="small muted num">
              {quote.source.label}
              {rate != null ? ` · ≈ ${brl(charge.amountUsdc, rate)}` : ""}
            </span>
          </>
        ) : (
          <span className="display num" style={{ fontSize: 36, lineHeight: 1.05 }}>
            {rate != null ? brl(charge.amountUsdc, rate) : usdc(charge.amountUsdc)}
          </span>
        )}
        <span className="small muted num">Você recebe {usdc(charge.amountUsdc)} de teste na sua carteira</span>
      </div>

      <Notice tone="info" title="Demonstração">
        Nenhum dinheiro real é movido aqui. Na versão real, você confirma o pagamento na carteira da outra rede (como a MetaMask) e o SODAX
        entrega o USDC na sua conta. A cotação acima é a real, feita agora pelo SODAX.
      </Notice>

      {error ? (
        <Notice tone="bad" role="alert" title={error.title}>
          {error.text}
        </Notice>
      ) : null}

      <div className="row wrapx" style={gap(10)}>
        {config?.sodax?.simulate ? (
          <Button variant="primary" icon="bolt" loading={simulating} onClick={pay}>
            Confirmar pagamento (teste)
          </Button>
        ) : (
          <p className="tiny faint">
            <Icon name="info" size="s" /> O pagamento de teste está desativado neste servidor.
          </p>
        )}
        <button type="button" className="link-btn small" onClick={onRestart}>
          Cancelar e escolher outra forma
        </button>
      </div>
    </div>
  );
}

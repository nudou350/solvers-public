"use client";
// Cotação ao vivo do SODAX dentro da escolha de pagamento: quanto a pessoa pagaria na outra rede (ETH na Base,
// USDC na Arbitrum...) para receber o USDC que falta. É a cotação real da API do SODAX; o pagamento da demo é
// simulado (ver SodaxPanel). Atualiza sozinha a cada 20 s.
import type { PublicConfig, SodaxQuote as Quote } from "@solvers/api-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { brl, cryptoAmount, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import s from "./checkout.module.css";

const REFRESH_MS = 20_000;

type Sources = NonNullable<PublicConfig["sodax"]>["sources"];

export function SodaxQuoteCard({
  agentId,
  type,
  sources,
  source,
  onSource,
  onQuote,
  disabled,
}: {
  agentId: string;
  type: "permanent" | "guarantee";
  sources: Sources;
  source: string;
  onSource: (key: string) => void;
  /** Última cotação válida (null enquanto carrega, falha ou a origem muda): o pagamento só segue com cotação. */
  onQuote: (q: Quote | null) => void;
  disabled?: boolean;
}) {
  const { api, config, status, me } = useSession();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const cb = useRef(onQuote);
  cb.current = onQuote;
  // Enquanto a cobrança é criada o cartão só pausa as atualizações: mudar `disabled` não pode zerar a cotação
  // que o pagamento vai usar.
  const paused = useRef(!!disabled);
  paused.current = !!disabled;
  const rate = config?.brlPerUsd ?? null;
  const logged = status === "authed" && !!me;
  const wallet = me?.wallet ?? null;
  // O que cai na carteira é o que a compra precisa (a folga da cotação é só margem); com o mínimo do SODAX, o mínimo.
  const credited = quote ? (quote.minApplied ? quote.receiveUsdc : quote.needUsdc) : 0;

  useEffect(() => {
    setQuote(null);
    cb.current(null);
    setError(null);
    if (!logged) return;
    let alive = true;
    const load = async () => {
      if (paused.current) return;
      setLoading(true);
      try {
        const q = await api.getSodaxQuote({ agentId, type, source });
        if (!alive) return;
        setQuote(q);
        setError(null);
        cb.current(q);
      } catch (e) {
        if (!alive) return;
        // Mantém a última cotação na tela só se a falha for passageira; ela some do pagamento de qualquer jeito.
        cb.current(null);
        setQuote(null);
        if (e instanceof ApiError && e.code === "balance_sufficient") setError({ code: "balance_sufficient", text: "Seu saldo já cobre esta compra, não precisa pagar com SODAX." });
        else setError({ code: e instanceof ApiError ? e.code : "error", text: e instanceof ApiError && e.status < 500 ? e.message : "Não foi possível consultar a cotação agora." });
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, agentId, type, source, logged, wallet, tick]);

  return (
    <div className="col" style={gap(14)}>
      <div className="row wrapx" role="group" aria-label="Rede e moeda de pagamento" style={gap(8)}>
        {sources.map((src) => (
          <Button
            key={src.key}
            size="sm"
            variant={src.key === source ? "primary" : "secondary"}
            aria-pressed={src.key === source}
            disabled={disabled}
            onClick={() => onSource(src.key)}
          >
            {src.label}
          </Button>
        ))}
      </div>

      {!logged ? (
        <p className="small muted">Entre na sua conta para ver a cotação ao vivo.</p>
      ) : error ? (
        <Notice
          tone={error.code === "balance_sufficient" ? "info" : "warn"}
          title={error.code === "balance_sufficient" ? "Sem necessidade de pagar" : "Cotação indisponível agora"}
          actions={
            error.code === "balance_sufficient" ? null : (
              <Button size="sm" variant="secondary" icon="refresh" onClick={() => setTick((n) => n + 1)}>
                Tentar de novo
              </Button>
            )
          }
        >
          {error.text}
        </Notice>
      ) : quote ? (
        <div className="col" style={gap(4)} aria-live="polite">
          <span className="muted small">Você pagaria, na outra rede</span>
          <span className="display num" style={{ fontSize: 32, lineHeight: 1.1 }}>
            ≈ {cryptoAmount(quote.payAmount, quote.source.symbol)}
          </span>
          <span className="small num">
            {rate != null ? <span>≈ {brl(credited, rate)} · </span> : null}
            chegam <b>{usdc(Math.round(credited * 100) / 100)}</b> na sua carteira
          </span>
          {quote.minApplied ? (
            <span className="tiny faint">
              <Icon name="info" size="s" /> O SODAX só aceita trocas a partir de cerca de US$ 1; por isso a cotação usa esse mínimo.
            </span>
          ) : null}
          <span className="tiny faint">
            Cotação ao vivo do SODAX · atualiza sozinha{loading ? " · atualizando…" : ""}
          </span>
        </div>
      ) : (
        <div className={`${s.status} small muted`} role="status" aria-live="polite">
          <Spinner size="s" /> Consultando o SODAX…
        </div>
      )}
    </div>
  );
}

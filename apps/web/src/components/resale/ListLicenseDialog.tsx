"use client";
// Anunciar a licença no mercado de revenda: preço em USDC, resumo de quanto cada parte recebe e assinatura.
// A licença continua na carteira (e em uso) até alguém comprar. O resumo usa a mesma conta do programa (resaleSplit).
import { resaleSplit, unitsToUsdc, usdcToUnits, type Agent, type License } from "@solvers/api-client";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Notice, useToast } from "@/components/ui/Toast";
import { bpsPct, brl, parseNum, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { useTx } from "@/lib/tx";
import { TxErrorNotice } from "./TxErrorNotice";

/** Só para a conta não estourar o inteiro de 64 bits do programa com um número digitado sem querer. */
const MAX_PRICE_USDC = 1_000_000_000;
/** O USDC tem 6 casas: mais que isso seria arredondado em silêncio. */
const MAX_DECIMALS = 6;
const decimalsOf = (text: string) => (text.trim().replace(",", ".").split(".")[1] ?? "").length;

export function ListLicenseDialog({
  license,
  agent,
  onClose,
  onListed,
}: {
  license: License;
  agent: Agent;
  onClose: () => void;
  /** Anúncio criado na rede: quem abriu recarrega a lista. */
  onListed: () => void;
}) {
  const { api, config } = useSession();
  const toast = useToast();
  const tx = useTx();
  const inputId = useId();
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  const rate = config?.brlPerUsd ?? null;
  const min = config?.minPurchaseUsdc ?? 0;
  const royaltyBps = agent.royaltyBps;
  // null: a taxa on-chain não foi consultada. Sem taxa conhecida não há resumo nem anúncio (nada de "Taxa 0%").
  const feeBps: number | null = config?.resaleFeeBps ?? null;
  const feeUnknown = !!config && feeBps === null;
  const maxCutBps = config?.resaleMaxCutBps ?? 0;
  // Royalty + taxa acima do teto: o programa recusa o anúncio, então nem deixamos tentar. Só com a taxa conhecida.
  const cutTooHigh = !!config && feeBps !== null && royaltyBps + feeBps > maxCutBps;
  const money = (v: number) => (rate != null ? brl(v, rate) : usdc(v));

  const price = parseNum(text);
  const priceOk = Number.isFinite(price) && price > 0 && price >= min && price <= MAX_PRICE_USDC && decimalsOf(text) <= MAX_DECIMALS;
  const split = useMemo(() => {
    if (!priceOk || cutTooHigh || !config || feeBps === null) return null;
    try {
      const r = resaleSplit(usdcToUnits(price), royaltyBps, feeBps);
      return { royalty: unitsToUsdc(r.royalty), fee: unitsToUsdc(r.fee), seller: unitsToUsdc(r.seller) };
    } catch {
      return null;
    }
  }, [priceOk, cutTooHigh, config, price, royaltyBps, feeBps]);

  const priceError =
    text.trim() === ""
      ? "Informe o preço."
      : !Number.isFinite(price)
        ? "Use só números, por exemplo 25 ou 12,50."
        : decimalsOf(text) > MAX_DECIMALS
          ? `Use no máximo ${MAX_DECIMALS} casas depois da vírgula.`
          : price > MAX_PRICE_USDC
            ? "Esse valor é alto demais."
            : `O preço mínimo é ${usdc(min)}.`;
  const showError = touched && !priceOk;
  const hintId = `${inputId}-ajuda`;
  const errId = `${inputId}-erro`;

  async function submit() {
    setTouched(true);
    if (!split || tx.pending) return;
    const r = await tx.run(() => api.buildListLicense(license.id, price));
    if (!r) return;
    toast({ tone: "ok", title: "Licença anunciada", text: "Ela já aparece no mercado de revenda. Você continua usando o especialista até alguém comprar." });
    onListed();
    onClose();
  }

  return (
    <Dialog title={`Anunciar ${agent.name}`} onClose={onClose} locked={tx.pending} width={520}>
      <form
        className="col"
        style={gap(16)}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {feeUnknown ? (
          <Notice tone="warn" role="alert" title="Não dá para anunciar agora">
            Não consegui consultar a taxa agora. Tente de novo em instantes.
          </Notice>
        ) : null}
        {cutTooHigh && feeBps !== null ? (
          <Notice tone="warn" role="alert" title="Este especialista não pode ser revendido agora">
            O royalty do criador ({bpsPct(royaltyBps)}) somado à taxa do Solvers ({bpsPct(feeBps)}) passa do limite de {bpsPct(maxCutBps)} do preço. Por isso a revenda
            dele está bloqueada.
          </Notice>
        ) : null}

        <div className="field">
          <label className="label" htmlFor={inputId}>
            Por quanto você quer vender? (em USDC)
          </label>
          <input
            id={inputId}
            className="input num"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder={`Mínimo ${min.toLocaleString("pt-BR")}`}
            data-autofocus
            disabled={tx.pending || cutTooHigh || feeUnknown}
            aria-invalid={showError}
            aria-describedby={showError ? `${hintId} ${errId}` : hintId}
            onChange={(e) => {
              setText(e.target.value);
              tx.reset();
            }}
            onBlur={() => setTouched(true)}
          />
          <span id={hintId} className="hint">
            {config ? `Preço mínimo: ${usdc(min)}.` : "Carregando as regras da revenda…"}
            {split && rate != null ? ` Isso dá cerca de ${brl(price, rate)}.` : ""}
          </span>
          {showError ? (
            <span id={errId} className="small warn" role="alert">
              {priceError}
            </span>
          ) : null}
        </div>

        <div className="col card-flat pad-s small" style={gap(8)} role="group" aria-label="Quanto cada parte recebe">
          <SummaryRow label="Preço" value={split ? price : null} money={money} />
          <SummaryRow label={`Royalty do criador (${bpsPct(royaltyBps)})`} value={split ? -split.royalty : null} money={money} />
          <SummaryRow label={feeBps === null ? "Taxa do Solvers" : `Taxa do Solvers (${bpsPct(feeBps)})`} value={split ? -split.fee : null} money={money} />
          <div className="divider" />
          <SummaryRow label="Você recebe" value={split ? split.seller : null} money={money} strong />
        </div>

        <ul className="col small muted" style={gap(8, { listStyle: "none", margin: 0, padding: 0 })}>
          <li className="row start" style={gap(10)}>
            <span className="ok">
              <Icon name="check-circle" size="s" />
            </span>
            <span>Você continua usando o especialista até alguém comprar.</span>
          </li>
          <li className="row start" style={gap(10)}>
            <span className="warn">
              <Icon name="info" size="s" />
            </span>
            <span>Suas memórias não vão junto com a licença. Elas ficam com você.</span>
          </li>
          <li className="row start" style={gap(10)}>
            <span className="faint">
              <Icon name="info" size="s" />
            </span>
            <span>Para mudar o preço depois, cancele o anúncio e anuncie de novo.</span>
          </li>
        </ul>

        {tx.error ? <TxErrorNotice error={tx.error} onRetry={() => void submit()} /> : null}
        <p className={tx.pending ? "small muted" : "sr-only"} role="status" aria-live="polite">
          {tx.pending ? "Assinando e registrando o anúncio…" : ""}
        </p>

        <div className="row end wrapx" style={gap(8)}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={tx.pending}>
            Cancelar
          </Button>
          <Button type="submit" icon="tag" loading={tx.pending} disabled={cutTooHigh || feeUnknown || !config}>
            Anunciar licença
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** USDC com até 4 casas (sem arredondar demais): a conta fecha ao somar as partes. */
const exactUsdc = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC`;

function SummaryRow({ label, value, money, strong }: { label: string; value: number | null; money: (v: number) => string; strong?: boolean }) {
  const text = value == null ? "—" : `${value < 0 ? "−" : ""}${money(Math.abs(value))}`;
  return (
    <div className="row between" style={gap(12, { alignItems: "baseline" })}>
      <span className={strong ? "bold" : "muted"}>{label}</span>
      <span className="num flex-none" style={{ textAlign: "right" }}>
        <span className={strong ? "bold" : undefined} style={strong ? { fontSize: 20 } : undefined}>
          {text}
        </span>
        {value != null ? <span className="tiny faint"> · {exactUsdc(Math.abs(value))}</span> : null}
      </span>
    </div>
  );
}

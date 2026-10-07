"use client";
// Transações: o servidor monta (e paga a taxa), a carteira só assina e o servidor envia e indexa.
import type { SubmitResponse, TxResponse } from "@solvers/api-client";
import { useLocale } from "next-intl";
import { useCallback, useState } from "react";
import { INTL_LOCALE, type Locale } from "@/i18n/routing";
import { ApiError, type SolversApi } from "./api";
import { detectLocale, errorsTranslator, localText, type ErrorsTranslator } from "./local-text";
import { useSession } from "./session";
import type { WalletLike } from "./wallet";

export class TxFailedError extends Error {
  constructor(
    message: string,
    public signature: string | null,
  ) {
    super(message);
  }
}

/**
 * Assina e envia uma transação montada pelo servidor (buildPurchase, buildEscrow, buildRelease...).
 * `built` pode ser a resposta ou uma função que a monta (assim erros do build caem no mesmo try).
 */
export type TxResult = SubmitResponse & {
  meta?: TxResponse["meta"];
  /** Link do explorador para a transação, montado pelo servidor na rede certa (null se ele não mandar). */
  explorerUrl: string | null;
};

export async function runTx(apiClient: SolversApi, wallet: WalletLike, built: TxResponse | (() => Promise<TxResponse>)): Promise<TxResult> {
  const tx = typeof built === "function" ? await built() : built;
  const res = await apiClient.signAndSubmit(wallet, tx);
  if (res.status !== "confirmed") throw new TxFailedError(res.error ?? localText("wallet.txFailedMessage"), res.signature);
  const extra = res as SubmitResponse & { explorerUrl?: unknown };
  return { ...res, meta: tx.meta, explorerUrl: typeof extra.explorerUrl === "string" ? extra.explorerUrl : null };
}

export type TxErrorInfo = {
  code: string;
  title: string;
  text: string;
  /** Ação sugerida na tela: receber USDC de teste, entrar de novo ou só tentar outra vez. */
  action: "faucet" | "login" | "retry" | null;
  /** Só em `listing_changed` (revenda): preço atual do anúncio, em USDC (a tela mostra o valor novo e pede a confirmação de novo). */
  listingPriceUsdc?: number;
  /** Só em `price_changed`: o preço on-chain mudou desde o que a tela mostrava (valores em USDC). */
  priceChange?: { previousUsdc: number; usdc: number };
};

type Action = TxErrorInfo["action"];

/** Texto da API para o código (errors.api.<code>); sem tradução, a mensagem que o servidor mandou. */
function apiText(t: ErrorsTranslator, err: ApiError): string {
  return err.code && t.has(`api.${err.code}`) ? t(`api.${err.code}`) : err.message;
}

/**
 * Mensagem (título + texto) no idioma da página para qualquer erro de transação/API.
 * Sem `locale`, vale o idioma da página no navegador (os chamadores rodam em eventos do cliente); nas telas,
 * `useLocale()` pode ser passado, ou use o hook `useTxErrorMessage()`.
 */
export function txErrorMessage(err: unknown, locale?: Locale): TxErrorInfo {
  const loc = locale ?? detectLocale();
  const t = errorsTranslator(loc);
  const fmt = (n: number) => n.toLocaleString(INTL_LOCALE[loc], { maximumFractionDigits: 2 });
  const msg = (code: string, id: string, action: Action = null, extra?: Partial<TxErrorInfo>): TxErrorInfo => ({
    code,
    title: t(`tx.${id}.title`),
    text: t(`tx.${id}.text`),
    action,
    ...extra,
  });
  const withText = (code: string, id: string, text: string, action: Action = null): TxErrorInfo => ({ code, title: t(`tx.${id}.title`), text, action });

  if (err instanceof ApiError) {
    const b = err.body;
    // /api/tx/submit não conseguiu confirmar: a transação pode ter sido enviada. Não diz que nada foi cobrado
    // e não sugere tentar de novo já (evita pagar em dobro).
    if (err.code === "unconfirmed") return msg(err.code, "unconfirmed");
    // /api/tx/submit: a rede recusou a transação (HTTP 422, {status:"failed", error} sem código). O caso comum é
    // o blockhash expirar enquanto a pessoa assina; tentar de novo monta uma transação nova.
    if (err.status === 422 || b.status === "failed") return msg("transaction_failed", "network_failed", "retry");
    switch (err.code) {
      case "insufficient_funds": {
        const need = typeof b.neededUsdc === "number" ? b.neededUsdc : null;
        const bal = typeof b.balanceUsdc === "number" ? b.balanceUsdc : null;
        if (need != null && bal != null) {
          return {
            code: err.code,
            title: t("tx.insufficient_funds_amounts.title"),
            text: t("tx.insufficient_funds_amounts.text", { balance: fmt(bal), needed: fmt(need) }),
            action: "faucet",
          };
        }
        return msg(err.code, "insufficient_funds", "faucet");
      }
      case "price_changed": {
        const now = typeof b.priceUsdc === "number" ? b.priceUsdc : null;
        const before = typeof b.previousPriceUsdc === "number" ? b.previousPriceUsdc : null;
        if (now != null && before != null) {
          return {
            code: err.code,
            title: t("tx.price_changed_amounts.title"),
            text: t("tx.price_changed_amounts.text", { before: fmt(before), now: fmt(now) }),
            action: null,
            priceChange: { previousUsdc: before, usdc: now },
          };
        }
        return msg(err.code, "price_changed");
      }
      // ----- Teto de licenças (SUPPLY_ERROR_CODES, @solvers/shared) -----
      case "sold_out":
        return msg(err.code, "sold_out");
      // ----- Revenda de licenças (códigos em RESALE_ERROR_CODES, @solvers/shared) -----
      case "resale_disabled":
        return msg(err.code, "resale_disabled");
      case "listing_not_found":
        return msg(err.code, "listing_not_found");
      case "listing_changed": {
        const now = typeof b.priceUsdc === "number" ? b.priceUsdc : null;
        if (now != null) {
          return {
            code: err.code,
            title: t("tx.listing_changed_amount.title"),
            text: t("tx.listing_changed_amount.text", { now: fmt(now) }),
            action: null,
            listingPriceUsdc: now,
          };
        }
        return msg(err.code, "listing_changed");
      }
      case "not_owner":
      case "own_listing":
      case "price_too_low":
      case "already_listed":
      case "cut_too_high":
      case "creator_cannot_resell":
      case "cancel_via_wallet":
      case "license_invalid":
      case "license_already_reviewed":
        return msg(err.code, err.code);
      case "guarantee_limit": {
        const limit = typeof b.limitUsdc === "number" ? b.limitUsdc : null;
        const open = typeof b.openUsdc === "number" ? b.openUsdc : null;
        if (limit != null && open != null) {
          return {
            code: err.code,
            title: t("tx.guarantee_limit_amounts.title"),
            text: t("tx.guarantee_limit_amounts.text", { limit: fmt(limit), open: fmt(open) }),
            action: null,
          };
        }
        return msg(err.code, "guarantee_limit");
      }
      // ----- Publicação de pacote (co-assinatura do criador) -----
      case "submission_state":
      case "not_approved":
      case "wrong_step":
      case "publication_blocked":
        return msg(err.code, err.code);
      case "rate_limited":
        return msg(err.code, "rate_limited", "retry");
      case "unauthorized":
        return msg(err.code, "unauthorized", "login");
      case "faucet_cooldown":
      case "faucet_daily_cap":
        return withText(err.code, "faucet_unavailable", apiText(t, err));
      case "invalid_criterion":
        return msg(err.code, "invalid_criterion");
      case "transaction_failed":
        return withText(err.code, "transaction_failed", apiText(t, err), "retry");
      case "validation":
      case "bad_request":
        return withText(err.code, "bad_request", err.message);
      default:
        if (err.status >= 500) return msg(err.code, "server_error", "retry");
        return withText(err.code, "bad_request", apiText(t, err));
    }
  }
  if (err instanceof TxFailedError) return msg("transaction_failed", "network_failed_short", "retry");
  const m = err instanceof Error ? err.message : String(err);
  if (/cancel|rejected|denied|exited|cancelad/i.test(m)) return msg("cancelled", "cancelled");
  return { code: "unknown", title: t("tx.unknown.title"), text: m || t("tx.unknown.text"), action: "retry" };
}

/** Para as telas: `const errorInfo = useTxErrorMessage(); errorInfo(e).text` já no idioma da página (também no SSR). */
export function useTxErrorMessage(): (err: unknown) => TxErrorInfo {
  const locale = useLocale() as Locale;
  return useCallback((err: unknown) => txErrorMessage(err, locale), [locale]);
}

/**
 * Hook para as telas: `const { run, pending, error } = useTx();`
 * `await run(() => api.buildPurchase(agent.id))` faz o login se preciso, assina, envia e devolve o resultado
 * (`signature`, `meta` e `explorerUrl`), ou null em caso de erro, que fica em `error` já traduzido.
 */
export function useTx() {
  const { api, requireWallet } = useSession();
  const locale = useLocale() as Locale;
  const [pending, setPending] = useState(false);
  // Guarda o erro cru: o texto é montado a cada render, no idioma atual da página.
  const [raw, setRaw] = useState<{ e: unknown } | null>(null);
  const [result, setResult] = useState<TxResult | null>(null);

  const run = useCallback(
    async (build: () => Promise<TxResponse>) => {
      setPending(true);
      setRaw(null);
      try {
        const wallet = await requireWallet();
        const r = await runTx(api, wallet, build);
        setResult(r);
        return r;
      } catch (e) {
        setRaw({ e });
        return null;
      } finally {
        setPending(false);
      }
    },
    [api, requireWallet],
  );

  const error: TxErrorInfo | null = raw ? txErrorMessage(raw.e, locale) : null;
  return { run, pending, error, result, explorerUrl: result?.explorerUrl ?? null, reset: () => setRaw(null) };
}

/**
 * USDC de teste (devnet/localnet): `enabled` segue getConfig().faucetEnabled.
 * `receive()` faz o login se preciso e devolve o valor recebido (ou null com `error` traduzido).
 */
export function useFaucet() {
  const { api, config, requireWallet } = useSession();
  const locale = useLocale() as Locale;
  const [pending, setPending] = useState(false);
  const [raw, setRaw] = useState<{ e: unknown } | null>(null);

  const receive = useCallback(async () => {
    setPending(true);
    setRaw(null);
    try {
      await requireWallet();
      const r = await api.faucet();
      return r.amountUsdc;
    } catch (e) {
      setRaw({ e });
      return null;
    } finally {
      setPending(false);
    }
  }, [api, requireWallet]);

  const error: TxErrorInfo | null = raw ? txErrorMessage(raw.e, locale) : null;
  return { enabled: !!config?.faucetEnabled, amountUsdc: config?.faucetAmountUsdc ?? null, receive, pending, error };
}

"use client";
// Transações: o servidor monta (e paga a taxa), a carteira só assina e o servidor envia e indexa.
import type { SubmitResponse, TxResponse } from "@solvers/api-client";
import { useCallback, useState } from "react";
import { ApiError, type SolversApi } from "./api";
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
export async function runTx(
  apiClient: SolversApi,
  wallet: WalletLike,
  built: TxResponse | (() => Promise<TxResponse>),
): Promise<SubmitResponse & { meta?: TxResponse["meta"] }> {
  const tx = typeof built === "function" ? await built() : built;
  const res = await apiClient.signAndSubmit(wallet, tx);
  if (res.status !== "confirmed") throw new TxFailedError(res.error ?? "A transação falhou na rede.", res.signature);
  return { ...res, meta: tx.meta };
}

export type TxErrorInfo = {
  code: string;
  title: string;
  text: string;
  /** Ação sugerida na tela: receber USDC de teste, entrar de novo ou só tentar outra vez. */
  action: "faucet" | "login" | "retry" | null;
};

/** Mensagem em português para qualquer erro de transação/API. */
export function txErrorMessage(err: unknown): TxErrorInfo {
  if (err instanceof ApiError) {
    const b = err.body;
    switch (err.code) {
      case "insufficient_funds": {
        const need = typeof b.neededUsdc === "number" ? b.neededUsdc : null;
        const bal = typeof b.balanceUsdc === "number" ? b.balanceUsdc : null;
        return {
          code: err.code,
          title: "Saldo de USDC insuficiente",
          text:
            need != null && bal != null
              ? `Você tem ${fmt(bal)} USDC e precisa de ${fmt(need)} USDC.`
              : "Seu saldo em USDC não cobre esta compra.",
          action: "faucet",
        };
      }
      case "guarantee_limit":
        return { code: err.code, title: "Limite de garantias atingido", text: err.message, action: null };
      case "rate_limited":
        return { code: err.code, title: "Muitas tentativas", text: "Aguarde um minuto e tente de novo.", action: "retry" };
      case "unauthorized":
        return { code: err.code, title: "Sua sessão expirou", text: "Entre de novo para continuar.", action: "login" };
      case "faucet_cooldown":
      case "faucet_daily_cap":
        return { code: err.code, title: "USDC de teste indisponível agora", text: err.message, action: null };
      case "transaction_failed":
        return { code: err.code, title: "A transação falhou na rede", text: err.message, action: "retry" };
      case "validation":
      case "bad_request":
        return { code: err.code, title: "Não deu para concluir", text: err.message, action: null };
      default:
        if (err.status >= 500) return { code: err.code, title: "O servidor não respondeu bem", text: "Tente de novo em instantes.", action: "retry" };
        return { code: err.code, title: "Não deu para concluir", text: err.message, action: null };
    }
  }
  if (err instanceof TxFailedError) return { code: "transaction_failed", title: "A transação falhou na rede", text: err.message, action: "retry" };
  const msg = err instanceof Error ? err.message : String(err);
  if (/cancel|rejected|denied|exited/i.test(msg)) return { code: "cancelled", title: "Assinatura cancelada", text: "Nada foi cobrado.", action: null };
  return { code: "unknown", title: "Algo deu errado", text: msg || "Tente de novo.", action: "retry" };
}

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Hook para as telas: `const { run, pending, error } = useTx();`
 * `await run(() => api.buildPurchase(agent.id))` faz o login se preciso, assina, envia e devolve o resultado
 * (ou null em caso de erro, que fica em `error` já traduzido).
 */
export function useTx() {
  const { api, requireWallet } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runTx>> | null>(null);

  const run = useCallback(
    async (build: () => Promise<TxResponse>) => {
      setPending(true);
      setError(null);
      try {
        const wallet = await requireWallet();
        const r = await runTx(api, wallet, build);
        setResult(r);
        return r;
      } catch (e) {
        setError(txErrorMessage(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [api, requireWallet],
  );

  return { run, pending, error, result, reset: () => setError(null) };
}

/**
 * USDC de teste (devnet/localnet): `enabled` segue getConfig().faucetEnabled.
 * `receive()` faz o login se preciso e devolve o valor recebido (ou null com `error` traduzido).
 */
export function useFaucet() {
  const { api, config, requireWallet } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);

  const receive = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await requireWallet();
      const r = await api.faucet();
      return r.amountUsdc;
    } catch (e) {
      setError(txErrorMessage(e));
      return null;
    } finally {
      setPending(false);
    }
  }, [api, requireWallet]);

  return { enabled: !!config?.faucetEnabled, amountUsdc: config?.faucetAmountUsdc ?? null, receive, pending, error };
}

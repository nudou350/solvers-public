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
export type TxResult = SubmitResponse & {
  meta?: TxResponse["meta"];
  /** Link do explorador para a transação, montado pelo servidor na rede certa (null se ele não mandar). */
  explorerUrl: string | null;
};

export async function runTx(apiClient: SolversApi, wallet: WalletLike, built: TxResponse | (() => Promise<TxResponse>)): Promise<TxResult> {
  const tx = typeof built === "function" ? await built() : built;
  const res = await apiClient.signAndSubmit(wallet, tx);
  if (res.status !== "confirmed") throw new TxFailedError(res.error ?? "A transação falhou na rede.", res.signature);
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

/** Mensagem em português para qualquer erro de transação/API. */
export function txErrorMessage(err: unknown): TxErrorInfo {
  if (err instanceof ApiError) {
    const b = err.body;
    // /api/tx/submit não conseguiu confirmar: a transação pode ter sido enviada. Não diz que nada foi cobrado
    // e não sugere tentar de novo já (evita pagar em dobro).
    if (err.code === "unconfirmed")
      return {
        code: err.code,
        title: "Ainda não conseguimos confirmar",
        text: "Sua transação foi enviada, mas ainda não conseguimos confirmar. Aguarde um instante e confira em Minha conta antes de tentar de novo.",
        action: null,
      };
    // /api/tx/submit: a rede recusou a transação (HTTP 422, {status:"failed", error} sem código). O caso comum é
    // o blockhash expirar enquanto a pessoa assina; tentar de novo monta uma transação nova.
    if (err.status === 422 || b.status === "failed")
      return {
        code: "transaction_failed",
        title: "A rede não confirmou a transação",
        text: "Nada foi cobrado. Às vezes a transação expira enquanto você assina. Tente de novo: montamos uma nova.",
        action: "retry",
      };
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
      case "price_changed": {
        const now = typeof b.priceUsdc === "number" ? b.priceUsdc : null;
        const before = typeof b.previousPriceUsdc === "number" ? b.previousPriceUsdc : null;
        return {
          code: err.code,
          title: "O preço do especialista mudou",
          text:
            now != null && before != null
              ? `O preço do especialista mudou de ${fmt(before)} USDC para ${fmt(now)} USDC. Confira o novo valor e confirme de novo.`
              : "O preço do especialista mudou. Confira o novo valor e confirme de novo.",
          action: null,
          priceChange: now != null && before != null ? { previousUsdc: before, usdc: now } : undefined,
        };
      }
      // ----- Teto de licenças (SUPPLY_ERROR_CODES, @solvers/shared) -----
      case "sold_out":
        return {
          code: err.code,
          title: "Acabaram as vagas",
          text: "Todas as licenças deste especialista já foram vendidas. Nada foi cobrado. Quem já tem uma licença pode revendê-la no mercado, quando a revenda estiver aberta.",
          action: null,
        };
      // ----- Revenda de licenças (códigos em RESALE_ERROR_CODES, @solvers/shared) -----
      case "resale_disabled":
        return { code: err.code, title: "A revenda não está aberta agora", text: "O mercado de revenda está fechado por enquanto. Tente de novo mais tarde.", action: null };
      case "listing_not_found":
        return {
          code: err.code,
          title: "Esse anúncio não está mais disponível",
          text: "Ele foi vendido, cancelado ou mudou. Veja os outros anúncios do mercado de revenda.",
          action: null,
        };
      case "listing_changed": {
        const now = typeof b.priceUsdc === "number" ? b.priceUsdc : null;
        return {
          code: err.code,
          title: "O preço do anúncio mudou",
          text:
            now != null
              ? `O vendedor mudou o preço para ${fmt(now)} USDC. Confira o novo valor e confirme de novo.`
              : "O vendedor mudou o preço. Confira o novo valor e confirme de novo.",
          action: null,
          listingPriceUsdc: now ?? undefined,
        };
      }
      case "not_owner":
        return {
          code: err.code,
          title: "Esta licença não é da sua conta",
          text: "Só quem tem a licença pode anunciar ou cancelar o anúncio. Atualize a página e confira sua biblioteca.",
          action: null,
        };
      case "own_listing":
        return {
          code: err.code,
          title: "Esse anúncio é seu",
          text: "Você não pode comprar a própria licença. Para tirá-la do mercado, cancele o anúncio na sua biblioteca.",
          action: null,
        };
      case "price_too_low":
        return { code: err.code, title: "O preço está baixo demais", text: "Escolha um valor igual ou maior que o mínimo e tente de novo.", action: null };
      case "already_listed":
        return {
          code: err.code,
          title: "Esta licença já está à venda",
          text: "Atualize a página. Para mudar o preço, cancele o anúncio e anuncie de novo.",
          action: null,
        };
      case "cut_too_high":
        return {
          code: err.code,
          title: "Este especialista não pode ser revendido agora",
          text: "A soma do royalty do criador com a taxa do Solvers passa do limite permitido numa revenda.",
          action: null,
        };
      case "creator_cannot_resell":
        return {
          code: err.code,
          title: "Criadores não revendem os próprios especialistas",
          text: "Você criou este especialista, então não pode anunciar licenças dele no mercado.",
          action: null,
        };
      case "cancel_via_wallet":
        return {
          code: err.code,
          title: "Cancele o anúncio pela sua carteira",
          text: "Não dá para cancelar este anúncio por aqui. Na sua carteira, retire a permissão de venda da licença e depois atualize a página. Enquanto isso a licença continua sendo sua.",
          action: null,
        };
      case "license_invalid":
        return { code: err.code, title: "Não reconhecemos esta licença", text: "Atualize a página e tente de novo. Se continuar, fale com o suporte.", action: null };
      case "license_already_reviewed":
        return {
          code: err.code,
          title: "Esta licença já foi usada numa avaliação",
          text: "Quem vendeu a licença usada já avaliou o especialista com ela, e cada licença serve para uma avaliação só. A nota do especialista segue valendo para você.",
          action: null,
        };
      case "guarantee_limit":
        return { code: err.code, title: "Limite de garantias atingido", text: err.message, action: null };
      // ----- Publicação de pacote (co-assinatura do criador) -----
      case "submission_state":
        return { code: err.code, title: "Este envio não espera a sua confirmação agora", text: "Atualize a página para ver em que passo ele está.", action: null };
      case "not_approved":
        return { code: err.code, title: "Esta versão ainda não foi aprovada", text: "A confirmação só abre depois da aprovação da equipe.", action: null };
      case "wrong_step":
        return { code: err.code, title: "Este não é o passo certo agora", text: "Atualize a página: ela mostra o passo que falta.", action: null };
      case "publication_blocked":
        return { code: err.code, title: "Este especialista está bloqueado na rede", text: "Ele está suspenso ou registrado por outra conta. Fale com a equipe.", action: null };
      case "rate_limited":
        return { code: err.code, title: "Muitas tentativas", text: "Aguarde um minuto e tente de novo.", action: "retry" };
      case "unauthorized":
        return { code: err.code, title: "Sua sessão expirou", text: "Entre de novo para continuar.", action: "login" };
      case "faucet_cooldown":
      case "faucet_daily_cap":
        return { code: err.code, title: "USDC de teste indisponível agora", text: err.message, action: null };
      case "invalid_criterion":
        return { code: err.code, title: "Escolha um dos critérios combinados", text: "A contestação precisa apontar um dos critérios da etapa.", action: null };
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
  if (err instanceof TxFailedError)
    return { code: "transaction_failed", title: "A rede não confirmou a transação", text: "Nada foi cobrado. Tente de novo: montamos uma nova.", action: "retry" };
  const msg = err instanceof Error ? err.message : String(err);
  if (/cancel|rejected|denied|exited/i.test(msg)) return { code: "cancelled", title: "Assinatura cancelada", text: "Nada foi cobrado.", action: null };
  return { code: "unknown", title: "Algo deu errado", text: msg || "Tente de novo.", action: "retry" };
}

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Hook para as telas: `const { run, pending, error } = useTx();`
 * `await run(() => api.buildPurchase(agent.id))` faz o login se preciso, assina, envia e devolve o resultado
 * (`signature`, `meta` e `explorerUrl`), ou null em caso de erro, que fica em `error` já traduzido.
 */
export function useTx() {
  const { api, requireWallet } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TxErrorInfo | null>(null);
  const [result, setResult] = useState<TxResult | null>(null);

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

  return { run, pending, error, result, explorerUrl: result?.explorerUrl ?? null, reset: () => setError(null) };
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

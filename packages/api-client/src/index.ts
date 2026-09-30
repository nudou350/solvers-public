import {
  Agent,
  AgentDetail,
  ConnectorStatus,
  CreatorDashboard,
  CreatorProfile,
  Escrow,
  License,
  Memory,
  Profile,
  Review,
  SubmitResponse,
  TxResponse,
  UserReputation,
} from "@solvers/shared";
import { z, type ZodTypeAny } from "zod";

// Cliente da API do Solvers para a vitrine (INSTRUCTIONS.md 8). Mesmos nomes dos mocks:
// troque `import { agents } from "./mocks"` por `await api.getAgents()`.
// Toda resposta é validada com os schemas de @solvers/shared: divergência de contrato quebra cedo.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type ApiOptions = {
  /** Base da API. No mesmo domínio da vitrine, deixe vazio ("") e use caminhos relativos. */
  baseUrl?: string;
  /** Token Bearer (SSR/testes). No navegador, o cookie httpOnly da sessão já basta. */
  token?: string;
  fetch?: typeof fetch;
};

/** Carteira mínima que a vitrine precisa (Wallet Standard, Phantom, Privy...). */
export type WalletLike = {
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Assina a transação serializada (bytes) e devolve os bytes assinados. */
  signTransaction(tx: Uint8Array): Promise<Uint8Array>;
};

const toB64 = (b: Uint8Array) => {
  let s = "";
  b.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createApi(opts: ApiOptions = {}) {
  const base = (opts.baseUrl ?? "").replace(/\/$/, "");
  const f = opts.fetch ?? fetch;

  async function req<S extends ZodTypeAny>(schema: S, path: string, init: RequestInit = {}): Promise<z.infer<S>> {
    const res = await f(`${base}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, String(body.code ?? "error"), String(body.error ?? res.statusText), body);
    return schema.parse(body);
  }
  const post = <S extends ZodTypeAny>(schema: S, path: string, body?: unknown) =>
    req(schema, path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  const api = {
    // ----- Loja (público) -----
    getConfig: () =>
      req(
        z.object({
          cluster: z.string(),
          programId: z.string(),
          usdcMint: z.string(),
          feePayer: z.string(),
          feeBps: z.number().nullable(),
          minPurchaseUsdc: z.number(),
          faucetEnabled: z.boolean(),
          faucetAmountUsdc: z.number(),
          connectorUrl: z.string(),
        }).passthrough(),
        "/api/config",
      ),
    getAgents: (q: { q?: string; category?: string; sort?: "rating" | "uses" | "trend" | "new"; limit?: number } = {}) => {
      const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      return req(z.array(Agent), `/api/agents${p.size ? `?${p}` : ""}`);
    },
    getCategories: () => req(z.array(z.object({ category: z.string(), count: z.number() })), "/api/categories"),
    getAgent: (idOrSlug: string) => req(AgentDetail, `/api/agents/${encodeURIComponent(idOrSlug)}`),
    getReviews: (idOrSlug: string) => req(z.array(Review), `/api/agents/${encodeURIComponent(idOrSlug)}/reviews`),
    search: (need: string) => post(z.array(Agent), "/api/search", { need }),
    getCreator: (id: string) => req(CreatorProfile, `/api/creators/${encodeURIComponent(id)}`),

    // ----- Login com carteira (SIWS) -----
    async login(wallet: WalletLike) {
      const { message } = await req(z.object({ message: z.string() }), `/api/auth/nonce?wallet=${wallet.address}`);
      const signature = toB64(await wallet.signMessage(new TextEncoder().encode(message)));
      return post(z.object({ wallet: z.string() }).passthrough(), "/api/auth/verify", { wallet: wallet.address, message, signature });
    },
    logout: () => post(z.object({ ok: z.boolean() }), "/api/auth/logout"),
    me: () => req(z.object({ wallet: z.string() }), "/api/auth/me"),

    // ----- Minha conta -----
    getMyLicenses: () => req(z.array(License), "/api/me/licenses"),
    getMyEscrows: () => req(z.array(Escrow), "/api/me/escrows"),
    getMyEscrow: (id: string) => req(z.object({ escrow: Escrow }).passthrough(), `/api/me/escrows/${id}`),
    getReputation: () => req(UserReputation, "/api/me/reputation"),
    getProfile: () => req(Profile, "/api/me/profile"),
    getBalance: () => req(z.object({ usdc: z.number() }), "/api/me/balance"),
    faucet: () => post(z.object({ signature: z.string(), amountUsdc: z.number() }).passthrough(), "/api/faucet"),

    /** Memórias: se a API responder 409 memory_key_required, chame unlockMemories e tente de novo. */
    getMemories: () => req(z.array(Memory), "/api/me/memories"),
    async unlockMemories(wallet: WalletLike, message = "Solvers memory key v1") {
      const signature = toB64(await wallet.signMessage(new TextEncoder().encode(message)));
      return post(z.object({ ok: z.boolean() }), "/api/me/memory-key", { signature });
    },
    deleteMemory: (id: string) => req(z.object({ ok: z.boolean() }), `/api/me/memories/${id}`, { method: "DELETE" }),
    deleteAllMemories: () => req(z.object({ ok: z.boolean() }), "/api/me/memories", { method: "DELETE" }),

    getConnector: () => req(ConnectorStatus, "/api/connector"),
    revokeConnector: () => post(z.object({ revoked: z.number() }), "/api/connector/revoke"),
    getCreatorDashboard: () => req(CreatorDashboard, "/api/creator/dashboard"),

    // ----- Transações: o servidor monta e paga a taxa; a carteira só assina -----
    buildPurchase: (agentId: string, type: "permanent" | "credits" = "permanent", amount?: number) =>
      post(TxResponse, "/api/tx/purchase", { agentId, type, amount }),
    buildReview: (agentId: string, rating: number, text: string) => post(TxResponse, "/api/tx/review", { agentId, rating, text }),
    buildEscrow: (agentId: string, milestones: { title: string; criteria: string; amountUsdc: number }[]) =>
      post(TxResponse, "/api/tx/escrow", { agentId, milestones }),
    buildRelease: (escrowId: string, index: number) => post(TxResponse, `/api/tx/escrow/${escrowId}/release`, { index }),
    buildDispute: (escrowId: string, index: number, criterion: string, reason: string) =>
      post(TxResponse, `/api/tx/escrow/${escrowId}/dispute`, { index, criterion, reason }),
    submit: (transaction: string) => post(SubmitResponse.passthrough(), "/api/tx/submit", { transaction }),

    /** Fluxo completo: monta no servidor -> carteira assina -> servidor envia e indexa. */
    async signAndSubmit(wallet: WalletLike, built: TxResponse) {
      const signed = await wallet.signTransaction(fromB64(built.transaction));
      return api.submit(toB64(signed));
    },
  };
  return api;
}

export type SolversApi = ReturnType<typeof createApi>;
export * from "@solvers/shared";

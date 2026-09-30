import {
  Agent,
  AgentDetail,
  ConnectorStatus,
  Creator,
  CreatorDashboard,
  CreatorProfile,
  Escrow,
  EscrowDetail,
  GuaranteeStatus,
  License,
  ResaleListing,
  Memory,
  PixCharge,
  Profile,
  PublicConfig,
  Review,
  SubmitResponse,
  TxResponse,
  UsageSummary,
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
    getConfig: () => req(PublicConfig, "/api/config"),
    getAgents: (q: { q?: string; category?: string; sort?: "rating" | "uses" | "trend" | "new"; limit?: number } = {}) => {
      const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      return req(z.array(Agent), `/api/agents${p.size ? `?${p}` : ""}`);
    },
    getCategories: () => req(z.array(z.object({ category: z.string(), count: z.number() })), "/api/categories"),
    getAgent: (idOrSlug: string) => req(AgentDetail, `/api/agents/${encodeURIComponent(idOrSlug)}`),
    getReviews: (idOrSlug: string) => req(z.array(Review), `/api/agents/${encodeURIComponent(idOrSlug)}/reviews`),
    search: (need: string) => post(z.array(Agent), "/api/search", { need }),
    getCreator: (id: string) => req(CreatorProfile, `/api/creators/${encodeURIComponent(id)}`),
    /** Criadores com especialista na vitrine: monte um mapa por id para os cards (nome e reputação). */
    getCreators: () => req(z.array(Creator), "/api/creators"),

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
    getMyEscrow: (id: string) => req(EscrowDetail, `/api/me/escrows/${id}`),
    downloadDeliverable: (escrowId: string, index: number) =>
      req(z.object({ files: z.record(z.string()) }), `/api/me/escrows/${escrowId}/milestones/${index}/download`),
    getMyUsage: () => req(z.array(UsageSummary), "/api/me/usage"),
    /** Limite de garantias da carteira: quanto ainda pode abrir e quantas compras faltam para o nível completo. */
    getMyGuarantee: () => req(GuaranteeStatus, "/api/me/guarantee"),
    getMyAccess: (idOrSlug: string) =>
      req(
        z.object({ agentId: z.string(), license: z.string().nullable(), creditsLeft: z.number().nullable(), trialUsesLeft: z.number() }),
        `/api/me/access/${encodeURIComponent(idOrSlug)}`,
      ),
    refreshLicenses: () => post(z.object({ ok: z.boolean() }), "/api/me/licenses/refresh"),
    getMemoriesCount: () =>
      req(z.object({ count: z.number(), agents: z.array(z.object({ agentId: z.string(), updatedAt: z.string() })) }), "/api/me/memories/count"),
    getResaleListings: () => req(z.array(ResaleListing), "/api/market/listings"),
    getReputation: () => req(UserReputation, "/api/me/reputation"),
    getProfile: () => req(Profile, "/api/me/profile"),
    updateProfile: (data: { displayName?: string | null; email?: string | null }) =>
      req(z.object({ ok: z.boolean() }), "/api/me/profile", { method: "PATCH", body: JSON.stringify(data) }),
    getBalance: () => req(z.object({ usdc: z.number() }), "/api/me/balance"),
    /**
     * Pix na demo: cria a cobrança (QR / copia e cola). Com agentId, o servidor calcula quanto falta
     * (preço, pacote mínimo de créditos ou garantia, menos o saldo). Consulte com getPixCharge até
     * status "credited"; depois siga para a compra normal.
     */
    createPixCharge: (body: { usdc: number } | { agentId: string; type: "permanent" | "credits" | "guarantee" }) =>
      post(PixCharge, "/api/pix/charges", body),
    getPixCharge: (id: string) => req(PixCharge, `/api/pix/charges/${encodeURIComponent(id)}`),
    /** Só quando getConfig().pix.simulate: aprova a cobrança sem pagar e credita o USDC de teste. */
    simulatePixPayment: (id: string) => post(PixCharge, `/api/pix/charges/${encodeURIComponent(id)}/simulate`),
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
    /**
     * Tarefa com garantia: as etapas e os critérios vêm do modelo do criador (getAgent().guarantee);
     * o comprador só dá um título e descreve o que quer. acceptanceTests é opcional, por etapa.
     */
    buildEscrow: (agentId: string, task: { title: string; description: string; acceptanceTests?: (Record<string, string> | null)[] }) =>
      post(TxResponse, "/api/tx/escrow", { agentId, ...task }),
    buildRelease: (escrowId: string, index: number) => post(TxResponse, `/api/tx/escrow/${escrowId}/release`, { index }),
    buildDispute: (escrowId: string, index: number, criterion: string, reason: string) =>
      post(TxResponse, `/api/tx/escrow/${escrowId}/dispute`, { index, criterion, reason }),
    submit: (transaction: string) => post(SubmitResponse.passthrough(), "/api/tx/submit", { transaction }),
    /** Para quem envia pela carteira (signAndSendTransaction): confirma e indexa na hora. */
    confirm: (signature: string) => post(SubmitResponse.passthrough(), "/api/tx/confirm", { signature }),

    // ----- Admin (só funciona no servidor com ADMIN_KEYPAIR) -----
    adminDisputes: () =>
      req(z.array(z.object({ escrowId: z.string(), index: z.number(), title: z.string(), criteria: z.string(), criterion: z.string().nullable(), reason: z.string().nullable() })), "/api/admin/disputes"),
    adminResolve: (escrowId: string, index: number, refund: boolean) =>
      post(z.object({ signature: z.string() }).passthrough(), `/api/admin/escrow/${escrowId}/resolve`, { index, refund }),
    adminApprove: (agentId: string) => post(z.object({ signature: z.string() }), `/api/admin/agents/${agentId}/approve`),

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

import {
  AdminSubmissionDetail,
  AdminSubmissionRow,
  Agent,
  AgentAccess,
  AgentDetail,
  ConnectorStatus,
  Creator,
  CreatorDashboard,
  CreatorMe,
  CreatorProfile,
  type CreatorProfileInput,
  type AdminReviewInput,
  type SubmissionStatus,
  SubmissionView,
  PublicationPlan,
  PublicationResult,
  type CreatorSigningStep,
  Escrow,
  EscrowDetail,
  GuaranteeStatus,
  License,
  ResaleListing,
  Memory,
  MyTrial,
  PixCharge,
  Profile,
  PublicConfig,
  ImageRef,
  Review,
  SodaxQuote,
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

  /** POST /tx/(register-agent|update-version|update-pricing): garante `meta.{kind, submissionId}` para o /tx/submit. */
  const buildSubmissionTx = async (kind: string, path: string, submissionId: string): Promise<TxResponse> => {
    const tx = await post(TxResponse, path, { submissionId });
    return { ...tx, meta: { ...tx.meta, kind: typeof tx.meta?.kind === "string" ? tx.meta.kind : kind, submissionId } };
  };

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
    /** Licença ou saldo do teste grátis (usos, consultas e execuções de ferramenta restantes). */
    getMyTrials: () => req(z.array(MyTrial), "/api/me/trials"),
    getMyAccess: (idOrSlug: string) => req(AgentAccess, `/api/me/access/${encodeURIComponent(idOrSlug)}`),
    refreshLicenses: () => post(z.object({ ok: z.boolean() }), "/api/me/licenses/refresh"),
    getMemoriesCount: () =>
      req(z.object({ count: z.number(), agents: z.array(z.object({ agentId: z.string(), updatedAt: z.string() })) }), "/api/me/memories/count"),
    /**
     * Anúncios ativos de revenda (um por licença), do mais barato ao mais caro (teto de 200 na listagem geral);
     * `agent` = slug para filtrar um especialista; `license` = id da licença (o anúncio ativo dela, sem o teto).
     */
    getResaleListings: (params?: { agent?: string; license?: string }) => {
      const qs = new URLSearchParams();
      if (params?.agent) qs.set("agent", params.agent);
      if (params?.license) qs.set("license", params.license);
      const q = qs.toString();
      return req(z.array(ResaleListing), `/api/market/listings${q ? `?${q}` : ""}`);
    },
    /** O anúncio ativo de uma licença (checkout de revenda); null quando não há (vendido, cancelado ou inexistente). */
    getResaleListing: async (licenseId: string) => (await req(z.array(ResaleListing), `/api/market/listings?${new URLSearchParams({ license: licenseId })}`))[0] ?? null,
    getReputation: () => req(UserReputation, "/api/me/reputation"),
    getProfile: () => req(Profile, "/api/me/profile"),
    updateProfile: (data: { displayName?: string | null; email?: string | null }) =>
      req(z.object({ ok: z.boolean() }), "/api/me/profile", { method: "PATCH", body: JSON.stringify(data) }),
    getBalance: () => req(z.object({ usdc: z.number() }), "/api/me/balance"),
    /**
     * Pix na demo: cria a cobrança (QR / copia e cola). Com agentId, o servidor calcula quanto falta
     * (preço da licença ou da garantia, menos o saldo). Consulte com getPixCharge até
     * status "credited"; depois siga para a compra normal.
     */
    createPixCharge: (body: { usdc: number } | { agentId: string; type: "permanent" | "guarantee" }) =>
      post(PixCharge, "/api/pix/charges", body),
    getPixCharge: (id: string) => req(PixCharge, `/api/pix/charges/${encodeURIComponent(id)}`),
    /** Só quando getConfig().pix.simulate: aprova a cobrança sem pagar e credita o USDC de teste. */
    simulatePixPayment: (id: string) => post(PixCharge, `/api/pix/charges/${encodeURIComponent(id)}/simulate`),
    /**
     * SODAX na demo (só quando getConfig().sodax?.enabled): getSodaxQuote devolve a cotação REAL do que o
     * comprador pagaria na outra rede para receber o USDC que falta. createSodaxCharge abre a cobrança e
     * simulateSodaxPayment credita o USDC de teste (nenhum dinheiro real). Consulte a cobrança com getPixCharge.
     */
    getSodaxQuote: (q: { agentId: string; type: "permanent" | "guarantee"; source: string }) =>
      req(SodaxQuote, `/api/sodax/quote?${new URLSearchParams(q)}`),
    createSodaxCharge: (body: { agentId: string; type: "permanent" | "guarantee"; source: string }) =>
      post(PixCharge, "/api/sodax/charges", body),
    simulateSodaxPayment: (id: string) => post(PixCharge, `/api/sodax/charges/${encodeURIComponent(id)}/simulate`),
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
    /** Compra da licença vitalícia (único tipo de compra). Erros extras: `sold_out` 409 (teto de licenças atingido, ver `SUPPLY_ERROR_CODES`), `price_changed` 409. */
    buildPurchase: (agentId: string) => post(TxResponse, "/api/tx/purchase", { agentId }),
    /**
     * Revenda de licenças (licenseId = asset da licença = id do anúncio). Erros (`ApiError.code`, ver `RESALE_ERROR_CODES` em
     * @solvers/shared): resale_disabled 503, listing_not_found 404, listing_changed 409 (body.priceUsdc), not_owner 403,
     * own_listing 400, price_too_low 400, already_listed 409, cut_too_high 400, agent_unavailable 400,
     * insufficient_funds 400, operation_rejected 409.
     */
    buildListLicense: (licenseId: string, priceUsdc: number) => post(TxResponse, "/api/tx/list", { licenseId, priceUsdc }),
    /** `expectedPriceUsdc` = preço que o comprador viu: se o anúncio mudou, 409 listing_changed com o preço atual. */
    buildBuyListing: (licenseId: string, expectedPriceUsdc: number) => post(TxResponse, "/api/tx/buy-listing", { licenseId, expectedPriceUsdc }),
    buildCancelListing: (licenseId: string) => post(TxResponse, "/api/tx/cancel-listing", { licenseId }),
    /** Anexa uma foto à MINHA avaliação deste especialista (até 3; a avaliação precisa existir). Devolve as fotos atuais. */
    uploadReviewImage: (idOrSlug: string, file: Blob) =>
      req(z.array(ImageRef), `/api/agents/${encodeURIComponent(idOrSlug)}/reviews/mine/images`, { method: "POST", headers: { "content-type": file.type }, body: file }),
    deleteReviewImage: (idOrSlug: string, imageId: string) =>
      req(z.array(ImageRef), `/api/agents/${encodeURIComponent(idOrSlug)}/reviews/mine/images/${encodeURIComponent(imageId)}`, { method: "DELETE" }),
    /** Pede ajuda ao criador deste especialista. Devolve o protocolo; o criador é avisado e o contato dele não aparece. */
    requestHelp: (idOrSlug: string, message: string, contact?: string) =>
      post(z.object({ protocol: z.string(), notified: z.boolean() }), `/api/agents/${encodeURIComponent(idOrSlug)}/help`, { message, contact: contact || undefined }),
    buildReview: (agentId: string, rating: number, text: string) => post(TxResponse, "/api/tx/review", { agentId, rating, text }),
    /**
     * Tarefa com garantia: as etapas e os critérios vêm do modelo do criador (getAgent().guarantee);
     * o comprador só dá um título e descreve o que quer. acceptanceTests é opcional, por etapa.
     * deliveryDays é o prazo de entrega em dias (opcional; 0 ou ausente = 14, máximo 60).
     */
    buildEscrow: (
      agentId: string,
      task: { title: string; description: string; acceptanceTests?: (Record<string, string> | null)[]; deliveryDays?: number },
    ) => post(TxResponse, "/api/tx/escrow", { agentId, ...task }),
    buildRelease: (escrowId: string, index: number) => post(TxResponse, `/api/tx/escrow/${escrowId}/release`, { index }),
    /** Etapa não entregue com o prazo vencido: o valor desta etapa volta para o comprador, sem taxa. */
    buildCancelUndelivered: (escrowId: string, index: number) => post(TxResponse, `/api/tx/escrow/${escrowId}/cancel-undelivered`, { index }),
    buildDispute: (escrowId: string, index: number, criterion: string, reason: string) =>
      post(TxResponse, `/api/tx/escrow/${escrowId}/dispute`, { index, criterion, reason }),
    /**
     * Envia a transação assinada. `meta` liga a assinatura a uma submissão de pacote (`/tx/register-agent`,
     * `/tx/update-version`, `/tx/update-pricing`): `{ kind, submissionId }`. Sem ele, o envio é o de sempre.
     */
    submit: (transaction: string, meta?: { kind: string; submissionId: string }) =>
      post(SubmitResponse.passthrough(), "/api/tx/submit", meta ? { transaction, meta } : { transaction }),
    /** Para quem envia pela carteira (signAndSendTransaction): confirma e indexa na hora. */
    confirm: (signature: string) => post(SubmitResponse.passthrough(), "/api/tx/confirm", { signature }),

    // ----- Admin (só funciona no servidor com ADMIN_KEYPAIR) -----
    adminDisputes: () =>
      req(z.array(z.object({ escrowId: z.string(), index: z.number(), title: z.string(), criteria: z.string(), criterion: z.string().nullable(), reason: z.string().nullable() })), "/api/admin/disputes"),
    adminResolve: (escrowId: string, index: number, refund: boolean) =>
      post(z.object({ signature: z.string() }).passthrough(), `/api/admin/escrow/${escrowId}/resolve`, { index, refund }),
    adminApprove: (agentId: string) => post(z.object({ signature: z.string() }), `/api/admin/agents/${agentId}/approve`),

    // ----- Criador: cadastro, envio de pacotes e acompanhamento (PACKAGE_SPEC.md 14.4) -----
    getCreatorMe: () => req(CreatorMe, "/api/creator/me"),
    saveCreatorProfile: (input: CreatorProfileInput) => post(CreatorMe, "/api/creator/profile", input),
    /** O servidor devolve o ARRAY de submissões (mais recentes primeiro). `slug` e `version` vêm "" até o worker abrir o ZIP. */
    listMySubmissions: () => req(z.array(SubmissionView), "/api/creator/submissions"),
    getMySubmission: (id: string) => req(SubmissionView, `/api/creator/submissions/${encodeURIComponent(id)}`),
    /**
     * Envia o ZIP do pacote (corpo cru application/zip; 202 `{ id, status }`). Usa XMLHttpRequest para ter o
     * progresso do envio (`onProgress` recebe 0..1). `resubmit` = id da submissão com mudanças pedidas (mesma versão).
     * Erros viram `ApiError` (413 grande demais, 429 limites, 400/409 validação e conflito).
     */
    uploadSubmission: (file: Blob, up: { resubmit?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}) =>
      new Promise<{ id: string; status: SubmissionStatus }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const qs = up.resubmit ? `?resubmit=${encodeURIComponent(up.resubmit)}` : "";
        xhr.open("POST", `${base}/api/creator/submissions${qs}`);
        xhr.withCredentials = true;
        xhr.setRequestHeader("content-type", "application/zip");
        if (opts.token) xhr.setRequestHeader("authorization", `Bearer ${opts.token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) up.onProgress?.(Math.min(1, e.loaded / e.total));
        };
        xhr.onerror = () => reject(new ApiError(0, "network", "A conexão caiu durante o envio.", {}));
        xhr.ontimeout = () => reject(new ApiError(0, "timeout", "O envio demorou demais.", {}));
        xhr.onabort = () => reject(new ApiError(0, "aborted", "Envio cancelado.", {}));
        xhr.onload = () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(xhr.responseText) as Record<string, unknown>;
          } catch {
            /* resposta que não é JSON (ex: 413 do nginx) */
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new ApiError(xhr.status, String(body.code ?? "error"), String(body.error ?? xhr.statusText), body));
            return;
          }
          const parsed = z.object({ id: z.string(), status: z.string() }).safeParse(body);
          if (!parsed.success) reject(new ApiError(xhr.status, "bad_response", "Resposta inesperada do servidor.", body));
          else resolve({ id: parsed.data.id, status: parsed.data.status as SubmissionStatus });
        };
        if (up.signal) {
          if (up.signal.aborted) xhr.abort();
          else up.signal.addEventListener("abort", () => xhr.abort(), { once: true });
        }
        xhr.send(file);
      }),

    /**
     * Co-assinatura do criador depois da aprovação do revisor (mesmo fluxo do checkout: monta -> carteira assina ->
     * `submit`). O servidor lê preço, hash e versão do registro aprovado, nunca daqui. O resultado já leva
     * `meta.{kind, submissionId}`, que `signAndSubmit` repassa ao `/tx/submit`.
     */
    buildRegisterAgent: (submissionId: string) => buildSubmissionTx("register_agent", "/api/tx/register-agent", submissionId),
    buildUpdateVersion: (submissionId: string) => buildSubmissionTx("update_version", "/api/tx/update-version", submissionId),
    buildUpdatePricing: (submissionId: string) => buildSubmissionTx("update_pricing", "/api/tx/update-pricing", submissionId),
    /**
     * O que falta para o Solver ir ao ar (lido da cadeia na hora): `step` diz qual botão mostrar (register-agent, update-version,
     * update-pricing, await-admin-approval, ready, blocked) e `register` traz depósito e saldo no passo de registro.
     * Use o `step` em vez de tentar a rota e ignorar o 4xx (o update-pricing só existe depois do update-version, se o preço mudou).
     */
    getPublicationPlan: (submissionId: string) => req(PublicationPlan, `/api/tx/publication/${encodeURIComponent(submissionId)}`),
    /**
     * Depois do `/tx/submit` (com meta): liga a assinatura à submissão e avança o fluxo. Erros 409: submission_state, not_approved,
     * wrong_step (`body.expected`), publication_blocked; 400 insufficient_funds.
     */
    confirmPublication: (submissionId: string, signature: string, kind?: CreatorSigningStep) =>
      post(PublicationResult, "/api/tx/publication/confirm", { submissionId, signature, ...(kind ? { kind } : {}) }),

    // ----- Revisão (só carteiras admin; CreatorMe.isAdmin diz se mostra) -----
    /** O servidor devolve o ARRAY (fila mais antiga primeiro quando `pending_review`). */
    adminListSubmissions: (status?: SubmissionStatus) =>
      req(z.array(AdminSubmissionRow), `/api/admin/submissions${status ? `?${new URLSearchParams({ status })}` : ""}`),
    adminGetSubmission: (id: string) => req(AdminSubmissionDetail, `/api/admin/submissions/${encodeURIComponent(id)}`),
    /** Conteúdo de um arquivo do pacote como TEXTO (nunca renderize como HTML). */
    adminGetSubmissionFile: (id: string, path: string) =>
      req(z.object({ path: z.string(), content: z.string() }), `/api/admin/submissions/${encodeURIComponent(id)}/file?${new URLSearchParams({ path })}`),
    /** Busca de teste na ingestão de staging do pacote. */
    adminSearchSubmissionKnowledge: (id: string, q: string) =>
      req(
        z.object({ query: z.string(), hits: z.array(z.object({ source: z.string(), content: z.string(), score: z.number() })) }),
        `/api/admin/submissions/${encodeURIComponent(id)}/knowledge-search?${new URLSearchParams({ q })}`,
      ),
    /** Aprovar congela hash, preço e versão: responde `{ id, status, approved }`. */
    adminApproveSubmission: (id: string, input: AdminReviewInput) =>
      post(z.object({ id: z.string(), status: z.string(), approved: z.object({ versionHash: z.string(), priceUsdc: z.string(), royaltyBps: z.number(), name: z.string(), version: z.string() }) }), `/api/admin/submissions/${encodeURIComponent(id)}/approve`, input),
    adminRequestChanges: (id: string, input: AdminReviewInput) => post(z.object({ id: z.string(), status: z.string() }), `/api/admin/submissions/${encodeURIComponent(id)}/request-changes`, input),
    adminRejectSubmission: (id: string, input: AdminReviewInput) => post(z.object({ id: z.string(), status: z.string() }), `/api/admin/submissions/${encodeURIComponent(id)}/reject`, input),
    /** Revoga uma aprovação que o criador ainda não assinou (volta a `changes_requested`; nota obrigatória). */
    adminRevokeSubmission: (id: string, input: AdminReviewInput) => post(z.object({ id: z.string(), status: z.string() }), `/api/admin/submissions/${encodeURIComponent(id)}/revoke`, input),
    /** Conclui a publicação quando o evento de aprovação on-chain não chegou sozinho (idempotente). */
    adminFinishSubmission: (id: string) => post(PublicationResult, `/api/admin/submissions/${encodeURIComponent(id)}/finish`),

    /** Fluxo completo: monta no servidor -> carteira assina -> servidor envia e indexa. */
    async signAndSubmit(wallet: WalletLike, built: TxResponse) {
      const signed = await wallet.signTransaction(fromB64(built.transaction));
      const kind = built.meta?.kind;
      const submissionId = built.meta?.submissionId;
      return api.submit(toB64(signed), typeof kind === "string" && typeof submissionId === "string" ? { kind, submissionId } : undefined);
    },
  };
  return api;
}

export type SolversApi = ReturnType<typeof createApi>;
export * from "@solvers/shared";

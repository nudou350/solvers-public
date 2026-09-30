import { Router } from "express";
import { and, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { address, createNoopSigner } from "@solvers/chain";
import {
  DELIST_MAX_RATING,
  DELIST_MIN_REVIEWS,
  FULL_LEVEL_PURCHASES,
  GUARANTEE_LIMITS_USDC,
  MAX_BUYER_DISPUTES_LOST,
  SINGLE_MILESTONE_MAX_USDC,
  unitsToUsdc,
  usdcToUnits,
  type GuaranteeStatus,
  type TxResponse,
} from "@solvers/shared";
import { authorities, chain, explorerUrl } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { badRequest, forbidden, h, HttpError, notFound, parse } from "../lib/http.js";
import { sha256 } from "../lib/crypto.js";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { processSignature } from "../indexer/processor.js";
import { refreshLicenseOwner } from "../indexer/sync.js";
import { criteriaHash, filesHash, readDeliverable, saveAcceptance } from "../verifier/deliverables.js";
import { cancelUndeliveredBlock, canCancelUndelivered, disputeDeadlineOf, deliveryDeadlineFrom, deliveryIntact, resolveDeliveryDays } from "./delivery-rules.js";
import { findAgentRow, guaranteeOffer } from "./catalog.js";
import { toEscrow, toReputation } from "./mappers.js";
import { notifyCreator } from "../notify/telegram.js";
import { splitCriteria } from "../runtime/guarantee-text.js";

export const escrowRouter = Router();

type MilestoneRow = typeof schema.milestones.$inferSelect;

async function loadEscrow(id: string, wallet: string) {
  const [row] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, id));
  if (!row) throw notFound("Tarefa com garantia não encontrada");
  if (row.buyerWallet !== wallet) throw forbidden("Esta garantia pertence a outra carteira");
  const ms = await db.select().from(schema.milestones).where(eq(schema.milestones.escrowId, id));
  return { row, ms };
}

// ---------- Limite de garantia ----------

/** Garantias que ainda prendem o limite da carteira. */
function openEscrowsOf(wallet: string) {
  return and(
    eq(schema.escrows.buyerWallet, wallet),
    eq(schema.escrows.closed, false),
    // "pending" = transação montada e ainda não confirmada; depois de 10 min o blockhash já expirou
    // e a garantia abandonada não pode mais prender o limite do comprador.
    or(
      inArray(schema.escrows.status, ["active", "disputed"]),
      and(eq(schema.escrows.status, "pending"), gt(schema.escrows.createdAt, sql`now() - interval '10 minutes'`)),
    ),
  );
}

export async function guaranteeStatus(wallet: string): Promise<GuaranteeStatus> {
  const [repRow] = await db.select().from(schema.userReputation).where(eq(schema.userReputation.wallet, wallet));
  const rep = toReputation(wallet, repRow);
  const limitUsdc = GUARANTEE_LIMITS_USDC[rep.guaranteeLevel];
  const [open] = await db
    .select({ sum: sql<string>`coalesce(sum(${schema.escrows.total}), 0)` })
    .from(schema.escrows)
    .where(openEscrowsOf(wallet));
  const openUsdc = unitsToUsdc(BigInt(open?.sum ?? "0"));
  return {
    level: rep.guaranteeLevel,
    limitUsdc,
    openUsdc,
    availableUsdc: Math.max(0, Math.round((limitUsdc - openUsdc) * 1e6) / 1e6),
    purchases: rep.purchases,
    purchasesToFull: rep.guaranteeLevel === "limited" ? Math.max(0, FULL_LEVEL_PURCHASES - rep.purchases) : 0,
    disputesLost: rep.disputesLost,
    maxDisputesLost: MAX_BUYER_DISPUTES_LOST,
    singleMilestoneMaxUsdc: SINGLE_MILESTONE_MAX_USDC,
  };
}

escrowRouter.get(
  "/me/guarantee",
  requireAuth,
  h(async (req) => guaranteeStatus(requireWallet(req))),
);

// ---------- Criar garantia ----------

const CreateBody = z.object({
  agentId: z.string(),
  /** O comprador só descreve a tarefa; as etapas e os critérios vêm do modelo do criador. */
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4000),
  /**
   * Bateria de aceite opcional por etapa (mesma ordem das etapas do modelo), ex: { "LoginForm.test.tsx": "..." }.
   * Fica fixa: a entrega não consegue trocá-la.
   */
  acceptanceTests: z
    .array(
      z
        .record(z.string().max(100_000))
        .refine((files) => Object.keys(files).length > 0, "bateria de aceite sem arquivos")
        .nullable(),
    )
    .max(5)
    .optional(),
  /** Prazo para o especialista entregar, em dias (ausente ou 0: 14; máximo 60). Vencido, o comprador cancela e recebe de volta. */
  deliveryDays: z.number().optional(),
});

export { splitCriteria };

escrowRouter.post(
  "/tx/escrow",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = address(requireWallet(req));
    const body = parse(CreateBody, req.body);
    const deliveryDays = resolveDeliveryDays(body.deliveryDays);
    const agent = await findAgentRow(body.agentId);
    // Garantia é uma venda nova: especialista fora da vitrine não abre tarefas.
    if (agent.status !== "active" || !agent.listed) throw badRequest("Este especialista ainda não está disponível.");
    const offer = guaranteeOffer(agent, 1);
    if (!offer) throw badRequest("Este especialista não oferece tarefas com garantia.");
    if ((body.acceptanceTests?.length ?? 0) > offer.milestones.length) throw badRequest("Há mais baterias de aceite do que etapas.");
    if (body.acceptanceTests?.some((t, idx) => t && offer.milestones[idx]!.verify === "manual")) {
      throw badRequest("Etapas de revisão manual não têm bateria de aceite.");
    }
    const plan = offer.milestones.map((m, idx) => ({
      title: m.title,
      criteria: m.criteria.join("\n"),
      amountUsdc: m.amountUsdc,
      verify: m.verify,
      acceptanceTests: body.acceptanceTests?.[idx] ?? undefined,
    }));

    const total = offer.priceUsdc;
    const g = await guaranteeStatus(wallet);
    // O limite vale para o total em garantias abertas da carteira, não por garantia.
    if (total > g.availableUsdc) {
      throw new HttpError(
        400,
        g.level === "none"
          ? "Sua conta não pode abrir tarefas com garantia no momento."
          : `Seu limite atual de garantias abertas é de ${g.limitUsdc} USDC (você já tem ${g.openUsdc} USDC em andamento). Ele aumenta conforme você faz compras na loja.`,
        "guarantee_limit",
        { guaranteeLevel: g.level, limitUsdc: g.limitUsdc, openUsdc: g.openUsdc },
      );
    }
    if (g.level === "limited" && plan.length < 2 && total > SINGLE_MILESTONE_MAX_USDC) {
      throw badRequest(`Para contas novas, garantias acima de ${SINGLE_MILESTONE_MAX_USDC} USDC precisam ter pelo menos 2 etapas.`);
    }

    const c = chain();
    const config = await c.fetchConfig();
    if (usdcToUnits(total) < config.data.minPrice) {
      throw badRequest(`O valor mínimo de uma tarefa com garantia é ${unitsToUsdc(config.data.minPrice)} USDC.`);
    }
    const balance = await c.usdcBalance(wallet);
    if (balance < usdcToUnits(total)) {
      throw new HttpError(400, "Saldo de USDC insuficiente", "insufficient_funds", { balanceUsdc: unitsToUsdc(balance), neededUsdc: total });
    }

    // 63 bits: cabe no bigint (com sinal) do Postgres e no u64 on-chain.
    const nonce = randomBytes(8).readBigUInt64LE() >> 1n;
    const escrow = await c.escrowPda(wallet, await c.agentPda(agent.id), nonce);
    // Critérios combinados antes: texto + hash da bateria de aceite; o hash de tudo vai on-chain.
    const acceptance = plan.map((m, idx) => (m.acceptanceTests ? saveAcceptance(escrow, idx, m.acceptanceTests) : null));
    const milestones = plan.map((m, idx) => ({
      amount: usdcToUnits(m.amountUsdc),
      criteriaHash: criteriaHash(m.title, m.criteria, acceptance[idx]?.hash),
    }));
    const { instructions } = await c.createEscrowIxs(wallet, agent.id, nonce, milestones, BigInt(env.ESCROW_REVIEW_WINDOW_SECS), deliveryDays);
    // Prazo e taxa ficam gravados já na criação; o indexador confirma com o valor on-chain.
    const deliveryDeadline = deliveryDeadlineFrom(new Date(), deliveryDays);

    const [creatorRow] = await db.select({ wallet: schema.creators.wallet }).from(schema.creators).where(eq(schema.creators.id, agent.creatorId));
    await db.transaction(async (tx) => {
      // Dois pedidos ao mesmo tempo não podem passar juntos no limite: trava por carteira e confere de novo.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`escrow:${wallet}`}))`);
      const [again] = await tx
        .select({ sum: sql<string>`coalesce(sum(${schema.escrows.total}), 0)` })
        .from(schema.escrows)
        .where(openEscrowsOf(wallet));
      if (unitsToUsdc(BigInt(again?.sum ?? "0")) + total > g.limitUsdc) {
        throw new HttpError(400, `Seu limite atual de garantias abertas é de ${g.limitUsdc} USDC.`, "guarantee_limit", {
          guaranteeLevel: g.level,
          limitUsdc: g.limitUsdc,
          openUsdc: unitsToUsdc(BigInt(again?.sum ?? "0")),
        });
      }
      await tx.insert(schema.escrows).values({
        id: escrow,
        agentId: agent.id,
        buyerWallet: wallet,
        creatorWallet: creatorRow?.wallet ?? agent.creatorId,
        title: body.title,
        description: body.description,
        nonce,
        total: usdcToUnits(total),
        status: "pending",
        reviewWindowSecs: env.ESCROW_REVIEW_WINDOW_SECS,
        deliveryDeadline,
        feeBps: config.data.feeBps,
      });
      await tx.insert(schema.milestones).values(
        plan.map((m, idx) => ({
          escrowId: escrow,
          idx,
          title: m.title,
          criteria: m.criteria,
          criteriaHash: criteriaHash(m.title, m.criteria, acceptance[idx]?.hash).toString("hex"),
          verify: m.verify,
          amount: usdcToUnits(m.amountUsdc),
          status: "pending",
          acceptancePath: acceptance[idx]?.path ?? null,
          acceptanceHash: acceptance[idx]?.hash ?? null,
        })),
      );
    });
    return c.buildForUser(instructions, { kind: "escrow", escrowId: escrow, totalUsdc: total });
  }),
);

// ---------- Aprovar / contestar ----------

escrowRouter.post(
  "/tx/escrow/:id/release",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = requireWallet(req);
    const { index } = parse(z.object({ index: z.number().int().min(0).max(4) }), req.body);
    const { row, ms } = await loadEscrow(String(req.params.id), wallet);
    const m = ms.find((x) => x.idx === index);
    if (!m || !["pending", "submitted", "passed"].includes(m.status)) throw badRequest("Esta etapa não pode ser aprovada agora.");
    const c = chain();
    const ixs = await c.releaseMilestoneIxs(createNoopSigner(address(wallet)), address(row.id), index);
    return c.buildForUser(ixs, { kind: "release", escrowId: row.id, index });
  }),
);

/** Cancelar etapa não entregue depois do prazo: o comprador recebe o valor da etapa de volta, sem taxa. */
async function buildCancelUndelivered(idParam: string, wallet: string, index: number): Promise<TxResponse> {
  const { row, ms } = await loadEscrow(idParam, wallet);
  const m = ms.find((x) => x.idx === index);
  if (!m) throw notFound("Etapa não encontrada");
  const blocked = cancelUndeliveredBlock({ closed: row.closed, deliveryDeadline: row.deliveryDeadline }, m, new Date());
  if (blocked) throw badRequest(blocked, "cancel_not_allowed");
  const c = chain();
  const ixs = await c.cancelUndeliveredIxs(address(wallet), address(row.id), index);
  return c.buildForUser(ixs, { kind: "cancel", escrowId: row.id, index });
}

escrowRouter.post(
  "/tx/escrow/:id/cancel-undelivered",
  requireAuth,
  h(async (req) => {
    const { index } = parse(z.object({ index: z.number().int().min(0).max(4) }), req.body);
    return buildCancelUndelivered(String(req.params.id), requireWallet(req), index);
  }),
);

// Mesma ação no formato da spec do programa v2 (índice na URL).
escrowRouter.post(
  "/tx/escrows/:id/milestones/:index/cancel-undelivered",
  requireAuth,
  h(async (req) => {
    const { index } = parse(z.object({ index: z.coerce.number().int().min(0).max(4) }), req.params);
    return buildCancelUndelivered(String(req.params.id), requireWallet(req), index);
  }),
);

escrowRouter.post(
  "/tx/escrow/:id/dispute",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = requireWallet(req);
    const body = parse(
      z.object({
        index: z.number().int().min(0).max(4),
        /** Qual critério combinado falhou (obrigatório). */
        criterion: z.string().min(2).max(1000),
        reason: z.string().min(5).max(2000),
      }),
      req.body,
    );
    const { row, ms } = await loadEscrow(String(req.params.id), wallet);
    const m = ms.find((x) => x.idx === body.index);
    if (!m || !["pending", "submitted", "passed"].includes(m.status)) throw badRequest("Esta etapa não pode ser contestada agora.");
    if (m.status === "passed" && m.passedAt && Date.now() > m.passedAt.getTime() + row.reviewWindowSecs * 1000) {
      throw badRequest("O prazo para contestar esta etapa já passou.");
    }
    const criteria = splitCriteria(m.criteria);
    if (!criteria.includes(body.criterion.trim())) {
      throw badRequest("Indique qual dos critérios combinados falhou.", "invalid_criterion", { criteria });
    }
    await db
      .update(schema.milestones)
      // disputedAt só é gravado pelo indexador quando a contestação é confirmada on-chain.
      .set({ disputeCriterion: body.criterion, disputeReason: body.reason })
      .where(and(eq(schema.milestones.escrowId, row.id), eq(schema.milestones.idx, body.index)));
    const ix = await chain().openDisputeIx(address(wallet), address(row.id), body.index, sha256(`${body.criterion}\n${body.reason}`));
    return chain().buildForUser([ix], { kind: "dispute", escrowId: row.id, index: body.index });
  }),
);

// ---------- Consultas ----------

function milestoneExtras(m: MilestoneRow, row: typeof schema.escrows.$inferSelect) {
  const reviewWindowSecs = row.reviewWindowSecs;
  const report = (m.verifierReport ?? null) as { numPassed?: number; numTests?: number; mode?: string } | null;
  return {
    index: m.idx,
    amountUsdc: unitsToUsdc(m.amount),
    passedAt: m.passedAt?.toISOString() ?? null,
    autoReleaseAt: m.passedAt && m.status === "passed" ? new Date(m.passedAt.getTime() + reviewWindowSecs * 1000).toISOString() : null,
    previewUrl: m.status === "passed" || m.status === "approved" ? m.previewUrl : null,
    tests: report ? { passed: report.numPassed ?? 0, total: report.numTests ?? 0, mode: report.mode ?? "docker" } : null,
    criteria: splitCriteria(m.criteria),
    verify: (m.verify === "manual" ? "manual" : "tests") as "manual" | "tests",
    hasAcceptanceTests: !!m.acceptanceHash,
    disputeCriterion: m.disputeCriterion,
    downloadable: m.status === "approved" && !!m.deliverablePath,
    disputedAt: m.disputedAt?.toISOString() ?? null,
    disputeDeadline: disputeDeadlineOf(m, row.deliveryDeadline)?.toISOString() ?? null,
    canCancelUndelivered: canCancelUndelivered({ closed: row.closed, deliveryDeadline: row.deliveryDeadline }, m, new Date()),
  };
}

escrowRouter.get(
  "/me/escrows",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const rows = await db
      .select()
      .from(schema.escrows)
      .where(and(eq(schema.escrows.buyerWallet, wallet), ne(schema.escrows.status, "pending")))
      .orderBy(desc(schema.escrows.createdAt));
    if (rows.length === 0) return [];
    const ms = await db.select().from(schema.milestones).where(inArray(schema.milestones.escrowId, rows.map((r) => r.id)));
    return rows.map((r) => toEscrow(r, ms.filter((m) => m.escrowId === r.id)));
  }),
);

escrowRouter.get(
  "/me/escrows/:id",
  requireAuth,
  h(async (req) => {
    const { row, ms } = await loadEscrow(String(req.params.id), requireWallet(req));
    const agent = await findAgentRow(row.agentId);
    return {
      escrow: toEscrow(row, ms),
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      agent: { id: agent.id, slug: agent.slug, name: agent.name },
      milestones: ms.sort((a, b) => a.idx - b.idx).map((m) => milestoneExtras(m, row)),
      explorerUrl: explorerUrl("address", row.id),
    };
  }),
);

escrowRouter.get(
  "/me/escrows/:id/milestones/:idx/download",
  requireAuth,
  h(async (req) => {
    const { ms } = await loadEscrow(String(req.params.id), requireWallet(req));
    const m = ms.find((x) => x.idx === Number(req.params.idx));
    if (!m?.deliverablePath) throw notFound("Entrega não encontrada");
    if (m.status !== "approved") throw forbidden("O arquivo final fica disponível depois da aprovação.");
    // O arquivo em disco precisa ser o que foi verificado e aprovado (o hash foi gravado no envio).
    const files = readDeliverable(m.deliverablePath);
    if (!deliveryIntact(Object.keys(files).length, filesHash(files).toString("hex"), m.deliverableHash)) {
      console.error(`[download] entrega diferente do hash aprovado (${m.escrowId}/${m.idx})`);
      throw new HttpError(409, "Os arquivos desta entrega não conferem com o que foi aprovado, então o download foi bloqueado. Fale com o suporte.", "deliverable_changed");
    }
    return { files };
  }),
);

// ---------- Avaliações ----------

escrowRouter.post(
  "/tx/review",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = address(requireWallet(req));
    const body = parse(z.object({ agentId: z.string(), rating: z.number().int().min(1).max(5), text: z.string().max(2000).default("") }), req.body);
    const agent = await findAgentRow(body.agentId);
    if (!agent.onchainAddress) throw badRequest("Este especialista ainda não está disponível para avaliação.");
    const lic = await db
      .select()
      .from(schema.licenses)
      .where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, agent.id)));
    let licenseAsset: string | undefined;
    for (const l of lic) {
      if ((await refreshLicenseOwner(l.id)) === wallet) {
        licenseAsset = l.id;
        break;
      }
    }
    const [cred] = await db
      .select()
      .from(schema.credits)
      .where(and(eq(schema.credits.ownerWallet, wallet), eq(schema.credits.agentId, agent.id)));
    if (!licenseAsset && !(cred && cred.purchased > 0)) {
      // Quem comprou créditos no modelo antigo (pagamento por uso) ainda pode avaliar.
      throw forbidden("Só quem tem a licença deste especialista pode avaliar.");
    }
    const contentHash = sha256(body.text);
    const c = chain();
    const ixs = await c.submitReviewIxs(wallet, agent.id, body.rating, contentHash, licenseAsset ? { licenseAsset: address(licenseAsset) } : { hasCredits: true });
    // Texto fica off-chain, só como rascunho por hash: nada público muda antes da assinatura. O indexador
    // (syncReview) promove o rascunho quando o mesmo hash aparece confirmado on-chain.
    const hashHex = contentHash.toString("hex");
    await db
      .insert(schema.reviewDrafts)
      .values({ agentId: agent.id, authorWallet: wallet, contentHash: hashHex, rating: body.rating, text: body.text })
      .onConflictDoUpdate({
        target: [schema.reviewDrafts.agentId, schema.reviewDrafts.authorWallet, schema.reviewDrafts.contentHash],
        set: { rating: body.rating, text: body.text, createdAt: new Date() },
      });
    // Rascunhos velhos nunca assinados não ficam guardados.
    await db
      .delete(schema.reviewDrafts)
      .where(and(eq(schema.reviewDrafts.authorWallet, wallet), lt(schema.reviewDrafts.createdAt, sql`now() - interval '1 day'`)));
    return c.buildForUser(ixs, { kind: "review", agentId: agent.id });
  }),
);

// ---------- Admin (moderação e disputas) ----------

async function requireAdmin(wallet: string) {
  const config = await chain().fetchConfig();
  if (config.data.admin !== wallet) throw forbidden("Somente o admin");
  const admin = authorities().admin;
  if (!admin || admin.address !== wallet) throw forbidden("Chave de admin não configurada neste servidor");
  return admin;
}

escrowRouter.get(
  "/admin/disputes",
  requireAuth,
  h(async (req) => {
    await requireAdmin(requireWallet(req));
    const ms = await db.select().from(schema.milestones).where(eq(schema.milestones.status, "disputed"));
    return ms.map((m) => ({ escrowId: m.escrowId, index: m.idx, title: m.title, criteria: m.criteria, criterion: m.disputeCriterion, reason: m.disputeReason }));
  }),
);

escrowRouter.post(
  "/admin/escrow/:id/resolve",
  requireAuth,
  h(async (req) => {
    const admin = await requireAdmin(requireWallet(req));
    const { index, refund } = parse(z.object({ index: z.number().int().min(0).max(4), refund: z.boolean() }), req.body);
    const c = chain();
    const { signature } = await c.sendAsServer(await c.resolveDisputeIxs(admin, address(String(req.params.id)), index, refund));
    await processSignature(signature);
    const [row] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, String(req.params.id)));
    if (row) void notifyCreator(row.agentId, `Solvers: disputa da etapa ${index + 1} resolvida (${refund ? "reembolso ao comprador" : "pagamento ao criador"}).`);
    return { signature, explorerUrl: explorerUrl("tx", signature) };
  }),
);

escrowRouter.post(
  "/admin/agents/:id/approve",
  requireAuth,
  h(async (req) => {
    const admin = await requireAdmin(requireWallet(req));
    const agent = await findAgentRow(String(req.params.id));
    const c = chain();
    const { signature } = await c.sendAsServer([await c.approveAgentIx(admin, agent.id)]);
    await processSignature(signature);
    await db
      .update(schema.agents)
      // Volta à vitrine, a não ser que a nota continue abaixo do mínimo (o job tiraria de novo).
      .set({ listed: sql`not (${schema.agents.ratingCount} >= ${DELIST_MIN_REVIEWS} and ${schema.agents.ratingSum}::float / nullif(${schema.agents.ratingCount}, 0) < ${DELIST_MAX_RATING})` })
      .where(eq(schema.agents.id, agent.id));
    return { signature };
  }),
);

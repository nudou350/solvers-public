import { and, eq, sql } from "drizzle-orm";
import { address, listingIsLive, type Address } from "@solvers/chain";
import * as gen from "@solvers/client";
import { bytesToHex, normalizeMaxLicenses } from "@solvers/shared";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { bytesToHexStr } from "../lib/crypto.js";
import { resolvePublishedText } from "../store/review-rules.js";
import { canApplyMilestoneStatus, closedEscrowStatus, type MilestoneStatusName } from "./escrow-status.js";
import { agentMirrorValues } from "./mirror.js";
import { applyListed, closeListingsAt, removeLicenseRow, setLicenseOwner, upsertLicenseRow } from "./resale-mirror.js";

// Sincronização "busca a conta on-chain e espelha no banco". Idempotente: pode rodar quantas
// vezes quiser para o mesmo endereço (webhook, polling e a própria API chamam).

const ESCROW_STATUS = { 0: "active", 1: "approved", 2: "disputed", 3: "refunded" } as const;
const MILESTONE_STATUS = { 0: "pending", 1: "passed", 2: "approved", 3: "disputed", 4: "refunded" } as const;

export async function syncAgent(agentAddr: Address): Promise<string | null> {
  const acc = await gen.fetchMaybeAgent(chain().rpc, agentAddr);
  if (!acc.exists) return null;
  const a = acc.data;
  const id = bytesToHex(a.agentId);
  // Não inclui platformStatus (kill switch da plataforma): ver indexer/mirror.ts.
  const values: ReturnType<typeof agentMirrorValues> & { maxLicenses?: number | null } = agentMirrorValues(a, agentAddr);
  // Teto de licenças (PDA SupplyCap, só existe se o criador definiu um). Se o RPC falhar a coluna fica como está: o
  // espelho é só para a vitrine e para o pré-check; quem barra a venda é o programa.
  try {
    values.maxLicenses = normalizeMaxLicenses(await chain().fetchSupplyCap(id));
  } catch (e) {
    console.warn(`[sync] teto de licenças de ${id} não lido: ${(e as Error).message}`);
  }
  const updated = await db.update(schema.agents).set(values).where(eq(schema.agents.id, id)).returning({ id: schema.agents.id });
  if (updated.length === 0) {
    // Registrado fora do script de publicação: cria uma entrada mínima para não perder o espelho.
    await db
      .insert(schema.agents)
      .values({
        id,
        slug: id,
        name: "Solver sem catálogo",
        tagline: "",
        description: "",
        category: "Outros",
        creatorId: a.creator,
        listed: false,
        ...values,
      })
      .onConflictDoNothing();
  }
  return id;
}

export async function syncReputation(wallet: Address): Promise<void> {
  const [pda] = await gen.findReputationPda({ buyer: wallet });
  const acc = await gen.fetchMaybeUserReputation(chain().rpc, pda);
  if (!acc.exists) return;
  const values = {
    purchases: acc.data.purchases,
    disputesOpened: acc.data.disputesOpened,
    disputesLost: acc.data.disputesLost,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.userReputation)
    .values({ wallet, ...values })
    .onConflictDoUpdate({ target: schema.userReputation.wallet, set: values });
}

export async function syncCredits(agentAddr: Address, owner: Address, agentId: string): Promise<void> {
  const [pda] = await gen.findCreditsPda({ agent: agentAddr, buyer: owner });
  const acc = await gen.fetchMaybeCredits(chain().rpc, pda);
  if (!acc.exists) return;
  const values = { remaining: acc.data.remaining, purchased: acc.data.purchased, updatedAt: new Date() };
  await db
    .insert(schema.credits)
    .values({ agentId, ownerWallet: owner, ...values })
    .onConflictDoUpdate({ target: [schema.credits.agentId, schema.credits.ownerWallet], set: values });
}

export async function agentIdByAddress(agentAddr: Address): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.onchainAddress, agentAddr))
    .limit(1);
  return row?.id ?? (await syncAgent(agentAddr));
}

/**
 * Espelha a licença no dono atual (on-chain) e devolve esse dono. Quando o dono muda (venda pelo mercado ou
 * transferência), o novo dono recebe `acquired_at`/`signature` da aquisição e os sinais de anúncio são zerados
 * (ver `upsertLicenseRow`).
 */
export async function syncLicense(
  asset: Address,
  agentId: string,
  signature?: string,
  blockTime?: number | null,
  /** Troca o dono lido da cadeia (ex.: o comprador de uma revenda recente, quando a leitura ainda mostra o vendedor). */
  pickOwner?: (coreOwner: string) => string,
): Promise<string> {
  let core = await chain().fetchCoreAsset(asset);
  for (let i = 0; !core && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    core = await chain().fetchCoreAsset(asset);
  }
  if (!core) throw new Error(`licença ${asset} ainda não visível no RPC`);
  const owner = pickOwner ? pickOwner(core.owner) : core.owner;
  await upsertLicenseRow({
    asset,
    agentId,
    owner,
    acquiredAt: blockTime ? new Date(blockTime * 1000) : new Date(),
    signature: signature ?? null,
  });
  return owner;
}

/**
 * Revalida a posse de uma licença on-chain (transferências fora da plataforma). Dono diferente do vendedor de um anúncio
 * ativo: o anúncio é fechado como 'invalid'. Asset que não existe mais: a licença some do espelho.
 */
export async function refreshLicenseOwner(asset: string): Promise<string | null> {
  const core = await chain().fetchCoreAsset(address(asset));
  if (!core) {
    await removeLicenseRow(asset);
    return null;
  }
  await setLicenseOwner(asset, core.owner);
  return core.owner;
}

/**
 * Espelha o anúncio de revenda de um endereço `Listing` (reconciliação: logs truncados, `cli:reindex --listings`).
 * Conta ausente: anúncios ativos naquele endereço viram 'invalid'. Conta presente: garante o anúncio ativo, desde que o
 * vendedor ainda seja o dono da licença.
 */
export async function syncListing(listingAddr: Address): Promise<void> {
  const acc = await gen.fetchMaybeListing(chain().rpc, listingAddr, { commitment: "confirmed" });
  if (!acc.exists) {
    await closeListingsAt(listingAddr);
    return;
  }
  const l = acc.data;
  const agentId = await agentIdByAddress(l.agent);
  if (!agentId) return;
  const owner = await syncLicense(l.asset, agentId);
  if (owner !== l.seller) return; // syncLicense já fechou o anúncio velho como 'invalid'
  // A conta Listing existe, mas só vale (comprável) com o asset do vendedor, na coleção do solver e com o delegate na PDA do
  // mercado. Sem isso (delegate revogado por fora, asset de outra coleção) o anúncio é 'invalid', nunca 'active'.
  const c = chain();
  const agent = await gen.fetchMaybeAgent(c.rpc, l.agent, { commitment: "confirmed" });
  const core = await c.fetchCoreLicense(l.asset);
  if (!agent.exists || !listingIsLive(l, core, agent.data.collection, await c.marketAuthorityPda())) {
    await closeListingsAt(listingAddr);
    return;
  }
  await applyListed({
    licenseId: l.asset,
    agentId,
    listingAddress: listingAddr,
    seller: l.seller,
    price: l.price,
    feeBps: l.feeBps,
    royaltyBps: l.royaltyBps,
    listedAt: l.listedAt > 0n ? new Date(Number(l.listedAt) * 1000) : new Date(),
    signature: null,
  });
}

export async function syncReview(agentAddr: Address, author: Address, agentId: string) {
  const [pda] = await gen.findReviewPda({ agent: agentAddr, author });
  const acc = await gen.fetchMaybeReview(chain().rpc, pda);
  if (!acc.exists) return;
  const contentHash = bytesToHexStr(acc.data.contentHash);
  const createdAt = acc.data.createdAt > 0n ? new Date(Number(acc.data.createdAt) * 1000) : new Date();
  // O texto é off-chain: só publica o que o hash confirmado prova (rascunho do mesmo hash, ou o texto já publicado).
  const [draft] = await db
    .select()
    .from(schema.reviewDrafts)
    .where(and(eq(schema.reviewDrafts.agentId, agentId), eq(schema.reviewDrafts.authorWallet, author), eq(schema.reviewDrafts.contentHash, contentHash)));
  const [current] = await db
    .select({ text: schema.reviews.text })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.agentId, agentId), eq(schema.reviews.authorWallet, author)));
  const text = resolvePublishedText(contentHash, [draft?.text, current?.text]);
  await db
    .insert(schema.reviews)
    .values({ id: pda, agentId, authorWallet: author, rating: acc.data.rating, text, contentHash, onchain: true, createdAt })
    .onConflictDoUpdate({
      target: [schema.reviews.agentId, schema.reviews.authorWallet],
      set: { id: pda, rating: acc.data.rating, text, onchain: true, contentHash },
    });
  if (draft) {
    await db
      .delete(schema.reviewDrafts)
      .where(and(eq(schema.reviewDrafts.agentId, agentId), eq(schema.reviewDrafts.authorWallet, author), eq(schema.reviewDrafts.contentHash, contentHash)));
  }
}

/**
 * Fechado o escrow (close_escrow) antes de o indexador ver o evento, a conta não existe mais e o estado
 * da etapa só sobrou no próprio evento: aplica esse status à etapa e recalcula o status do escrow em vez de
 * só marcar `closed`, senão a etapa paga ficaria "pendente" no espelho (e a entrega paga travada).
 */
export async function applyMilestoneToClosedEscrow(escrowAddr: string, hint: { index: number; status: MilestoneStatusName }): Promise<void> {
  const [m] = await db
    .select()
    .from(schema.milestones)
    .where(and(eq(schema.milestones.escrowId, escrowAddr), eq(schema.milestones.idx, hint.index)));
  if (m && m.status !== hint.status && canApplyMilestoneStatus(m.status, hint.status)) {
    await db
      .update(schema.milestones)
      .set({ status: hint.status, ...(hint.status === "disputed" && !m.disputedAt ? { disputedAt: new Date() } : {}) })
      .where(and(eq(schema.milestones.escrowId, escrowAddr), eq(schema.milestones.idx, hint.index)));
  }
  const rows = await db.select({ status: schema.milestones.status }).from(schema.milestones).where(eq(schema.milestones.escrowId, escrowAddr));
  await db
    .update(schema.escrows)
    .set({ status: rows.length > 0 ? closedEscrowStatus(rows.map((r) => r.status)) : undefined, closed: true })
    .where(eq(schema.escrows.id, escrowAddr));
}

/** Espelha o escrow. Devolve false se a conta on-chain já não existe (escrow fechado). */
export async function syncEscrow(
  escrowAddr: Address,
  hint?: { index: number; status: MilestoneStatusName },
  /** `leaveIfMissing`: conta ausente não marca o escrow como fechado (o chamador vai tentar de novo: RPC atrasado). */
  opts?: { leaveIfMissing?: boolean },
): Promise<boolean> {
  const layout = await chain().fetchEscrowLayout(escrowAddr);
  if (layout.kind === "legacy") {
    // Conta do programa v1 (o cliente v2 a decodifica sem erro, mas os campos novos são lixo): não espelha nada.
    // O espelho fica como está; cli:retire-escrows encerra essas tarefas.
    console.warn(`[indexer] escrow ${escrowAddr} em layout antigo (${layout.size} bytes); ignorado (use cli:retire-escrows)`);
    return true;
  }
  if (layout.kind === "missing") {
    if (opts?.leaveIfMissing) return false;
    if (hint) await applyMilestoneToClosedEscrow(escrowAddr, hint);
    else await db.update(schema.escrows).set({ closed: true }).where(eq(schema.escrows.id, escrowAddr));
    return false;
  }
  const e = layout.data;
  const agentId = await agentIdByAddress(e.agent);
  if (!agentId) return true;
  const status = ESCROW_STATUS[e.status as keyof typeof ESCROW_STATUS] ?? "active";
  const autoReleaseAt = e.autoReleaseAt > 0n ? new Date(Number(e.autoReleaseAt) * 1000) : null;
  // Programa v2: prazo de entrega e a taxa congelada na criação (tarefas antigas ficam com nulo).
  const deliveryDeadline = e.deliveryDeadline > 0n ? new Date(Number(e.deliveryDeadline) * 1000) : null;
  await db
    .insert(schema.escrows)
    .values({
      id: escrowAddr,
      agentId,
      buyerWallet: e.buyer,
      creatorWallet: e.creator,
      nonce: e.nonce,
      total: e.total,
      status,
      autoReleaseAt,
      reviewWindowSecs: Number(e.reviewWindowSecs),
      deliveryDeadline,
      feeBps: e.feeBps,
    })
    .onConflictDoUpdate({
      target: schema.escrows.id,
      set: { status, autoReleaseAt, total: e.total, creatorWallet: e.creator, deliveryDeadline, feeBps: e.feeBps },
    });

  for (const [idx, m] of e.milestones.entries()) {
    const chainStatus = MILESTONE_STATUS[m.status as keyof typeof MILESTONE_STATUS] ?? "pending";
    const passedAt = m.passedAt > 0n ? new Date(Number(m.passedAt) * 1000) : null;
    // Horário da contestação vindo da conta (prazo de julgamento de 7 dias conta daqui).
    const chainDisputedAt = m.disputedAt > 0n ? new Date(Number(m.disputedAt) * 1000) : null;
    const [existing] = await db
      .select()
      .from(schema.milestones)
      .where(and(eq(schema.milestones.escrowId, escrowAddr), eq(schema.milestones.idx, idx)));
    // "submitted" é um estado off-chain (entrega recebida, verificação em andamento).
    const statusOut = chainStatus === "pending" && existing?.status === "submitted" ? "submitted" : chainStatus;
    if (existing) {
      await db
        .update(schema.milestones)
        // A contestação só conta (painel do criador) quando confirmada on-chain.
        .set({
          status: statusOut,
          passedAt,
          amount: m.amount,
          ...(chainDisputedAt ? { disputedAt: chainDisputedAt } : statusOut === "disputed" && !existing.disputedAt ? { disputedAt: new Date() } : {}),
        })
        .where(and(eq(schema.milestones.escrowId, escrowAddr), eq(schema.milestones.idx, idx)));
    } else {
      await db.insert(schema.milestones).values({
        escrowId: escrowAddr,
        idx,
        title: `Etapa ${idx + 1}`,
        criteria: "",
        criteriaHash: bytesToHexStr(m.criteriaHash),
        amount: m.amount,
        status: statusOut,
        passedAt,
        disputedAt: chainDisputedAt ?? (statusOut === "disputed" ? new Date() : null),
      });
    }
  }
  return true;
}

/** Valores executados e horário do bloco de uma transação (todos opcionais: dependem do que a transação mostra). */
export type ChainTxExtra = {
  blockTime?: Date | null;
  fee?: bigint | null;
  creatorAmount?: bigint | null;
  creatorWallet?: string | null;
  feeBps?: number | null;
};

/**
 * Registra a transação. Reprocessar a mesma assinatura preenche o que faltava (horário do bloco, valores
 * executados) sem apagar o que já existe; é assim que o backfill do histórico antigo funciona.
 */
export async function recordChainTx(
  signature: string,
  kind: string,
  wallet: string | null,
  agentId: string | null,
  amount?: bigint,
  extra: ChainTxExtra = {},
) {
  const values = {
    amount: amount ?? null,
    blockTime: extra.blockTime ?? null,
    fee: extra.fee ?? null,
    creatorAmount: extra.creatorAmount ?? null,
    creatorWallet: extra.creatorWallet ?? null,
    feeBps: extra.feeBps ?? null,
  };
  const t = schema.chainTxs;
  await db
    .insert(t)
    .values({ signature, kind, wallet, agentId, ...values })
    .onConflictDoUpdate({
      target: t.signature,
      set: {
        // O valor novo vence quando existe (vem dos saldos reais); o horário do bloco só entra uma vez.
        amount: sql`coalesce(excluded.amount, ${t.amount})`,
        fee: sql`coalesce(excluded.fee, ${t.fee})`,
        creatorAmount: sql`coalesce(excluded.creator_amount, ${t.creatorAmount})`,
        creatorWallet: sql`coalesce(excluded.creator_wallet, ${t.creatorWallet})`,
        feeBps: sql`coalesce(excluded.fee_bps, ${t.feeBps})`,
        blockTime: sql`coalesce(${t.blockTime}, excluded.block_time)`,
      },
    });
}

export async function bumpAgentUpdated(agentId: string) {
  await db.update(schema.agents).set({ updatedAt: sql`now()` }).where(eq(schema.agents.id, agentId));
}

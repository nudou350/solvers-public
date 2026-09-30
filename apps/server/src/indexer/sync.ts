import { and, eq, sql } from "drizzle-orm";
import { address, type Address } from "@solvers/chain";
import * as gen from "@solvers/client";
import { bytesToHex } from "@solvers/shared";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { bytesToHexStr } from "../lib/crypto.js";

// Sincronização "busca a conta on-chain e espelha no banco". Idempotente: pode rodar quantas
// vezes quiser para o mesmo endereço (webhook, polling e a própria API chamam).

const AGENT_STATUS = ["pending", "active", "suspended"] as const;
const ESCROW_STATUS = { 0: "active", 1: "approved", 2: "disputed", 3: "refunded" } as const;
const MILESTONE_STATUS = { 0: "pending", 1: "passed", 2: "approved", 3: "disputed", 4: "refunded" } as const;

export async function syncAgent(agentAddr: Address): Promise<string | null> {
  const acc = await gen.fetchMaybeAgent(chain().rpc, agentAddr);
  if (!acc.exists) return null;
  const a = acc.data;
  const id = bytesToHex(a.agentId);
  const values = {
    version: a.version,
    versionHash: bytesToHexStr(a.versionHash),
    price: a.price,
    pricePerUse: a.pricePerUse,
    royaltyBps: a.royaltyBps,
    evalScoreBps: a.evalScoreBps,
    evalHash: bytesToHexStr(a.evalHash),
    status: AGENT_STATUS[a.status] ?? "pending",
    totalSales: a.totalSales,
    verifiedUses: a.verifiedUses,
    ratingSum: a.ratingSum,
    ratingCount: a.ratingCount,
    disputesLost: a.disputesLost,
    stake: a.stake,
    onchainAddress: agentAddr,
    collectionAddress: a.collection,
    updatedAt: new Date(),
  };
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

export async function syncLicense(asset: Address, agentId: string, signature?: string, blockTime?: number | null) {
  let core = await chain().fetchCoreAsset(asset);
  for (let i = 0; !core && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    core = await chain().fetchCoreAsset(asset);
  }
  if (!core) throw new Error(`licença ${asset} ainda não visível no RPC`);
  await db
    .insert(schema.licenses)
    .values({
      id: asset,
      agentId,
      ownerWallet: core.owner,
      acquiredAt: blockTime ? new Date(blockTime * 1000) : new Date(),
      type: "permanent",
      signature: signature ?? null,
    })
    .onConflictDoUpdate({ target: schema.licenses.id, set: { ownerWallet: core.owner } });
}

/** Revalida a posse de uma licença on-chain (transferências fora da plataforma). */
export async function refreshLicenseOwner(asset: string): Promise<string | null> {
  const core = await chain().fetchCoreAsset(address(asset));
  if (!core) {
    await db.delete(schema.licenses).where(eq(schema.licenses.id, asset));
    return null;
  }
  await db.update(schema.licenses).set({ ownerWallet: core.owner }).where(eq(schema.licenses.id, asset));
  return core.owner;
}

export async function syncReview(agentAddr: Address, author: Address, agentId: string) {
  const [pda] = await gen.findReviewPda({ agent: agentAddr, author });
  const acc = await gen.fetchMaybeReview(chain().rpc, pda);
  if (!acc.exists) return;
  const contentHash = bytesToHexStr(acc.data.contentHash);
  const createdAt = acc.data.createdAt > 0n ? new Date(Number(acc.data.createdAt) * 1000) : new Date();
  await db
    .insert(schema.reviews)
    .values({ id: pda, agentId, authorWallet: author, rating: acc.data.rating, contentHash, onchain: true, createdAt })
    .onConflictDoUpdate({
      target: [schema.reviews.agentId, schema.reviews.authorWallet],
      set: { id: pda, rating: acc.data.rating, onchain: true, contentHash },
    });
}

export async function syncEscrow(escrowAddr: Address): Promise<void> {
  const acc = await gen.fetchMaybeEscrow(chain().rpc, escrowAddr);
  if (!acc.exists) {
    await db.update(schema.escrows).set({ closed: true }).where(eq(schema.escrows.id, escrowAddr));
    return;
  }
  const e = acc.data;
  const agentId = await agentIdByAddress(e.agent);
  if (!agentId) return;
  const status = ESCROW_STATUS[e.status as keyof typeof ESCROW_STATUS] ?? "active";
  const autoReleaseAt = e.autoReleaseAt > 0n ? new Date(Number(e.autoReleaseAt) * 1000) : null;
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
    })
    .onConflictDoUpdate({ target: schema.escrows.id, set: { status, autoReleaseAt, total: e.total, creatorWallet: e.creator } });

  for (const [idx, m] of e.milestones.entries()) {
    const chainStatus = MILESTONE_STATUS[m.status as keyof typeof MILESTONE_STATUS] ?? "pending";
    const passedAt = m.passedAt > 0n ? new Date(Number(m.passedAt) * 1000) : null;
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
        .set({ status: statusOut, passedAt, amount: m.amount, ...(statusOut === "disputed" && !existing.disputedAt ? { disputedAt: new Date() } : {}) })
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
        disputedAt: statusOut === "disputed" ? new Date() : null,
      });
    }
  }
}

export async function recordChainTx(signature: string, kind: string, wallet: string | null, agentId: string | null, amount?: bigint) {
  await db
    .insert(schema.chainTxs)
    .values({ signature, kind, wallet, agentId, amount: amount ?? null })
    .onConflictDoNothing();
}

export async function bumpAgentUpdated(agentId: string) {
  await db.update(schema.agents).set({ updatedAt: sql`now()` }).where(eq(schema.agents.id, agentId));
}

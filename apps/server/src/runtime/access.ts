import { and, eq, gt, sql } from "drizzle-orm";
import { address } from "@solvers/chain";
import { FREE_TRIAL_USES } from "@solvers/shared";
import { authorities, chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { refreshLicenseOwner, syncCredits, syncLicense } from "../indexer/sync.js";

export type Access =
  | { ok: true; kind: "license"; licenseId: string }
  | { ok: true; kind: "credits"; remaining: number; signature: string }
  | { ok: true; kind: "trial"; remaining: number }
  | { ok: false; reason: "no_access" | "trial_exhausted" };

type AgentRow = typeof schema.agents.$inferSelect;

/** Licença permanente válida? Confere o dono atual on-chain (a licença pode ter sido revendida). */
async function licenseOf(wallet: string, agent: AgentRow): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.licenses)
    .where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, agent.id)));
  for (const r of rows) {
    const owner = await refreshLicenseOwner(r.id).catch(() => wallet);
    if (owner === wallet) return r.id;
  }
  // Fallback on-chain: comprou e o indexador ainda não gravou (INSTRUCTIONS.md 5.11).
  if (agent.collectionAddress) {
    const found = await chain()
      .findLicenses(address(wallet), address(agent.collectionAddress))
      .catch(() => []);
    for (const asset of found) {
      await syncLicense(asset, agent.id);
      return asset;
    }
  }
  return null;
}

/**
 * Decide como a carteira acessa o solver nesta ativação, nesta ordem:
 * licença permanente > créditos (consome 1 on-chain) > teste grátis (3 usos, off-chain).
 */
export async function resolveAccess(wallet: string, agent: AgentRow, opts: { consume: boolean }): Promise<Access> {
  const licenseId = await licenseOf(wallet, agent);
  if (licenseId) return { ok: true, kind: "license", licenseId };

  const [cred] = await db
    .select()
    .from(schema.credits)
    .where(and(eq(schema.credits.ownerWallet, wallet), eq(schema.credits.agentId, agent.id), gt(schema.credits.remaining, 0)));
  if (cred && agent.onchainAddress) {
    if (!opts.consume) return { ok: true, kind: "credits", remaining: cred.remaining, signature: "" };
    const c = chain();
    const ix = await c.consumeCreditIx(authorities().usage, agent.id, address(wallet));
    const { signature } = await c.sendAsServer([ix]);
    await syncCredits(address(agent.onchainAddress), address(wallet), agent.id);
    return { ok: true, kind: "credits", remaining: cred.remaining - 1, signature };
  }

  const [trial] = await db
    .select()
    .from(schema.trials)
    .where(and(eq(schema.trials.agentId, agent.id), eq(schema.trials.wallet, wallet)));
  const used = trial?.used ?? 0;
  if (used >= FREE_TRIAL_USES) return { ok: false, reason: "trial_exhausted" };
  if (!opts.consume) return { ok: true, kind: "trial", remaining: FREE_TRIAL_USES - used };
  // Incremento atômico com teto, para duas ativações simultâneas não passarem de 3.
  const updated = await db
    .insert(schema.trials)
    .values({ agentId: agent.id, wallet, used: 1 })
    .onConflictDoUpdate({
      target: [schema.trials.agentId, schema.trials.wallet],
      set: { used: sql`${schema.trials.used} + 1`, updatedAt: new Date() },
      setWhere: sql`${schema.trials.used} < ${FREE_TRIAL_USES}`,
    })
    .returning();
  if (updated.length === 0) return { ok: false, reason: "trial_exhausted" };
  return { ok: true, kind: "trial", remaining: FREE_TRIAL_USES - updated[0]!.used };
}

/** Solvers que a carteira pode usar agora (licença ou créditos), para list_my_solvers. */
export async function ownedAgents(wallet: string) {
  const lic = await db
    .select({ agentId: schema.licenses.agentId })
    .from(schema.licenses)
    .where(eq(schema.licenses.ownerWallet, wallet));
  const cred = await db
    .select({ agentId: schema.credits.agentId, remaining: schema.credits.remaining })
    .from(schema.credits)
    .where(and(eq(schema.credits.ownerWallet, wallet), gt(schema.credits.purchased, 0)));
  const map = new Map<string, { license: boolean; credits: number | null }>();
  for (const l of lic) map.set(l.agentId, { license: true, credits: null });
  for (const c of cred) {
    const prev = map.get(c.agentId);
    map.set(c.agentId, { license: prev?.license ?? false, credits: c.remaining });
  }
  return map;
}

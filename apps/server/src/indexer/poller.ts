import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import type { Signature } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { h, unauthorized } from "../lib/http.js";
import { processSignature, processTransaction } from "./processor.js";

// Indexador (INSTRUCTIONS.md 5.11): webhook da Helius + polling de fallback obrigatório.

const CURSOR_KEY = "indexer:last_signature";

async function getCursor(): Promise<string | null> {
  const [row] = await db.select().from(schema.kv).where(eq(schema.kv.key, CURSOR_KEY));
  return (row?.value as string | undefined) ?? null;
}

async function setCursor(sig: string) {
  await db
    .insert(schema.kv)
    .values({ key: CURSOR_KEY, value: sig })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: sig, updatedAt: new Date() } });
}

/** Uma rodada de polling: busca assinaturas novas do programa e processa da mais antiga para a mais nova. */
export async function pollOnce(): Promise<number> {
  const c = chain();
  const until = (await getCursor()) ?? undefined;
  const pending: string[] = [];
  let before: string | undefined;
  // Pagina para trás até chegar no cursor (ou no começo do programa).
  for (let page = 0; page < 20; page++) {
    const sigs = await c.rpc
      .getSignaturesForAddress(c.programId, {
        limit: 1000,
        until: until as Signature | undefined,
        before: before as Signature | undefined,
        commitment: "confirmed",
      })
      .send();
    if (sigs.length === 0) break;
    for (const s of sigs) if (!s.err) pending.push(s.signature);
    before = sigs[sigs.length - 1]!.signature;
    if (sigs.length < 1000) break;
  }
  const newest = pending[0];
  for (const sig of pending.reverse()) {
    await processSignature(sig);
  }
  if (newest) await setCursor(newest);
  return pending.length;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startPoller() {
  if (!env.INDEXER_ENABLED || timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await pollOnce();
      if (n > 0) console.log(`[indexer] ${n} transações processadas`);
    } catch (e) {
      console.error("[indexer] falha no polling", (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  timer = setInterval(tick, env.INDEXER_POLL_MS);
}

export function stopPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

function authorized(req: Request): boolean {
  const secret = env.HELIUS_WEBHOOK_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

type HeliusRawTx = {
  blockTime?: number;
  meta?: { err?: unknown; logMessages?: string[] };
  transaction?: { signatures?: string[] };
};

export const webhookRouter = Router();

webhookRouter.post(
  "/helius",
  h(async (req) => {
    if (!authorized(req)) throw unauthorized("webhook sem autorização");
    const txs = (Array.isArray(req.body) ? req.body : [req.body]) as HeliusRawTx[];
    let count = 0;
    for (const tx of txs) {
      const sig = tx.transaction?.signatures?.[0];
      if (!sig) continue;
      const logs = tx.meta?.logMessages;
      if (logs) {
        count += (await processTransaction(sig, logs, { failed: tx.meta?.err != null, blockTime: tx.blockTime ?? null })).length;
      } else {
        count += (await processSignature(sig)).length;
      }
    }
    return { ok: true, events: count };
  }),
);

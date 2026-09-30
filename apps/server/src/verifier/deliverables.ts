import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import { address } from "@solvers/chain";
import { authorities, chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { randomToken, sha256, sha256Hex } from "../lib/crypto.js";
import { syncEscrow } from "../indexer/sync.js";
import { notifyCreator } from "../notify/telegram.js";
import { runTests, sanitizeFiles, writeFiles, type Files, type TestReport } from "./sandbox.js";

// Fluxo da garantia (INSTRUCTIONS.md 5.7): a IA entrega, o servidor roda os testes combinados;
// se passar, marca a etapa on-chain (mark_passed) e gera uma prévia com marca d'água.
// O arquivo final só fica disponível depois de aprovado ou liberado.

const root = () => resolve(env.DELIVERABLES_DIR);

/** Hash determinístico da entrega: sha256 de (nome + sha256(conteúdo)) em ordem. */
export function filesHash(files: Files): Buffer {
  const h = sha256(
    Object.keys(files)
      .sort()
      .map((k) => `${k}\0${sha256Hex(files[k]!)}`)
      .join("\n"),
  );
  return h;
}

export async function submitDeliverable(input: { wallet: string; agentId: string; escrowId: string; index: number; files: Files }) {
  const files = sanitizeFiles(input.files);
  const [escrow] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, input.escrowId));
  if (!escrow) throw notFound("Tarefa com garantia não encontrada");
  if (escrow.buyerWallet !== input.wallet) throw forbidden("Esta garantia pertence a outra carteira");
  if (escrow.agentId !== input.agentId) throw badRequest("Esta garantia é de outro especialista");
  const where = and(eq(schema.milestones.escrowId, escrow.id), eq(schema.milestones.idx, input.index));
  const [m] = await db.select().from(schema.milestones).where(where);
  if (!m) throw notFound("Etapa não encontrada");
  if (!["pending", "submitted"].includes(m.status)) throw badRequest(`Esta etapa já está ${m.status}`);

  const dir = join(root(), escrow.id, String(input.index));
  writeFiles(dir, files);
  const hash = filesHash(files);
  await db.update(schema.milestones).set({ status: "submitted", deliverablePath: dir, deliverableHash: hash.toString("hex") }).where(where);

  const report: TestReport = await runTests(files);
  if (!report.passed) {
    await db.update(schema.milestones).set({ status: "pending", verifierReport: report as unknown as Record<string, unknown> }).where(where);
    return { passed: false as const, report, previewUrl: null, autoReleaseAt: null };
  }

  const c = chain();
  const ix = await c.markPassedIx(authorities().verifier, address(escrow.id), input.index, hash);
  await c.sendAsServer([ix]);
  await syncEscrow(address(escrow.id));

  const token = randomToken(18);
  const previewUrl = `${env.PUBLIC_API_URL.replace(/\/$/, "")}/preview/${escrow.id}/${input.index}?t=${token}`;
  await db.update(schema.milestones).set({ previewUrl, verifierReport: report as unknown as Record<string, unknown> }).where(where);
  const [after] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, escrow.id));
  void notifyCreator(escrow.agentId, `Solvers: etapa ${input.index + 1} da garantia ${escrow.id.slice(0, 8)}… passou nos testes.`);
  return {
    passed: true as const,
    report,
    previewUrl,
    autoReleaseAt: after?.autoReleaseAt?.toISOString() ?? null,
  };
}

export function readDeliverable(dir: string): Files {
  const out: Files = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

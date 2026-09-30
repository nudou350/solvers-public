import { readFileSync, readdirSync, statSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
import { a11yCheck } from "../runtime/tools.js";
import { runTests, sanitizeAcceptance, sanitizeFiles, writeFiles, type Files, type TestReport } from "./sandbox.js";

// Fluxo da garantia (INSTRUCTIONS.md 5.7): a IA entrega; o servidor roda a bateria de aceite
// combinada na criação da garantia (a entrega não consegue trocá-la); se passar, marca a etapa
// on-chain (mark_passed) e gera uma prévia estática com marca d'água. O código só é liberado
// para download depois de aprovado ou liberado.

const root = () => resolve(env.DELIVERABLES_DIR);
export const milestoneDir = (escrowId: string, idx: number) => join(root(), escrowId, String(idx));

/** Hash determinístico de um conjunto de arquivos: sha256 de (nome + sha256(conteúdo)) em ordem. */
export function filesHash(files: Files): Buffer {
  return sha256(
    Object.keys(files)
      .sort()
      .map((k) => `${k}\0${sha256Hex(files[k]!)}`)
      .join("\n"),
  );
}

/** Grava a bateria de aceite de uma etapa e devolve seu hash (vai para o criteria_hash on-chain). */
export function saveAcceptance(escrowId: string, idx: number, tests: Files): { path: string; hash: string } {
  const files = sanitizeAcceptance(tests);
  const dir = join(milestoneDir(escrowId, idx), "acceptance");
  rmSync(dir, { recursive: true, force: true });
  writeFiles(dir, files);
  return { path: dir, hash: filesHash(files).toString("hex") };
}

export function criteriaHash(title: string, criteria: string, acceptanceHash?: string | null): Buffer {
  return sha256(`${title}\n${criteria}${acceptanceHash ? `\n${acceptanceHash}` : ""}`);
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

  // Cada envio substitui o anterior por completo (sem sobras de tentativas que falharam).
  const dir = join(milestoneDir(escrow.id, input.index), "files");
  rmSync(dir, { recursive: true, force: true });
  writeFiles(dir, files);
  rmSync(join(milestoneDir(escrow.id, input.index), "preview.html"), { force: true });
  const hash = filesHash(files);
  await db.update(schema.milestones).set({ status: "submitted", deliverablePath: dir, deliverableHash: hash.toString("hex") }).where(where);

  const acceptance = m.acceptancePath && existsSync(m.acceptancePath) ? readDeliverable(m.acceptancePath) : null;
  const { report, previewHtml } = await runTests(files, { acceptance });

  // Critério de acessibilidade combinado: checagem estática no código da entrega.
  const wantsA11y = /acessibilidade|a11y/i.test(m.criteria);
  const a11y = wantsA11y ? a11yCheck(Object.fromEntries(Object.entries(files).filter(([n]) => !/\.test\./.test(n)))) : null;
  const finalReport: TestReport & { a11y?: ReturnType<typeof a11yCheck>; selfWrittenTestsOnly?: boolean } = {
    ...report,
    passed: report.passed && (a11y?.passed ?? true),
    ...(a11y ? { a11y } : {}),
    // Sem bateria de aceite, os testes vieram da própria entrega: o relatório deixa isso explícito.
    selfWrittenTestsOnly: !acceptance,
  };
  if (a11y && !a11y.passed) {
    finalReport.failures = [...finalReport.failures, ...a11y.issues.map((i) => ({ test: `acessibilidade: ${i.rule}`, message: `${i.file}: ${i.message}` }))];
  }

  if (!finalReport.passed) {
    await db
      .update(schema.milestones)
      .set({ status: "pending", deliverablePath: null, deliverableHash: null, verifierReport: finalReport as unknown as Record<string, unknown> })
      .where(where);
    rmSync(dir, { recursive: true, force: true });
    return { passed: false as const, report: finalReport, previewUrl: null, autoReleaseAt: null };
  }

  if (previewHtml) {
    mkdirSync(milestoneDir(escrow.id, input.index), { recursive: true });
    writeFileSync(join(milestoneDir(escrow.id, input.index), "preview.html"), previewHtml);
  }

  const c = chain();
  const ix = await c.markPassedIx(authorities().verifier, address(escrow.id), input.index, hash);
  await c.sendAsServer([ix]);
  await syncEscrow(address(escrow.id));

  const token = randomToken(18);
  const previewUrl = `${env.PUBLIC_API_URL.replace(/\/$/, "")}/preview/${escrow.id}/${input.index}?t=${token}`;
  await db.update(schema.milestones).set({ previewUrl, verifierReport: finalReport as unknown as Record<string, unknown> }).where(where);
  const [after] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, escrow.id));
  void notifyCreator(escrow.agentId, `Solvers: etapa ${input.index + 1} da garantia ${escrow.id.slice(0, 8)}… passou na verificação.`);
  return { passed: true as const, report: finalReport, previewUrl, autoReleaseAt: after?.autoReleaseAt?.toISOString() ?? null };
}

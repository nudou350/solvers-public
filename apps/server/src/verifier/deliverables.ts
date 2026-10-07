import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import { address } from "@solvers/chain";
import * as gen from "@solvers/client";
import { authorities, chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/http.js";
import { bytesToHexStr, randomId, randomToken, sha256, sha256Hex } from "../lib/crypto.js";
import { syncEscrow } from "../indexer/sync.js";
import { notifyCreator } from "../notify/telegram.js";
import { a11yCheck } from "../runtime/tools.js";
import { installDeliverable, type Installed } from "./install.js";
import { withKeyLock } from "./lock.js";
import { planMarkPassed, type ChainMilestone } from "./report.js";
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

/** Apaga o que `saveAcceptance` gravou para um escrow que não chegou a ser criado (simulação recusada). Só para escrow novo: apaga a pasta inteira dele. */
export function discardAcceptance(escrowId: string): void {
  rmSync(join(root(), escrowId), { recursive: true, force: true });
}

export function criteriaHash(title: string, criteria: string, acceptanceHash?: string | null): Buffer {
  return sha256(`${title}\n${criteria}${acceptanceHash ? `\n${acceptanceHash}` : ""}`);
}

/** Lê uma pasta de entrega/bateria gravada pelo servidor. Só arquivos comuns (symlink e afins são ignorados). */
export function readDeliverable(dir: string): Files {
  const out: Files = {};
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

type FinalReport = TestReport & { a11y?: ReturnType<typeof a11yCheck>; selfWrittenTestsOnly?: boolean };

/**
 * Bateria de aceite da etapa. Se ela foi combinada (hash no banco e on-chain), o que está em disco
 * tem que existir e bater com o hash: senão a verificação PARA (nunca cai para "testes da própria
 * entrega", que enfraqueceria a garantia em silêncio).
 */
function loadAcceptance(m: typeof schema.milestones.$inferSelect): Files | null {
  if (!m.acceptanceHash) return m.acceptancePath && existsSync(m.acceptancePath) ? readDeliverable(m.acceptancePath) : null;
  const files = m.acceptancePath ? readDeliverable(m.acceptancePath) : {};
  if (Object.keys(files).length === 0 || filesHash(files).toString("hex") !== m.acceptanceHash) {
    console.error(`[verifier] bateria de aceite ausente ou diferente do hash combinado (${m.escrowId}/${m.idx})`);
    throw new HttpError(
      500,
      "The agreed acceptance test suite for this step is not available. The check was stopped; please contact support.",
      "acceptance_unavailable",
    );
  }
  return files;
}

/** Etapa com testes: roda a bateria de aceite combinada (ou os testes da entrega) e o a11y, se combinado. */
async function verifyWithTests(files: Files, m: typeof schema.milestones.$inferSelect): Promise<{ report: FinalReport; previewHtml: string | null }> {
  const acceptance = loadAcceptance(m);
  const { report, previewHtml } = await runTests(files, { acceptance });

  // Critério de acessibilidade combinado: checagem estática no código da entrega.
  const wantsA11y = /acessibilidade|a11y/i.test(m.criteria);
  const a11y = wantsA11y ? a11yCheck(Object.fromEntries(Object.entries(files).filter(([n]) => !/\.test\./.test(n)))) : null;
  const finalReport: FinalReport = {
    ...report,
    passed: report.passed && (a11y?.passed ?? true),
    ...(a11y ? { a11y } : {}),
    // Sem bateria de aceite, os testes vieram da própria entrega: o relatório deixa isso explícito.
    selfWrittenTestsOnly: !acceptance,
  };
  if (a11y && !a11y.passed) {
    finalReport.failures = [...finalReport.failures, ...a11y.issues.map((i) => ({ test: `acessibilidade: ${i.rule}`, message: `${i.file}: ${i.message}` }))];
  }
  return { report: finalReport, previewHtml };
}

/**
 * Etapa de revisão manual (ex: plano): não há teste automático. A entrega fica disponível para o
 * comprador ler na prévia; ele aprova ou contesta dentro da janela, senão a liberação é automática.
 */
function manualReview(files: Files): { report: FinalReport; previewHtml: string } {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const previewHtml = Object.entries(files)
    .map(([name, content]) => `<h4>${esc(name)}</h4><pre style="white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace">${esc(content)}</pre>`)
    .join("");
  return {
    report: { passed: true, mode: "manual", numTests: 0, numPassed: 0, numFailed: 0, acceptance: null, failures: [], durationMs: 0 },
    previewHtml,
  };
}


/** Estado da etapa on-chain (null se a conta ou a etapa não puderam ser lidas). */
async function readChainMilestone(escrowId: string, idx: number): Promise<ChainMilestone> {
  try {
    const acc = await gen.fetchMaybeEscrow(chain().rpc, address(escrowId));
    const cm = acc.exists ? acc.data.milestones[idx] : undefined;
    return cm ? { status: Number(cm.status), deliverableHash: bytesToHexStr(cm.deliverableHash) } : null;
  } catch (e) {
    console.warn("[verifier] não consegui ler a etapa on-chain:", (e as Error).message);
    return null;
  }
}

type SubmitInput = { wallet: string; agentId: string; escrowId: string; index: number; files: Files };

/**
 * Envio de uma entrega. Serializado por etapa (escrow:idx): dois envios da mesma etapa nunca rodam
 * juntos, então um não apaga nem sobrescreve o resultado do outro.
 */
export function submitDeliverable(input: SubmitInput) {
  const files = sanitizeFiles(input.files);
  return withKeyLock(`${input.escrowId}:${input.index}`, () => submitLocked(input, files));
}

async function submitLocked(input: SubmitInput, files: Files) {
  const [escrow] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, input.escrowId));
  if (!escrow) throw notFound("Guaranteed task not found");
  if (escrow.buyerWallet !== input.wallet) throw forbidden("This guarantee belongs to another wallet");
  if (escrow.agentId !== input.agentId) throw badRequest("This guarantee belongs to another specialist");
  const where = and(eq(schema.milestones.escrowId, escrow.id), eq(schema.milestones.idx, input.index));
  const [m] = await db.select().from(schema.milestones).where(where);
  if (!m) throw notFound("Step not found");

  const hash = filesHash(files);
  const hashHex = hash.toString("hex");
  // "passed" com o mesmo hash: a etapa já foi aprovada on-chain com esta mesma entrega (reenvio depois de
  // timeout do cliente, ou queda no meio de um envio anterior).
  const sameDelivery = m.status === "passed" && m.deliverableHash === hashHex;
  if (sameDelivery && m.previewUrl) {
    return {
      passed: true as const,
      report: (m.verifierReport ?? {}) as unknown as FinalReport,
      previewUrl: m.previewUrl,
      autoReleaseAt: escrow.autoReleaseAt?.toISOString() ?? null,
    };
  }
  if (!["pending", "submitted"].includes(m.status) && !sameDelivery) throw badRequest(`This step is already ${m.status}`);

  // Só o estado off-chain muda aqui; nada da tentativa anterior em disco é tocado antes de passar.
  const onlySubmitted = and(where, eq(schema.milestones.status, "submitted"));
  // Devolve a etapa a "pending" (só se ainda "submitted", ou seja, desta tentativa). Nunca mascara o erro original.
  const backToPending = async () => {
    try {
      await db.update(schema.milestones).set({ status: "pending" }).where(onlySubmitted);
    } catch (e) {
      console.error("[verifier] não consegui devolver a etapa a pending:", (e as Error).message);
    }
  };
  if (m.status === "pending") await db.update(schema.milestones).set({ status: "submitted" }).where(where);

  let verified: { report: FinalReport; previewHtml: string | null };
  try {
    verified = m.verify === "manual" ? manualReview(files) : await verifyWithTests(files, m);
  } catch (e) {
    await backToPending();
    throw e;
  }
  const { report: finalReport, previewHtml } = verified;

  if (!finalReport.passed) {
    // Falha: só registra o relatório e devolve a etapa a "pending" (se ainda estiver "submitted").
    // Não há arquivos desta tentativa em disco para apagar, e uma etapa "passed" nunca é alterada.
    await db
      .update(schema.milestones)
      .set({ status: "pending", verifierReport: finalReport as unknown as Record<string, unknown> })
      .where(onlySubmitted);
    return { passed: false as const, report: finalReport, previewUrl: null, autoReleaseAt: null };
  }

  const c = chain();
  const escrowAddr = address(escrow.id);
  // Antes de qualquer coisa irreversível: o que está on-chain permite esta entrega?
  const plan = planMarkPassed(await readChainMilestone(escrow.id, input.index), hashHex);
  if (plan === "conflict") {
    await backToPending();
    throw badRequest("This step was already marked on-chain with a different delivery.", "milestone_conflict");
  }

  // Persiste entrega, prévia e relatório ANTES do mark_passed. A rota /preview só serve com a etapa
  // "passed"/"approved", então a URL não fica acessível antes da confirmação on-chain.
  const previewUrl = `${env.PUBLIC_API_URL.replace(/\/$/, "")}/preview/${escrow.id}/${input.index}?t=${randomToken(18)}`;
  let installed: Installed | null = null;
  try {
    installed = installDeliverable(milestoneDir(escrow.id, input.index), files, previewHtml);
    await db
      .update(schema.milestones)
      .set({ deliverablePath: installed.dir, deliverableHash: hashHex, previewUrl, verifierReport: finalReport as unknown as Record<string, unknown> })
      .where(where);
  } catch (e) {
    // Nada foi enviado à cadeia: desfaz a instalação e a etapa volta a pending.
    try {
      installed?.undo();
    } catch (u) {
      console.error("[verifier] não consegui desfazer a instalação:", (u as Error).message);
    }
    await backToPending();
    throw e;
  }

  if (plan === "send") {
    try {
      const ix = await c.markPassedIx(authorities().verifier, escrowAddr, input.index, hash);
      await c.sendAsServer([ix]);
    } catch (e) {
      // A transação pode ter entrado mesmo com erro (ex: timeout de confirmação): confere antes de falhar.
      const outcome = planMarkPassed(await readChainMilestone(escrow.id, input.index), hashHex);
      if (outcome !== "already") {
        if (outcome === "conflict") {
          // Outra entrega (tentativa anterior em voo) ficou aprovada on-chain: disco e banco voltam a
          // refletir a entrega que a cadeia tem, e o banco sincroniza o status.
          try {
            installed.undo();
            await db
              .update(schema.milestones)
              .set({ deliverablePath: m.deliverablePath, deliverableHash: m.deliverableHash, previewUrl: m.previewUrl, verifierReport: m.verifierReport })
              .where(where);
          } catch (u) {
            console.error("[verifier] não consegui restaurar a entrega anterior:", (u as Error).message);
          }
          await backToPending();
          await syncEscrow(escrowAddr).catch(() => undefined);
          throw badRequest("This step was already marked on-chain with a different delivery.", "milestone_conflict");
        }
        // Resultado incerto (a transação ainda pode entrar): mantém esta entrega salva, coerente com o que
        // será aprovado; o syncEscrow preserva "passed" se ela entrar.
        installed.commit();
        await backToPending();
        throw e;
      }
    }
  }
  installed.commit();
  try {
    await syncEscrow(escrowAddr);
  } catch (e) {
    // Já está aprovada on-chain e salva; o indexer sincroniza o banco.
    console.warn("[verifier] syncEscrow falhou depois do mark_passed:", (e as Error).message);
  }

  const [after] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, escrow.id));
  void notifyCreator(escrow.agentId, `Solvers: step ${input.index + 1} of guarantee ${escrow.id.slice(0, 8)}… passed verification.`);
  return { passed: true as const, report: finalReport, previewUrl, autoReleaseAt: after?.autoReleaseAt?.toISOString() ?? null };
}

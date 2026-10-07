import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { canTransition, type SubmissionStatus } from "@solvers/shared";
import { db, pool, schema } from "../db/index.js";
import { env } from "../env.js";
import { deleteKnowledgeVersion, renameKnowledgeVersion } from "../knowledge/ingest.js";
import { notifyCreator, sendTelegram } from "../notify/telegram.js";
import { loadPackage, packageHash, reloadPackages, type SolverPackage } from "../runtime/packages.js";
import { FINALIZABLE_STATUSES, nextPublicationStep, parseApproved, statusAfterChain, type ApprovedRecord, type PublicationStep } from "./approval-rules.js";
import { prepareCatalog, relist, writeCatalog, type PreparedCatalog } from "./catalog.js";
import { publishChain, type PublishChain } from "./chain-port.js";
import { cleanIncoming, findPackageRoot, incomingParent, publishedIdentityOf, publishedVersionOf, stagePackage, swapInPublished } from "./fs.js";
import { versionGreater } from "../submissions/rules.js";

// Finalização da publicação (PACKAGE_SPEC.md 15.3, passo 5): a versão aprovada passa a ser a servida. Idempotente e
// retomável: cada passo confere o que já foi feito, e uma falha deixa a submissão em `publish_failed` para o admin
// tentar de novo (POST /admin/submissions/:id/finish). A vitrine NÃO muda antes do último passo: o catálogo é gravado
// numa única transação no fim, depois do disco, do conhecimento e do espelho da cadeia.

export type FinalizeDeps = {
  port: PublishChain;
  /** Pasta de pacotes publicados e das submissões (resolvidas; os testes apontam para uma pasta temporária). */
  publishedDir: string;
  submissionsDir: string;
  renameKnowledge: (agentId: string, from: string, to: string) => Promise<number>;
  deleteKnowledge: (agentId: string, version: string) => Promise<number>;
  prepare: (pkg: SolverPackage) => Promise<PreparedCatalog>;
  /** Recarrega o cache de pacotes do runtime (`reloadPackages`). */
  reload: () => void;
  notifyAdmin: (text: string) => Promise<unknown>;
  notifyCreator: (agentId: string, text: string) => Promise<unknown>;
};

export function defaultFinalizeDeps(): FinalizeDeps {
  return {
    port: publishChain(),
    publishedDir: resolve(process.cwd(), env.PUBLISHED_DIR),
    submissionsDir: resolve(process.cwd(), env.SUBMISSIONS_DIR),
    renameKnowledge: renameKnowledgeVersion,
    deleteKnowledge: deleteKnowledgeVersion,
    prepare: prepareCatalog,
    reload: () => void reloadPackages(),
    notifyAdmin: (text) => sendTelegram(env.TELEGRAM_ADMIN_CHAT_ID, text),
    notifyCreator,
  };
}

export type FinalizeResult =
  | { outcome: "published"; version: string }
  | { outcome: "already_published" }
  /** Outro processo está finalizando esta submissão (evento + botão + CLI ao mesmo tempo): nada a fazer. */
  | { outcome: "busy" }
  /** Ainda não dá: estado errado, cadeia atrás do aprovado, agente suspenso. Nada foi mudado (exceto o avanço de estado). */
  | { outcome: "not_ready"; status: SubmissionStatus; step?: PublicationStep; reason: string }
  | { outcome: "failed"; error: string };

type SubmissionRow = typeof schema.packageSubmissions.$inferSelect;

const short = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 500);

/** Erro de conferência com texto próprio (hash, id, slug, versão): seguro de mostrar ao criador. Qualquer outro erro é interno. */
export class PublishCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishCheckError";
  }
}

/** O que o criador vê (coluna `error`, respostas da API) quando a publicação falha por erro interno: o detalhe (caminhos, banco) vai só ao log e ao admin. */
export const PUBLISH_FAILED_TEXT = "Publishing failed because of an internal error. The team has been notified and will try again.";

/** Troca de estado condicionada ao estado visto (e a `canTransition`): quem perdeu a corrida não sobrescreve. */
export async function moveSubmission(id: string, from: SubmissionStatus, to: SubmissionStatus, extra: Partial<SubmissionRow> = {}): Promise<boolean> {
  if (from !== to && !canTransition(from, to)) return false;
  const rows = await db
    .update(schema.packageSubmissions)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(and(eq(schema.packageSubmissions.id, id), eq(schema.packageSubmissions.status, from)))
    .returning({ id: schema.packageSubmissions.id });
  return rows.length > 0;
}

/**
 * Publica a versão aprovada. `actor` (carteira do admin) vira uma linha `finish` em `package_reviews` quando a
 * finalização é uma ação dele (botão "Concluir", `cli:approve`); disparada pelo evento da cadeia, não registra.
 */
export async function finalizePublication(submissionId: string, opts: { actor?: string; deps?: Partial<FinalizeDeps> } = {}): Promise<FinalizeResult> {
  const deps = { ...defaultFinalizeDeps(), ...opts.deps };
  // Uma finalização por submissão: evento da cadeia, botão do admin e CLI podem chegar juntos. O lock é da sessão do
  // Postgres (cai sozinho se o processo morrer).
  const client = await pool.connect();
  const key = `finalize:${submissionId}`;
  try {
    const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as ok", [key]);
    if (!got.rows[0]?.ok) return { outcome: "busy" };
    try {
      const result = await run(submissionId, opts.actor, deps);
      // Outro processo (CLI `cli:approve`, evento da cadeia no worker) pode ter publicado: a API recarrega o cache do disco.
      if (result.outcome === "already_published" || result.outcome === "busy") deps.reload();
      return result;
    } finally {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
    }
  } finally {
    client.release();
  }
}

async function run(id: string, actor: string | undefined, deps: FinalizeDeps): Promise<FinalizeResult> {
  const [sub] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
  if (!sub) return { outcome: "not_ready", status: "submitted", reason: "submissão não encontrada" };
  const status = sub.status as SubmissionStatus;
  if (status === "published") return { outcome: "already_published" };
  if (!FINALIZABLE_STATUSES.includes(status)) return { outcome: "not_ready", status, reason: `a submissão está em ${status}` };
  const approved = parseApproved(sub.approved);
  if (!approved) return { outcome: "not_ready", status, reason: "a submissão não tem versão aprovada" };

  // Agente suspenso pela plataforma: publicar uma versão não pode levantar a suspensão sem querer.
  const [existing] = await db.select({ platformStatus: schema.agents.platformStatus }).from(schema.agents).where(eq(schema.agents.id, sub.agentId));
  if (existing?.platformStatus === "suspended") return { outcome: "not_ready", status, reason: "o Solver está suspenso: reative (cli:suspend --resume) antes de publicar" };

  // A cadeia precisa estar exatamente como o aprovado e o agente Active (aprovado pelo admin on-chain).
  let step: PublicationStep;
  try {
    step = nextPublicationStep(approved, await deps.port.fetchAgentState(sub.agentId));
  } catch (e) {
    return { outcome: "not_ready", status, reason: `não consegui ler a cadeia: ${short(e)}` };
  }
  if (step !== "ready") {
    const next = statusAfterChain(status, step);
    if (next !== "finalize" && next !== status) {
      if (await moveSubmission(id, status, next)) {
        if (next === "awaiting_onchain_approval") {
          await deps.notifyAdmin(`Solvers: ${sub.slug} v${approved.version} está pronto para a aprovação on-chain.\nRode: pnpm --filter @solvers/server cli:approve ${sub.slug}`).catch(() => undefined);
        }
        return { outcome: "not_ready", status: next, step, reason: `falta: ${step}` };
      }
    }
    return { outcome: "not_ready", status, step, reason: `falta: ${step}` };
  }

  // A partir daqui é "publishing": qualquer falha vira publish_failed e o admin tenta de novo.
  if (status !== "publishing") {
    if (!(await moveSubmission(id, status, "publishing", { error: null }))) return { outcome: "busy" };
  }
  try {
    const version = await publish(sub, approved, actor, deps);
    await deps.notifyCreator(sub.agentId, `Solvers: your Solver ${approved.name} v${version} is live.`).catch(() => undefined);
    return { outcome: "published", version };
  } catch (e) {
    const detail = short(e);
    console.error(`[publish] a publicação de ${sub.slug} v${approved.version} falhou:`, e);
    // Erro de conferência tem texto próprio e seguro; qualquer outro (disco, banco) é interno: o criador vê texto fixo.
    const error = e instanceof PublishCheckError ? detail : PUBLISH_FAILED_TEXT;
    await moveSubmission(id, "publishing", "publish_failed", { error });
    await deps.notifyAdmin(`Solvers: a publicação de ${sub.slug} v${approved.version} falhou: ${detail}\nTente de novo em /admin/reviews (Concluir).`).catch(() => undefined);
    return { outcome: "failed", error };
  }
}

/** Os passos com efeito. Lança em qualquer falha (quem chama marca publish_failed). Devolve a versão publicada. */
async function publish(sub: SubmissionRow, approved: ApprovedRecord, actor: string | undefined, deps: FinalizeDeps): Promise<string> {
  const id = sub.id;
  const target = join(deps.publishedDir, sub.slug);

  // 1. Disco: a pasta publicada vira a aprovada (troca por rename; a anterior vai para _archive/). Já publicada = pula.
  const alreadyThere = existsSync(join(target, "manifest.json")) && publishedVersionOf(target) === approved.version && packageHash(target) === approved.versionHash;
  if (!alreadyThere) {
    // A pasta que está no ar neste slug é deste Solver? E a versão aprovada não é menor que a ativa (nada de rebaixar)?
    const current = existsSync(join(target, "manifest.json")) ? publishedIdentityOf(target) : null;
    if (current?.id && current.id !== sub.agentId) throw new PublishCheckError("the published folder for this slug belongs to another Solver; nothing was changed");
    if (current?.version && versionGreater(current.version, approved.version)) throw new PublishCheckError(`the approved version (${approved.version}) is lower than the published one (${current.version}); nothing was changed`);
    const root = findPackageRoot(join(deps.submissionsDir, id, "extracted"));
    const staged = stagePackage(root, incomingParent(deps.publishedDir, id), sub.slug);
    // Confere ANTES de tocar na pasta publicada: o que vai ao ar é byte a byte o que o revisor aprovou.
    checkPackage(loadPackage(staged, { source: "published" }), sub, approved);
    swapInPublished(deps.publishedDir, sub.slug, staged, sub.agentId);
  }
  const pkg = loadPackage(target, { source: "published" });
  checkPackage(pkg, sub, approved);
  cleanIncoming(deps.publishedDir, id);

  // 2. Conhecimento: os trechos de staging viram os da versão real (um UPDATE, sem recalcular vetores). Os da versão antiga
  // só saem depois de a nova estar no ar (passo 7), para o RAG nunca ficar vazio.
  await deps.renameKnowledge(sub.agentId, `staging:${id}`, approved.version);

  // 3. Quem é o criador (o perfil manda no `creators.id`, não o manifesto) e os vetores de busca (lento; fora de transação).
  const [creator] = await db.select({ id: schema.creators.id }).from(schema.creators).where(eq(schema.creators.wallet, sub.creatorWallet));
  if (!creator) throw new Error(`o criador ${sub.creatorWallet} não tem perfil (creators)`);
  const prepared = await deps.prepare(pkg);

  // 4. Espelho da cadeia (versão aprovada: `agent_published_versions` já tem a linha, então o sync a aceita como `ok`).
  await deps.port.syncAgent(sub.agentId);

  // 5. Catálogo, numa transação só: é aqui que a vitrine muda.
  const [prior] = await db
    .select({ id: schema.packageSubmissions.id })
    .from(schema.packageSubmissions)
    .where(and(eq(schema.packageSubmissions.agentId, sub.agentId), ne(schema.packageSubmissions.id, id), inArray(schema.packageSubmissions.status, ["published", "superseded", "suspended", "withdrawn"])))
    .limit(1);
  await db.transaction(async (tx) => {
    await writeCatalog(prepared, sub.creatorWallet, { agentId: sub.agentId, upsertCreator: false, creatorId: creator.id }, tx as unknown as typeof db);
    await relist(sub.agentId, tx as unknown as typeof db);
    // Primeira publicação do agente: platform_status começa `active`. Nas seguintes não se mexe (suspensão é decisão do admin).
    if (!prior) await tx.update(schema.agents).set({ platformStatus: "active" }).where(eq(schema.agents.id, sub.agentId));
    const done = await tx
      .update(schema.packageSubmissions)
      .set({ status: "published", error: null, updatedAt: new Date() })
      .where(and(eq(schema.packageSubmissions.id, id), eq(schema.packageSubmissions.status, "publishing")))
      .returning({ id: schema.packageSubmissions.id });
    if (done.length === 0) throw new Error("a submissão saiu de 'publishing' durante a finalização");
    await tx
      .update(schema.packageSubmissions)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(schema.packageSubmissions.agentId, sub.agentId), ne(schema.packageSubmissions.id, id), eq(schema.packageSubmissions.status, "published")));
    if (actor) {
      await tx.insert(schema.packageReviews).values({ submissionId: id, reviewerWallet: actor, action: "finish", notes: "Publicação concluída", versionHash: approved.versionHash });
    }
  });

  // 6. O runtime passa a servir o pacote novo (sessões da versão antiga recebem session_outdated e reativam).
  deps.reload();

  // 7. Só agora saem os trechos das versões anteriores (se falhar, sobra lixo, mas a publicação já está de pé). A versão do
  // catálogo NÃO serve de referência (o espelho da cadeia já a trocou quando o criador assinou): vale o que existe em
  // knowledge_chunks, menos a nova e os `staging:*` de outras submissões em andamento.
  try {
    const rows = await db.selectDistinct({ version: schema.knowledgeChunks.version }).from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.agentId, sub.agentId));
    for (const { version } of rows) {
      if (version === approved.version || version.startsWith("staging:")) continue;
      await deps.deleteKnowledge(sub.agentId, version);
    }
  } catch (e) {
    console.warn(`[publish] trechos antigos de ${sub.slug} não removidos: ${short(e)}`);
  }
  return approved.version;
}

/** O pacote carregado é o aprovado? Hash, id, slug e versão (o hash cobre o conteúdo; o resto, a identidade). */
function checkPackage(pkg: SolverPackage, sub: SubmissionRow, approved: ApprovedRecord): void {
  const m = pkg.manifest;
  if (pkg.versionHash !== approved.versionHash) throw new PublishCheckError(`the package content changed after approval (hash ${pkg.versionHash.slice(0, 12)}… ≠ ${approved.versionHash.slice(0, 12)}…)`);
  if (m.id !== sub.agentId) throw new PublishCheckError(`the manifest id (${m.id}) is not the Solver's id (${sub.agentId})`);
  if (m.slug !== sub.slug) throw new PublishCheckError(`the manifest slug (${m.slug}) is not the submission's slug (${sub.slug})`);
  if (m.version !== approved.version) throw new PublishCheckError(`the manifest version (${m.version}) is not the approved one (${approved.version})`);
}

/** Atalho: a submissão (mais recente) em estado de finalização de um Solver, para o evento da cadeia e o CLI. */
export async function pendingSubmissionFor(agentId: string): Promise<SubmissionRow | null> {
  const [row] = await db
    .select()
    .from(schema.packageSubmissions)
    .where(and(eq(schema.packageSubmissions.agentId, agentId), inArray(schema.packageSubmissions.status, [...FINALIZABLE_STATUSES])))
    .orderBy(desc(schema.packageSubmissions.createdAt))
    .limit(1);
  return row ?? null;
}

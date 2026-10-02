import { eq, sql } from "drizzle-orm";
import { DELIST_MAX_RATING, DELIST_MIN_REVIEWS, usdcToUnits } from "@solvers/shared";
import { db, schema } from "../db/index.js";
import { embed } from "../knowledge/embeddings.js";
import type { SolverPackage } from "../runtime/packages.js";

// Catálogo (tabela `agents` e vetores de busca) a partir de um pacote. Extraído do `cli:publish` para servir também
// à finalização do site (publish/finalize.ts): os dois montam a MESMA linha, e o comportamento dos pacotes da
// plataforma (agents/) não muda. Em duas fases: `prepareCatalog` faz o que é lento e pode falhar (vetores de busca,
// sem tocar no banco) e `writeCatalog` grava, aceitando uma transação para o chamador trocar tudo de uma vez.

export function searchText(pkg: SolverPackage): string {
  const m = pkg.manifest;
  return [m.name, m.tagline, m.description, m.category, ...m.packageContents, ...m.requirements.map((r) => r.label)].join("\n");
}

type Exec = Pick<typeof db, "insert" | "update" | "delete">;

export type CatalogOptions = {
  /** Valores que a linha usa no lugar do pacote/manifesto (ex.: o `id` do servidor, o hash aprovado). */
  agentId?: string;
  /** Identificador do perfil do criador (`creators.id`) no lugar do `creator.id` do manifesto (no envio, o servidor manda). */
  creatorId?: string;
  /** Grava (ou atualiza) a linha do criador a partir do manifesto. Falso para terceiros: o perfil vem do cadastro. */
  upsertCreator?: boolean;
  /** Preço em unidades de 6 casas no lugar do manifesto (Solver da plataforma: 0). */
  priceUnits?: bigint;
  /** Também grava `status` (Solver da plataforma sem conta on-chain: `active`). Com cadeia, quem escreve é o indexador. */
  status?: string;
};

export type PreparedCatalog = {
  pkg: SolverPackage;
  text: string;
  phrases: string[];
  vec: number[] | null;
  phraseVecs: number[][];
};

/** Vetores de busca: um para o texto todo e um para cada frase curta (pedido vago casa com a frase, não se perde na descrição). */
export async function prepareCatalog(pkg: SolverPackage): Promise<PreparedCatalog> {
  const m = pkg.manifest;
  const text = searchText(pkg);
  const phrases = [`${m.name}: ${m.tagline}`, ...m.searchPhrases];
  const [vec = null, ...phraseVecs] = (await embed([text, ...phrases], "passage")) ?? [];
  return { pkg, text, phrases, vec, phraseVecs };
}

export function agentDetails(pkg: SolverPackage) {
  const m = pkg.manifest;
  return {
    beforeAfter: m.beforeAfter,
    versions: (m.versions.length ? m.versions : [{ version: m.version, releasedAt: new Date().toISOString(), notes: "Primeira versão" }]).map((v) => ({
      version: v.version,
      versionHash: v.version === m.version ? pkg.versionHash : "",
      releasedAt: v.releasedAt,
      notes: v.notes,
      evalScore: v.version === m.version && pkg.evalReport ? pkg.evalReport.scoreBps / 100 : null,
    })),
    tools: m.tools,
    guaranteeCriteria: m.guarantee.defaultCriteria,
    guaranteeTemplate: m.guarantee.available
      ? {
          priceUsdc: m.guarantee.priceUsdc ?? m.pricing.priceUsdc,
          milestones: m.guarantee.milestones ?? [{ title: "Entrega", criteria: m.guarantee.defaultCriteria, sharePct: 100, verify: "tests" as const }],
        }
      : undefined,
    catalogOnly: m.catalogOnly ?? false,
  };
}

/** Grava a linha do agente e os vetores de busca. `exec` pode ser uma transação (`db.transaction`). */
export async function writeCatalog(prepared: PreparedCatalog, creatorWallet: string, opts: CatalogOptions = {}, exec: Exec = db): Promise<void> {
  const { pkg, text, phrases, vec, phraseVecs } = prepared;
  const m = pkg.manifest;
  const agentId = opts.agentId ?? m.id;
  if (opts.upsertCreator !== false) {
    await exec
      .insert(schema.creators)
      .values({ id: m.creator.id, wallet: creatorWallet, name: m.creator.name, bio: m.creator.bio, avatarUrl: m.creator.avatarUrl ?? null })
      .onConflictDoUpdate({ target: schema.creators.id, set: { name: m.creator.name, bio: m.creator.bio, avatarUrl: m.creator.avatarUrl ?? null } });
  }
  const values = {
    slug: m.slug,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    category: m.category,
    creatorId: opts.creatorId ?? m.creator.id,
    version: m.version,
    versionHash: pkg.versionHash,
    price: opts.priceUnits ?? usdcToUnits(m.pricing.priceUsdc),
    // Só licença vitalícia: o pagamento por uso acabou (o programa mantém o campo, sempre 0).
    pricePerUse: 0n,
    royaltyBps: m.pricing.royaltyBps,
    requirements: m.requirements,
    packageContents: m.packageContents,
    guaranteeAvailable: m.guarantee.available,
    details: agentDetails(pkg),
    searchText: text,
    embedding: vec,
    ...(opts.status ? { status: opts.status } : {}),
    updatedAt: new Date(),
  };
  await exec
    .insert(schema.agents)
    .values({ id: agentId, ...values })
    .onConflictDoUpdate({ target: schema.agents.id, set: values });
  await exec.delete(schema.agentSearchVectors).where(eq(schema.agentSearchVectors.agentId, agentId));
  if (phraseVecs.length > 0) {
    await exec.insert(schema.agentSearchVectors).values(phraseVecs.map((embedding, i) => ({ agentId, content: phrases[i]!, embedding })));
  }
}

/** Preparação e gravação de uma vez (o `cli:publish`). */
export async function upsertCatalog(pkg: SolverPackage, creatorWallet: string, opts: CatalogOptions = {}): Promise<void> {
  await writeCatalog(await prepareCatalog(pkg), creatorWallet, opts);
}

/** Entra na vitrine, a não ser que a nota continue abaixo do mínimo (o job tiraria de novo). Só depois do catálogo completo. */
export async function relist(agentId: string, exec: Pick<typeof db, "update"> = db): Promise<void> {
  await exec
    .update(schema.agents)
    .set({ listed: sql`not (${schema.agents.ratingCount} >= ${DELIST_MIN_REVIEWS} and ${schema.agents.ratingSum}::float / nullif(${schema.agents.ratingCount}, 0) < ${DELIST_MAX_RATING})` })
    .where(eq(schema.agents.id, agentId));
}

import { and, eq, inArray, notInArray, or, ne, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { RESERVED_SLUGS } from "@solvers/shared";
import { PLATFORM_AGENT_IDS } from "../runtime/platform-agents.js";
import { getPackage, reloadPackages, type SolverPackage } from "../runtime/packages.js";
import { chain } from "../chain/index.js";
import { DEFAULT_MIN_PRICE_UNITS } from "./rules.js";

// Consultas ao banco e ao catálogo em disco que o worker e a revisão compartilham: de quem é o `id`/`slug`, qual é a
// versão já publicada e se o Solver é novo (PACKAGE_SPEC.md 4.1, 13 e 14).

export type Ownership = {
  idOwner: Map<string, string>;
  slugOwner: Map<string, string>;
  /** `id` do Solver que ESTE criador já tem com o slug (agente do catálogo ou envio anterior). */
  ownAgentId?: string;
  /** Versão já publicada desse Solver, com o manifesto e a pasta quando o catálogo em disco os tem. */
  published?: { version: string; manifest?: Record<string, unknown>; dir?: string };
};

/** Marcador de dono para pacotes da plataforma (pasta agents/): nenhum criador é "platform". */
export const PLATFORM_OWNER = "platform";

/** Estados cujo slug/id continua reservado para o criador (um envio reprovado não prende o nome). */
const RELEASED_STATUSES = ["rejected_validation", "rejected"];

/**
 * Descobre quem é dono do `id` e do `slug` que o manifesto pede. `creatorId` é `creators.id` do criador logado.
 * O catálogo (agents) vence; depois os envios em andamento; por fim os pacotes em disco (plataforma, ainda sem linha no banco).
 */
export async function loadOwnership(args: { submissionId: string; creatorId: string; manifestId?: string; slug?: string }): Promise<Ownership> {
  const idOwner = new Map<string, string>();
  const slugOwner = new Map<string, string>();
  let ownAgentId: string | undefined;
  let publishedVersion: string | undefined;
  const { manifestId, slug } = args;

  const agentFilters = [manifestId ? eq(schema.agents.id, manifestId) : undefined, slug ? eq(schema.agents.slug, slug) : undefined].filter((f) => f !== undefined);
  if (agentFilters.length > 0) {
    const rows = await db.select().from(schema.agents).where(or(...agentFilters));
    for (const a of rows) {
      idOwner.set(a.id, a.creatorId);
      slugOwner.set(a.slug, a.creatorId);
      if (a.slug === slug && a.creatorId === args.creatorId) {
        ownAgentId = a.id;
        publishedVersion = a.version;
      }
    }
  }

  const subFilters = [manifestId ? eq(schema.packageSubmissions.agentId, manifestId) : undefined, slug ? eq(schema.packageSubmissions.slug, slug) : undefined].filter((f) => f !== undefined);
  if (subFilters.length > 0) {
    const subs = await db
      .select({ agentId: schema.packageSubmissions.agentId, slug: schema.packageSubmissions.slug, wallet: schema.packageSubmissions.creatorWallet })
      .from(schema.packageSubmissions)
      .where(and(or(...subFilters), ne(schema.packageSubmissions.id, args.submissionId), notInArray(schema.packageSubmissions.status, RELEASED_STATUSES)));
    const wallets = [...new Set(subs.map((s) => s.wallet))];
    const owners = wallets.length ? await db.select({ id: schema.creators.id, wallet: schema.creators.wallet }).from(schema.creators).where(inArray(schema.creators.wallet, wallets)) : [];
    const byWallet = new Map(owners.map((o) => [o.wallet, o.id]));
    for (const s of subs) {
      const owner = byWallet.get(s.wallet);
      if (!owner) continue;
      if (!idOwner.has(s.agentId)) idOwner.set(s.agentId, owner);
      if (s.slug && !slugOwner.has(s.slug)) slugOwner.set(s.slug, owner);
      if (s.slug === slug && owner === args.creatorId && !ownAgentId) ownAgentId = s.agentId;
    }
  }

  // Pacotes da plataforma em disco que ainda não têm linha no banco (ex.: não publicados) também reservam id e slug.
  for (const key of [manifestId, slug]) {
    const pkg = key ? getPackage(key) : undefined;
    if (!pkg) continue;
    if (!idOwner.has(pkg.manifest.id)) idOwner.set(pkg.manifest.id, PLATFORM_OWNER);
    if (!slugOwner.has(pkg.manifest.slug)) slugOwner.set(pkg.manifest.slug, PLATFORM_OWNER);
  }

  let published: Ownership["published"];
  if (ownAgentId) {
    const pkg = getPackage(ownAgentId);
    if (pkg) published = { version: pkg.manifest.version, manifest: pkg.manifest as unknown as Record<string, unknown>, dir: pkg.dir };
    else if (publishedVersion) published = { version: publishedVersion };
  }
  return { idOwner, slugOwner, ownAgentId, published };
}

/**
 * Colunas leves das listas (criador e fila do admin): sem o manifesto inteiro (jsonb de até 10 MB), sem `scans` nem `approved`.
 * O nome sai truncado do próprio banco e as contagens do validador são calculadas lá.
 */
export const listColumns = {
  id: schema.packageSubmissions.id,
  creatorWallet: schema.packageSubmissions.creatorWallet,
  agentId: schema.packageSubmissions.agentId,
  slug: schema.packageSubmissions.slug,
  version: schema.packageSubmissions.version,
  status: schema.packageSubmissions.status,
  sizeBytes: schema.packageSubmissions.sizeBytes,
  reviewerNotes: schema.packageSubmissions.reviewerNotes,
  error: schema.packageSubmissions.error,
  createdAt: schema.packageSubmissions.createdAt,
  updatedAt: schema.packageSubmissions.updatedAt,
  name: sql<string | null>`left(${schema.packageSubmissions.manifest}->>'name', 80)`,
  errorCount: sql<number>`case when jsonb_typeof(${schema.packageSubmissions.validation}->'errors') = 'array' then jsonb_array_length(${schema.packageSubmissions.validation}->'errors') else 0 end`,
  warningCount: sql<number>`case when jsonb_typeof(${schema.packageSubmissions.validation}->'warnings') = 'array' then jsonb_array_length(${schema.packageSubmissions.validation}->'warnings') else 0 end`,
};

/** O Solver ainda não existe no catálogo (o registro on-chain será o `register_agent`, não o `update_version`). */
export async function isNewAgent(agentId: string): Promise<boolean> {
  const [a] = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.id, agentId));
  return !a;
}

export async function newAgentSet(agentIds: string[]): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents).where(inArray(schema.agents.id, agentIds));
  const existing = new Set(rows.map((r) => r.id));
  return new Set(agentIds.filter((id) => !existing.has(id)));
}

/** Outro envio do mesmo criador, para o mesmo Solver e versão, ainda vivo (em andamento ou publicado). */
export async function duplicateVersion(args: { submissionId: string; wallet: string; agentId: string; version: string }): Promise<boolean> {
  const rows = await db
    .select({ id: schema.packageSubmissions.id })
    .from(schema.packageSubmissions)
    .where(
      and(
        eq(schema.packageSubmissions.creatorWallet, args.wallet),
        eq(schema.packageSubmissions.agentId, args.agentId),
        eq(schema.packageSubmissions.version, args.version),
        ne(schema.packageSubmissions.id, args.submissionId),
        notInArray(schema.packageSubmissions.status, [...RELEASED_STATUSES, "superseded", "withdrawn"]),
      ),
    );
  return rows.length > 0;
}

/** Estados em que outro envio já "segura" o slug e o id (aprovado, em publicação ou no ar): bloqueiam a aprovação de outro criador. */
const HOLDING_STATUSES = ["awaiting_creator_signature", "awaiting_onchain_approval", "publishing", "publish_failed", "published", "suspended", "withdrawn"];

/**
 * Conferência da aprovação (roda dentro da transação do revisor): o id e o slug da submissão ainda são do criador dela?
 * Devolve o motivo em inglês ou null. O catálogo, os Solvers da plataforma, os slugs reservados e os envios de OUTRO
 * criador já aprovados valem; envios apenas pendentes de outro criador não (o primeiro a ser aprovado leva).
 */
export async function ownershipConflict(args: { submissionId: string; wallet: string; agentId: string; slug: string }): Promise<string | null> {
  const { agentId, slug } = args;
  if (RESERVED_SLUGS.includes(slug)) return `The slug ${slug} is reserved.`;
  if (PLATFORM_AGENT_IDS.includes(agentId)) return "This Solver's id is reserved for the platform.";
  const [creator] = await db.select({ id: schema.creators.id }).from(schema.creators).where(eq(schema.creators.wallet, args.wallet));
  if (!creator) return "The creator profile for this submission no longer exists.";

  const agents = await db.select({ id: schema.agents.id, slug: schema.agents.slug, creatorId: schema.agents.creatorId }).from(schema.agents).where(or(eq(schema.agents.id, agentId), eq(schema.agents.slug, slug)));
  for (const a of agents) {
    if (a.id !== agentId) return `The slug ${slug} already belongs to another Solver in the catalog (${a.id}).`;
    // A linha mínima do indexador (agente registrado antes do catálogo) guarda a carteira como dono e o id como slug.
    if (a.creatorId !== creator.id && a.creatorId !== args.wallet) return "This Solver's id already belongs to another creator in the catalog.";
    if (a.slug !== slug && a.slug !== a.id) return `This Solver already exists in the catalog with a different slug (${a.slug}).`;
  }

  // Pacotes em disco: o da plataforma (pasta agents/) nunca é de criador.
  for (const key of [agentId, slug]) {
    const pkg = getPackage(key);
    if (pkg && (pkg.platform || pkg.source === "agents")) return "The id or slug belongs to a platform Solver.";
  }

  const holders = await db
    .select({ wallet: schema.packageSubmissions.creatorWallet })
    .from(schema.packageSubmissions)
    .where(and(ne(schema.packageSubmissions.id, args.submissionId), ne(schema.packageSubmissions.creatorWallet, args.wallet), or(eq(schema.packageSubmissions.agentId, agentId), eq(schema.packageSubmissions.slug, slug)), inArray(schema.packageSubmissions.status, HOLDING_STATUSES)))
    .limit(1);
  if (holders.length > 0) return "Another creator already has an approved version with this id or slug.";
  return null;
}

/** Pacotes em disco (plataforma + publicados), um por id, relidos do disco: o worker é outro processo e não vê as trocas da API. */
export function currentPackages(): SolverPackage[] {
  return [...new Map([...reloadPackages().values()].map((p) => [p.manifest.id, p])).values()];
}


/** `min_price` em unidades de 6 casas: o da config on-chain quando a cadeia está inicializada, nunca menor que 5 USDC. */
export async function minPriceUnits(): Promise<bigint> {
  try {
    const cfg = await chain().fetchConfig();
    const onchain = BigInt(cfg.data.minPrice);
    return onchain > DEFAULT_MIN_PRICE_UNITS ? onchain : DEFAULT_MIN_PRICE_UNITS;
  } catch {
    return DEFAULT_MIN_PRICE_UNITS;
  }
}

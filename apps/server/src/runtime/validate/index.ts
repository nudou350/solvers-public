import { localeFilePath, PACKAGE_LOCALE_LANGS, PackageLocale, RESERVED_SLUGS, THIRD_PARTY_CATEGORIES } from "@solvers/shared";
import { chunkMarkdown } from "../../knowledge/chunk.js";
import { todayInSaoPaulo } from "../../knowledge/search-rules.js";
import { VERSION_RE } from "../agent-ids.js";
import { Manifest } from "../manifest.js";
import { relativePathProblem } from "../package-paths.js";
import { CODES, type Code } from "./codes.js";
import { isIsoDate, parseFrontMatter } from "./frontmatter.js";
import { CATEGORIES, ManifestV1, type ManifestV1 as ManifestV1Type } from "./schema-v1.js";
import { hiddenCharsAt, injectionMatch, sendingUrl, sensitiveAsk, sensitiveQuestion } from "./text-scans.js";

// Validador do pacote (PACKAGE_SPEC.md 13 e Apêndice A): UMA implementação para o upload, o Criador de Solvers
// (ferramenta validate-package) e o script. Puro: recebe a lista de arquivos e uma função de leitura, nunca toca disco,
// banco ou rede. Quem chama monta a entrada (pasta, ZIP extraído em memória, JSON vindo do MCP).

export type PackageEntry = { path: string; size: number; isSymlink?: boolean };
export type PackageInput = { entries: PackageEntry[]; read: (path: string) => Uint8Array | undefined };

export type Issue = { code: Code; path: string; message: string; fix: string };

export type ValidationStats = {
  specVersion: 0 | 1;
  files: number;
  steps: number;
  cases: number;
  knowledgeFiles: number;
  knowledgeChunksEstimate: number;
  templates: number;
  tools: number;
  /** Diferenciais que o validador CONSEGUIU comprovar (independe do que o criador declarou). */
  differentiators: string[];
};

export type ValidationResult = { ok: boolean; errors: Issue[]; warnings: Issue[]; stats: ValidationStats };

export type Limits = {
  zipBytes: number;
  expandedBytes: number;
  files: number;
  fileBytes: number;
  knowledgeChunks: number;
  minEvalCases: number;
};

/** Tetos do Núcleo (PACKAGE_SPEC.md 3.2). */
export const NUCLEO_LIMITS: Limits = {
  zipBytes: 50 * 1024 * 1024,
  expandedBytes: 150 * 1024 * 1024,
  files: 2000,
  fileBytes: 10 * 1024 * 1024,
  knowledgeChunks: 10_000,
  minEvalCases: 10,
};

export type ValidateOptions = {
  /** Quem envia: terceiros passam pelas regras estritas (v1) e pelas proibições do Núcleo. Padrão: "platform". */
  origin?: "platform" | "third_party";
  /** Apelido de `origin` (contrato do fluxo de envio): `mode: "third_party"` liga as regras de terceiros. `origin` vence se vierem os dois. */
  mode?: "platform" | "third_party";
  /** Criador logado (id do perfil ou carteira); vale como `existing.creatorId` quando este faltar. */
  creatorId?: string;
  /** Padrão: "nucleo". Na Abertura entram `http`, PDF/HTML/CSV etc. */
  phase?: "nucleo" | "abertura";
  limits?: Partial<Limits>;
  now?: Date;
  /** `min_price` da config on-chain, em USDC (hoje 5). */
  minPriceUsdc?: number;
  reservedSlugs?: readonly string[];
  /**
   * O que o banco já sabe. Duas formas, que podem ser combinadas:
   * - por função: `creatorId` + `ownerOfId`/`ownerOfSlug` (devolvem o dono do id/slug);
   * - por dados: `agentId` (id do Solver do criador que está sendo atualizado; ausente na 1ª versão), `creatorWallet`,
   *   `publishedVersion` (versão já publicada: a nova precisa ser maior) e `slugs` (slugs que JÁ são de OUTROS criadores).
   */
  existing?: {
    creatorId?: string;
    ownerOfId?: (id: string) => string | undefined;
    ownerOfSlug?: (slug: string) => string | undefined;
    agentId?: string;
    creatorWallet?: string;
    publishedVersion?: string;
    slugs?: readonly string[];
  };
  /** Versão já publicada deste pacote (a nova precisa ser maior) e o manifesto dela, para o diff de mudanças que exigem MAJOR. */
  previous?: { version: string; manifest?: Record<string, unknown> };
  /** Dados do ZIP que só o extrator conhece. */
  archive?: { zipBytes?: number; expandedBytes?: number; roots?: number };
};

type ToolView = NonNullable<ManifestV1Type["tools"]>[number];
type GateView = string | { text: string; evidence: { tool: string } };
type View = {
  specVersion?: 1;
  id?: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  version: string;
  catalogOnly?: boolean;
  usesMemory?: boolean;
  requirements: { key?: string; label: string; howTo?: string }[];
  packageContents: string[];
  searchPhrases: string[];
  beforeAfter: { prompt: string; withoutSolver: string; withSolver: string }[];
  steps: { file: string; gate: GateView[] }[];
  tools: ToolView[];
  templates?: NonNullable<ManifestV1Type["templates"]>;
  onboarding?: ManifestV1Type["onboarding"];
  knowledge?: ManifestV1Type["knowledge"];
  terms?: ManifestV1Type["terms"];
  platform?: boolean;
  escalation?: ManifestV1Type["escalation"];
  differentiators?: string[];
  guarantee: { available: boolean; milestones?: { verify?: string }[] };
  pricing: { priceUsdc: number; royaltyBps: number };
  trial?: { summary: string; lockedSummary: string; available?: boolean };
  supply?: { maxLicenses: number };
  versions: { version: string; notes: string }[];
};

const NAME_MAX_BYTES = 32;
const STEP_MIN_CHARS = 400;
const STEP_MAX_CHARS = 12_000;
const MAX_GATE_ITEMS = 6;
// Títulos das seções das etapas (PACKAGE_SPEC.md 5.1): em inglês (padrão dos pacotes) ou em português (pacotes antigos);
// qualquer um dos dois vale, o corpo pode estar em qualquer idioma.
const STEP_SECTIONS: { title: string; pt: string; required: boolean }[] = [
  { title: "Goal", pt: "Objetivo", required: true },
  { title: "How to run", pt: "Como executar", required: true },
  { title: "result_summary format", pt: "Formato do result_summary", required: true },
  { title: "What to ask the user", pt: "O que perguntar ao usuário", required: false },
  { title: "Common mistakes", pt: "Erros comuns", required: false },
];
/** Variações de "saúde" que o criador pode escrever como categoria (não existe na lista; é regulada como Finanças e Jurídico). */
const HEALTH_CATEGORY = /sa[úu]de|m[ée]dic|health|terapia|nutri/i;
const LEGACY_RUNNERS = new Set(["docker:solvers-react-test", "node:a11y", "node:contrast", "node:budget"]);
const SHARED_HOSTING = [".vercel.app", ".github.io", ".workers.dev", ".netlify.app", ".pages.dev", ".herokuapp.com", ".onrender.com", ".fly.dev", ".web.app", ".firebaseapp.com"];
/** Tools globais do MCP e campos comuns: citados entre crases nas etapas, não são ferramentas do manifesto. */
const GLOBAL_NAMES = new Set([
  "list_my_solvers", "find_solver", "get_purchase_link", "activate_solver", "preflight_check", "next_step", "search_knowledge", "run_tool",
  "get_memory", "save_memory", "forget_memory", "get_template", "submit_deliverable", "escalate_to_creator",
  "session_id", "agent_id", "result_summary", "completed_step", "escrow_id", "available_tools",
]);

const extOf = (p: string) => {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
};

const semver = (v: string): [number, number, number] | null => {
  if (!VERSION_RE.test(v)) return null;
  const [a, b, c] = v.split(".").map(Number);
  return [a!, b!, c!];
};

function semverGreater(a: string, b: string): boolean {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! > y[i]!;
  return false;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, val: unknown) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : val));

/** Mensagem curta para um caminho de campo do zod. */
const dotted = (path: (string | number)[]) => path.map(String).join(".");

export function validatePackage(input: PackageInput, opts: ValidateOptions = {}): ValidationResult {
  const limits = { ...NUCLEO_LIMITS, ...opts.limits };
  const phase = opts.phase ?? "nucleo";
  const now = opts.now ?? new Date();
  const origin = opts.origin ?? opts.mode ?? "platform";
  const third = origin === "third_party";
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (level: "E" | "A", code: Code, path: string, message: string, fix: string) => (level === "E" ? errors : warnings).push({ code, path, message, fix });
  const stats: ValidationStats = { specVersion: 0, files: 0, steps: 0, cases: 0, knowledgeFiles: 0, knowledgeChunksEstimate: 0, templates: 0, tools: 0, differentiators: [] };
  const finish = (): ValidationResult => ({ ok: errors.length === 0, errors, warnings, stats });

  // ---- Envelope do ZIP (dados que só o extrator conhece)
  const ar = opts.archive;
  if (ar?.zipBytes !== undefined && ar.zipBytes > limits.zipBytes) add("E", "ZIP_TOO_LARGE", "", `The ZIP is ${ar.zipBytes} bytes, over the ${limits.zipBytes} byte limit`, "Reduce the knowledge base or split the content.");
  if (ar?.expandedBytes !== undefined && ar.expandedBytes > limits.expandedBytes) add("E", "ZIP_EXPANDS_TOO_MUCH", "", `The extracted content is ${ar.expandedBytes} bytes, over the ${limits.expandedBytes} byte limit`, "Reduce the size of the files.");
  if (ar?.roots !== undefined && ar.roots !== 1) add("E", "ZIP_BAD_ROOT", "", `The ZIP must have exactly 1 root folder (found ${ar.roots})`, "Put everything inside a single folder that contains manifest.json.");

  // ---- Arquivos: caminhos, duplicatas, links, tipos, tamanhos
  const files = new Map<string, PackageEntry>();
  const seen = new Map<string, string>();
  const sorted = [...input.entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    const base = e.path.slice(e.path.lastIndexOf("/") + 1);
    if (e.path.startsWith("__MACOSX/") || base === ".DS_Store" || base === "Thumbs.db") {
      add("A", "ZIP_IGNORED_FILE", e.path, "System file removed from the extraction", "Nothing to do; avoid compressing with Finder without cleaning up first.");
      continue;
    }
    if (e.isSymlink) {
      add("E", "ZIP_SYMLINK", e.path, "Symbolic links are not allowed", "Replace the link with the real file.");
      continue;
    }
    const nfc = e.path.normalize("NFC");
    const segs = e.path.split("/");
    const badChars = !/^[\p{L}\p{N}._\-/ ]+$/u.test(e.path);
    const why = relativePathProblem(e.path, [""]) ?? (nfc !== e.path ? "is not NFC-normalized" : segs.some((s) => s.startsWith(".")) ? "name starts with a dot" : badChars ? "contains a character other than letters, digits, . _ - and space" : null);
    if (why) {
      add("E", "ZIP_BAD_PATH", e.path, `Invalid path: ${why}`, "Rename the file using letters, digits, hyphens, underscores and dots.");
      continue;
    }
    const key = nfc.toLowerCase();
    if (seen.has(key)) {
      add("E", "ZIP_DUPLICATE_ENTRY", e.path, `Duplicates the file ${seen.get(key)} (NFC, case-insensitive)`, "Keep only one version of the file.");
      continue;
    }
    seen.set(key, e.path);
    files.set(e.path, e);
  }
  stats.files = files.size;
  if (files.size > limits.files) add("E", "ZIP_TOO_MANY_FILES", "", `${files.size} files exceed the limit of ${limits.files}`, "Merge small knowledge files.");

  const textCache = new Map<string, string | null>();
  const readText = (path: string): string | null => {
    if (textCache.has(path)) return textCache.get(path)!;
    const bytes = input.read(path);
    let out: string | null = null;
    if (bytes) {
      try {
        out = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        add("E", "FILE_NOT_UTF8", path, "The file is not valid UTF-8", "Save the file as UTF-8.");
      }
    }
    textCache.set(path, out);
    return out;
  };

  const allowedIn = (folder: string, ext: string): boolean => {
    if (!third) return true;
    const open = phase === "abertura";
    switch (folder) {
      case "steps":
        return ext === ".md";
      case "knowledge":
        return [".md", ".txt", ".json"].includes(ext) || (open && [".html", ".csv", ".pdf"].includes(ext));
      case "templates":
        return [".md", ".txt", ".json"].includes(ext) || (open && [".csv", ".png", ".jpg", ".jpeg", ".pdf"].includes(ext));
      case "evals":
        return [".json", ".md"].includes(ext);
      case "locales":
        return ext === ".json";
      default:
        return false;
    }
  };

  for (const [path, e] of files) {
    if (e.size > limits.fileBytes) add("E", "FILE_TOO_LARGE", path, `File of ${e.size} bytes exceeds the limit of ${limits.fileBytes}`, "Split the file into smaller parts.");
    if (path === "manifest.json" || path === "README.md") continue;
    const folder = path.split("/")[0]!;
    if (folder === "verifier") {
      if (third) add("E", "MANIFEST_PLATFORM_FORBIDDEN", path, "The verifier/ folder is for platform packages only", "Remove the verifier/ folder.");
      continue;
    }
    if (folder === "locales") {
      // Só `locales/<idioma>.json` dos idiomas aceitos (hoje pt): qualquer outro arquivo ali nunca seria lido.
      if (!PACKAGE_LOCALE_LANGS.some((l) => path === localeFilePath(l))) {
        add("E", "FILE_TYPE_NOT_ALLOWED", path, `Only these files are allowed in locales/: ${PACKAGE_LOCALE_LANGS.map(localeFilePath).join(", ")}`, "Rename it to locales/pt.json or remove the file.");
      }
      continue;
    }
    if (third && !allowedIn(folder, extOf(path)) && !(folder === "knowledge" && path.endsWith(".meta.json"))) {
      add("E", "FILE_TYPE_NOT_ALLOWED", path, `File type not allowed in ${folder}/ at this stage (${extOf(path) || "no extension"})`, "Convert it to .md or .txt (PDF, HTML and CSV are only accepted at the Open stage).");
    }
  }

  // ---- Manifesto
  if (!files.has("manifest.json")) {
    add("E", "MANIFEST_MISSING", "manifest.json", "manifest.json is missing from the package root", "Create manifest.json (see the skeleton in the Solver Creator).");
    return finish();
  }
  const manifestText = readText("manifest.json");
  if (manifestText === null) return finish();
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch (e) {
    add("E", "MANIFEST_INVALID_JSON", "manifest.json", `Invalid JSON: ${(e as Error).message}`, "Fix the JSON syntax.");
    return finish();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    add("E", "MANIFEST_SCHEMA", "manifest.json", "The manifest must be a JSON object", "Use { ... } at the root.");
    return finish();
  }
  const rawObj = raw as Record<string, unknown>;
  const strict = rawObj.specVersion === 1 || third;
  if (third && rawObj.specVersion !== 1) {
    add("E", "MANIFEST_SPEC_VERSION", "manifest.json#specVersion", "Third-party submissions need \"specVersion\": 1", "Add \"specVersion\": 1 to the manifest.");
    rawObj.specVersion = 1;
  }
  // Nome e limites de tamanho do v1 viram erros com código próprio; o schema cuida do resto.
  const schemaIssues = (issues: { code: string; path: (string | number)[]; message: string; keys?: string[] }[]) => {
    for (const i of issues) {
      const path = `manifest.json#${dotted(i.path)}`;
      if (i.code === "unrecognized_keys") {
        for (const k of i.keys ?? []) add("E", "MANIFEST_UNKNOWN_FIELD", `manifest.json#${[...i.path, k].join(".")}`, `Unknown field: ${k}`, "Remove the field or use a field from the specification.");
      } else if (/formato de um id|format of an id/i.test(i.message)) add("E", "MANIFEST_SLUG_LOOKS_LIKE_ID", path, i.message, "Pick a slug made of words (e.g. my-solver).");
      else if (/16 bytes/.test(i.message)) add("E", "MANIFEST_VERSION_TOO_LONG", path, i.message, "Use a short version such as 1.0.0.");
      else if (i.path[0] === "trial" && i.path[1] === "steps") add("E", "TRIAL_STEPS_EXCEED", path, i.message, "Reduce trial.steps to the number of steps.");
      else if (i.path[0] === "trial" && i.path[1] === "tools") add("E", "TRIAL_TOOL_UNKNOWN", path, i.message, "Use only names that exist in tools.");
      else if (i.path[0] === "trial" && i.path[1] === "templates") add("E", "TRIAL_TEMPLATE_UNKNOWN", path, i.message, "Use only names that exist in templates.");
      else add("E", "MANIFEST_SCHEMA", path, i.message, "Fix the field according to the manifest schema.");
    }
  };
  const parsed = strict ? ManifestV1.safeParse(rawObj) : Manifest.safeParse(rawObj);
  if (!parsed.success) {
    schemaIssues(parsed.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.code === "unrecognized_keys" ? (i as { keys: string[] }).keys : undefined })));
    return finish();
  }
  const m = parsed.data as unknown as View;
  stats.specVersion = strict ? 1 : 0;
  const L = (level: "E" | "A"): "E" | "A" => (strict ? level : "A");
  const mp = (field: string) => `manifest.json#${field}`;

  // ---- Identidade, formato e limites do manifesto
  if (Buffer.byteLength(m.name) > NAME_MAX_BYTES) add(L("E"), "MANIFEST_NAME_TOO_LONG", mp("name"), `The name is longer than ${NAME_MAX_BYTES} bytes (on-chain limit)`, "Shorten the name.");
  if (strict) {
    if (Buffer.byteLength(m.name) < 3) add("E", "MANIFEST_SCHEMA", mp("name"), "The name must be at least 3 characters long", "Write a name.");
    if (m.tagline.length < 10 || m.tagline.length > 100) add("E", "MANIFEST_SCHEMA", mp("tagline"), `The tagline must be 10 to 100 characters long (it has ${m.tagline.length})`, "Rewrite it as a single value statement.");
    if (m.description.length < 120 || m.description.length > 2000) add("E", "MANIFEST_SCHEMA", mp("description"), `The description must be 120 to 2,000 characters long (it has ${m.description.length})`, "Explain what it delivers, for whom, and what it does not do.");
    // Saúde não está na lista: para terceiros no Núcleo vira MANIFEST_CATEGORY_FORBIDDEN (abaixo), não "categoria desconhecida".
    if (!(CATEGORIES as readonly string[]).includes(m.category) && !(third && phase === "nucleo" && HEALTH_CATEGORY.test(m.category))) add("E", "MANIFEST_SCHEMA", mp("category"), `Unknown category: ${m.category}`, `Use one of: ${CATEGORIES.join(", ")}.`);
    if (m.pricing.royaltyBps < 0 || m.pricing.royaltyBps > 1000) add("E", "MANIFEST_SCHEMA", mp("pricing.royaltyBps"), "royaltyBps must be between 0 and 1000", "Adjust the royalty.");
    if (m.packageContents.length < 3 || m.packageContents.length > 8) add("E", "MANIFEST_SCHEMA", mp("packageContents"), "packageContents must have 3 to 8 items", "List 3 to 8 things the package delivers.");
  }
  if (third) {
    if (m.platform === true) add("E", "MANIFEST_PLATFORM_FORBIDDEN", mp("platform"), "Only platform packages can use platform: true", "Remove the platform field.");
    // Fora de THIRD_PARTY_CATEGORIES (Finanças, Jurídico, saúde) é proibido no Núcleo; categoria desconhecida e não regulada cai em MANIFEST_SCHEMA.
    if (phase === "nucleo" && !THIRD_PARTY_CATEGORIES.includes(m.category) && ((CATEGORIES as readonly string[]).includes(m.category) || HEALTH_CATEGORY.test(m.category))) {
      add("E", "MANIFEST_CATEGORY_FORBIDDEN", mp("category"), `The category ${m.category} is not accepted from third parties at this stage`, `Use another category (${THIRD_PARTY_CATEGORIES.join(", ")}); regulated content waits for legal review.`);
    }
    if (phase === "nucleo" && m.guarantee?.available === true) {
      add("E", "MANIFEST_GUARANTEE_FORBIDDEN", mp("guarantee.available"), "Third parties cannot offer a guarantee yet", "Use guarantee: { available: false, defaultCriteria: [] }.");
    }
  }
  if (opts.minPriceUsdc !== undefined && m.pricing.priceUsdc < opts.minPriceUsdc) {
    add(third || strict ? "E" : "A", "MANIFEST_PRICE_BELOW_MIN", mp("pricing.priceUsdc"), `The price (${m.pricing.priceUsdc} USDC) is below the minimum (${opts.minPriceUsdc} USDC)`, `Use ${opts.minPriceUsdc} USDC or more.`);
  }
  if (!m.versions.some((v) => v.version === m.version)) {
    add(L("E"), "MANIFEST_VERSIONS_MISSING", mp("versions"), `There is no versions[] entry for version ${m.version}`, "Add { version, releasedAt, notes } for the current version.");
  }
  if (strict && m.supply && m.trial && m.trial.available !== false) {
    add("A", "SUPPLY_WITH_TRIAL", mp("supply"), "The product has a license cap and the free trial is on: the trial does not use up a slot and is per wallet", "For real exclusivity turn the trial off (trial.available: false); otherwise keep it and tell the reviewer.");
  }
  if (m.catalogOnly !== undefined) add("A", "CATALOG_ONLY_IGNORED", mp("catalogOnly"), "catalogOnly has no effect on the server", "Remove the field.");
  if (strict && !(m.terms?.rightsConfirmed === true && m.terms.sourcesListed === true)) {
    add("E", "TERMS_MISSING", mp("terms"), "Confirm the rights and the source list in terms", 'Use "terms": { "rightsConfirmed": true, "sourcesListed": true }.');
  } else if (!strict) {
    add("A", "TERMS_MISSING", mp("terms"), "v0 package without terms", "Add terms when migrating to specVersion 1.");
  }
  // Terceiros nunca usam os slugs reservados (marcas e plataforma); quem passa `reservedSlugs` troca a lista.
  const reserved = opts.reservedSlugs ?? (third ? RESERVED_SLUGS : []);
  if (reserved.includes(m.slug)) add("E", "MANIFEST_SLUG_RESERVED", mp("slug"), `The slug ${m.slug} is reserved`, "Choose another slug.");
  const ex = opts.existing;
  if (ex) {
    const me = ex.creatorId ?? opts.creatorId ?? ex.creatorWallet;
    const idOwner = m.id ? ex.ownerOfId?.(m.id) : undefined;
    const slugOwner = ex.ownerOfSlug?.(m.slug);
    if (idOwner !== undefined && idOwner !== me) add("E", "MANIFEST_ID_OWNER", mp("id"), "This id already belongs to another creator", "Remove the id (the server assigns a new one) or use the id of one of your own packages.");
    if ((slugOwner !== undefined && slugOwner !== me) || ex.slugs?.includes(m.slug)) add("E", "MANIFEST_ID_OWNER", mp("slug"), "This slug already belongs to another creator", "Choose another slug.");
    // Por dados: o `id` do manifesto precisa ser o do Solver que este criador está atualizando; na 1ª versão ele não existe.
    const byData = ex.agentId !== undefined || ex.publishedVersion !== undefined || ex.slugs !== undefined || ex.creatorWallet !== undefined;
    if (m.id && byData) {
      if (ex.agentId !== undefined && m.id !== ex.agentId) add("E", "MANIFEST_ID_OWNER", mp("id"), "This id is not your Solver's id", "Use the id of the Solver you are updating.");
      else if (ex.agentId === undefined && ex.publishedVersion === undefined) add("E", "MANIFEST_ID_OWNER", mp("id"), "This id does not belong to you (on the first version the server assigns the id)", "Remove the id field from the manifest.");
    }
  }
  const prev = opts.previous ?? (ex?.publishedVersion ? { version: ex.publishedVersion } : undefined);
  if (prev) {
    if (!semverGreater(m.version, prev.version)) {
      add("E", "MANIFEST_VERSION_NOT_GREATER", mp("version"), `Version ${m.version} is not greater than the published one (${prev.version})`, "Bump the version (MAJOR.MINOR.PATCH).");
    }
    const a = semver(m.version);
    const b = semver(prev.version);
    const pm = prev.manifest;
    if (pm && a && b && a[0] <= b[0]) {
      const changed: string[] = [];
      if (stable(pm.tools ?? []) !== stable(m.tools)) changed.push("tools");
      if (stable(pm.onboarding ?? null) !== stable(m.onboarding ?? null)) changed.push("onboarding");
      if (stable(pm.requirements ?? []) !== stable(m.requirements)) changed.push("requirements");
      const prevSteps = Array.isArray(pm.steps) ? (pm.steps as { file?: string }[]).map((s) => s.file) : [];
      if (stable(prevSteps) !== stable(m.steps.map((s) => s.file))) changed.push("steps");
      if (changed.length) add("E", "DIFF_ENDPOINT_CHANGED_MINOR", mp(changed[0]!), `${changed.join(", ")} changed without bumping the MAJOR version`, "Bump the MAJOR version (e.g. 1.4.2 to 2.0.0) for changes to these fields.");
    }
  }

  // ---- Varreduras no texto do manifesto que chega ao modelo (PACKAGE_SPEC.md 5.1)
  const manifestTexts: [string, string][] = [
    [mp("tagline"), m.tagline],
    [mp("description"), m.description],
    ...m.requirements.flatMap((r, i): [string, string][] => (r.howTo ? [[mp(`requirements.${i}.howTo`), r.howTo]] : [])),
    ...m.packageContents.map((t, i): [string, string] => [mp(`packageContents.${i}`), t]),
    ...m.searchPhrases.map((t, i): [string, string] => [mp(`searchPhrases.${i}`), t]),
    ...m.beforeAfter.flatMap((b, i): [string, string][] => [[mp(`beforeAfter.${i}.withSolver`), b.withSolver], [mp(`beforeAfter.${i}.prompt`), b.prompt]]),
    ...m.tools.map((t, i): [string, string] => [mp(`tools.${i}.description`), t.description]),
    ...(m.trial ? ([[mp("trial.summary"), m.trial.summary], [mp("trial.lockedSummary"), m.trial.lockedSummary]] as [string, string][]) : []),
    ...(m.onboarding?.questions ?? []).flatMap((q, i): [string, string][] => [[mp(`onboarding.questions.${i}.ask`), q.ask], [mp(`onboarding.questions.${i}.why`), q.why]]),
  ];
  const scanText = (path: string, text: string, kind: "manifest" | "step" | "knowledge" | "template") => {
    const hidden = hiddenCharsAt(text);
    if (hidden) add("A", "TEXT_HIDDEN_CHARS", path, `Invisible or direction-control character ${hidden.codePoint} at position ${hidden.index}`, "Remove the character (it can hide instructions from the reviewer).");
    const inj = injectionMatch(text);
    if (inj) add("A", "STEP_INJECTION_PATTERN", path, `Text that looks like instruction injection: "${inj}"`, "Rewrite it without telling the AI to ignore rules or hide things from the user.");
    if (kind === "step") {
      const ask = sensitiveAsk(text);
      if (ask) add("A", "STEP_SENSITIVE_ASK", path, `Asks the user for sensitive data: "${ask}"`, "Do not ask for passwords, national IDs, cards or credentials.");
      const url = sendingUrl(text);
      if (url) add("A", "STEP_EXTERNAL_URL", path, `Data-sending URL: ${url}`, "Do not tell the AI to send user data to external addresses.");
    }
  };
  for (const [p, t] of manifestTexts) scanText(p, t, "manifest");

  // ---- Traduções do catálogo (locales/pt.json): opcional; só texto de vitrine, validado e varrido como o do manifesto
  for (const lang of PACKAGE_LOCALE_LANGS) {
    const lp = localeFilePath(lang);
    if (!files.has(lp)) continue;
    const locText = readText(lp);
    if (locText === null) continue;
    let locRaw: unknown;
    try {
      locRaw = JSON.parse(locText);
    } catch (e) {
      add("E", "MANIFEST_INVALID_JSON", lp, `Invalid JSON: ${(e as Error).message}`, "Fix the JSON syntax.");
      continue;
    }
    const lparsed = PackageLocale.safeParse(locRaw);
    if (!lparsed.success) {
      for (const i of lparsed.error.issues) {
        if (i.code === "unrecognized_keys") {
          for (const k of i.keys) add("E", "MANIFEST_UNKNOWN_FIELD", `${lp}#${[...i.path, k].join(".")}`, `Unknown field: ${k}`, "Remove the field or use a translation field (name, tagline, description, packageContents, requirements, searchPhrases, creatorBio).");
        } else add("E", "MANIFEST_SCHEMA", `${lp}#${dotted(i.path)}`, i.message, "Fix the field according to the locales/<language>.json schema.");
      }
      continue;
    }
    const loc = lparsed.data;
    const known = new Set(m.requirements.flatMap((r) => (r.key ? [r.key] : [])));
    const seenKeys = new Set<string>();
    for (const [i, r] of loc.requirements.entries()) {
      if (!known.has(r.key)) add("E", "MANIFEST_SCHEMA", `${lp}#requirements.${i}.key`, `The key "${r.key}" does not exist in the manifest's requirements`, "Use the same key as the requirement being translated.");
      else if (seenKeys.has(r.key)) add("E", "MANIFEST_SCHEMA", `${lp}#requirements.${i}.key`, `The key "${r.key}" is repeated`, "Translate each requirement only once.");
      seenKeys.add(r.key);
    }
    const locTexts: [string, string][] = [
      [`${lp}#name`, loc.name],
      [`${lp}#tagline`, loc.tagline],
      [`${lp}#description`, loc.description],
      ...loc.packageContents.map((t, i): [string, string] => [`${lp}#packageContents.${i}`, t]),
      ...loc.requirements.map((r, i): [string, string] => [`${lp}#requirements.${i}.label`, r.label]),
      ...(loc.searchPhrases ?? []).map((t, i): [string, string] => [`${lp}#searchPhrases.${i}`, t]),
      ...(loc.creatorBio ? ([[`${lp}#creatorBio`, loc.creatorBio]] as [string, string][]) : []),
    ];
    for (const [p, t] of locTexts) scanText(p, t, "manifest");
  }

  // ---- Ferramentas
  const toolNames = new Set(m.tools.map((t) => t.name));
  stats.tools = m.tools.length;
  for (const [i, t] of m.tools.entries()) {
    const tp = mp(`tools.${i}`);
    const builtin = t.runner.startsWith("builtin:") || LEGACY_RUNNERS.has(t.runner);
    const remote = t.runner === "http" || t.runner === "mcp";
    if (third) {
      if (builtin || (phase === "nucleo" && remote) || !(builtin || remote)) {
        add("E", "TOOL_FORBIDDEN_RUNNER", `${tp}.runner`, `The runner "${t.runner}" is not allowed for third parties at this stage`, phase === "nucleo" ? "Third-party packages cannot have tools yet: remove tools." : "Use the http runner.");
        continue;
      }
    }
    if (!t.inputSchema) add(L("E"), "TOOL_SCHEMA_MISSING", `${tp}.inputSchema`, "The tool does not declare an inputSchema", "Describe the input with a JSON Schema.");
    for (const key of ["inputSchema", "outputSchema"] as const) {
      const schema = t[key];
      if (schema) {
        const why = schemaUnsafe(schema);
        if (why) add("E", "TOOL_SCHEMA_UNSAFE", `${tp}.${key}`, why, "Use a simple schema, without remote $ref or pattern.");
      }
    }
    if (remote) {
      if (t.egress !== true) add("E", "TOOL_EGRESS_MISSING", `${tp}.egress`, "A tool that sends data to a creator-run service needs egress: true", "Add egress: true.");
      const host = t.runner === "http" && t.http ? httpHostProblem(t.http) : t.runner === "http" ? "the http block is missing" : null;
      if (host) add("E", "TOOL_HTTP_HOST", `${tp}.http`, host, "Use https, port 443 and your own domain, and list it in allowedHosts.");
    }
  }

  // ---- Etapas
  stats.steps = m.steps.length;
  const stepTexts: string[] = [];
  for (const [i, s] of m.steps.entries()) {
    const sp = mp(`steps.${i}.file`);
    const why = relativePathProblem(s.file, ["steps/"]);
    if (why) {
      add("E", "MANIFEST_PATH_ESCAPE", sp, `Path "${s.file}" is invalid: ${why}`, "Use a path like steps/01-name.md.");
      continue;
    }
    if (!files.has(s.file)) {
      add("E", "STEP_FILE_MISSING", sp, `Step ${i + 1} points to ${s.file}, which does not exist in the package`, "Create the file or fix the path.");
      continue;
    }
    const text = readText(s.file);
    if (text === null) continue;
    stepTexts.push(text);
    if (text.length < STEP_MIN_CHARS || text.length > STEP_MAX_CHARS) {
      add(L("E"), "STEP_TOO_SHORT_LONG", s.file, `The step has ${text.length} characters (it must have ${STEP_MIN_CHARS} to ${STEP_MAX_CHARS})`, "Add more detail to the step or split it in two.");
    }
    for (const sec of STEP_SECTIONS) {
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const has = new RegExp(`^##\\s+(${esc(sec.title)}|${esc(sec.pt)})\\s*$`, "im").test(text);
      if (!has) add(sec.required ? L("E") : "A", "STEP_SECTION_MISSING", s.file, `Missing the "## ${sec.title}" section (the Portuguese title "## ${sec.pt}" is also accepted)`, `Add a "## ${sec.title}" section.`);
    }
    scanText(s.file, text, "step");
    // Referências a ferramentas: nomes snake_case entre crases em linhas que falam de ferramenta.
    for (const line of text.split("\n")) {
      if (!/run_tool|ferramenta/i.test(line)) continue;
      for (const match of line.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g)) {
        const name = match[1]!;
        if (!toolNames.has(name) && !GLOBAL_NAMES.has(name)) add("A", "STEP_REFERENCE_UNKNOWN", s.file, `Mentions the tool ${name}, which does not exist in tools`, "Declare the tool in tools or fix the name.");
      }
    }
    if (s.gate.length > MAX_GATE_ITEMS) add(L("E"), "GATE_TOO_MANY", mp(`steps.${i}.gate`), `The gate has ${s.gate.length} items (maximum ${MAX_GATE_ITEMS})`, "Shorten the checklist.");
    for (const [gi, g] of s.gate.entries()) {
      if (typeof g !== "string" && !toolNames.has(g.evidence.tool)) {
        add("E", "GATE_EVIDENCE_UNKNOWN_TOOL", mp(`steps.${i}.gate.${gi}.evidence.tool`), `The evidence uses the tool ${g.evidence.tool}, which does not exist in tools`, "Use the name of a declared tool.");
      }
    }
  }

  // ---- Templates
  const declared = m.templates ?? [];
  const templateFiles = [...files.keys()].filter((p) => p.startsWith("templates/"));
  stats.templates = templateFiles.length;
  for (const t of declared) {
    const tp = t.path;
    const why = relativePathProblem(tp, ["templates/"]);
    if (why) add("E", "MANIFEST_PATH_ESCAPE", mp(`templates.${t.name}.path`), `Path "${tp}" is invalid: ${why}`, "Use a path like templates/template.md.");
    else if (!files.has(tp)) add("E", "TEMPLATE_MISSING", mp(`templates.${t.name}.path`), `The template ${t.name} points to ${tp}, which does not exist`, "Create the file or fix the path.");
  }
  for (const p of templateFiles) {
    if (third && !allowedIn("templates", extOf(p))) add("E", "TEMPLATE_TYPE_FORBIDDEN", p, `The type ${extOf(p)} is not allowed in templates at this stage`, "Use .md, .txt or .json.");
    if (!declared.some((t) => t.path === p)) add("A", "TEMPLATE_UNDECLARED", p, "File in templates/ that is not declared in templates[] (it will not be delivered)", "Declare it in templates[] or remove it.");
    if ([".md", ".txt", ".json"].includes(extOf(p))) {
      const text = readText(p);
      if (text) scanText(p, text, "template");
    }
  }
  if (phase === "abertura" && third) {
    for (const p of templateFiles) if ([".svg", ".html", ".htm", ".js"].includes(extOf(p))) add("E", "TEMPLATE_TYPE_FORBIDDEN", p, `The type ${extOf(p)} is blocked in templates`, "Use .md, .txt or .json.");
  }

  // ---- Conhecimento
  let expired = 0;
  let withDate = 0;
  let mdLike = 0;
  for (const [p] of files) {
    if (!p.startsWith("knowledge/") || p.endsWith(".meta.json")) continue;
    const ext = extOf(p);
    if (ext !== ".md" && ext !== ".txt") continue;
    const text = readText(p);
    if (text === null) continue;
    mdLike += 1;
    stats.knowledgeFiles += 1;
    let body = text;
    if (ext === ".md") {
      const fm = parseFrontMatter(text);
      body = fm.body;
      if (fm.kind === "invalid") add("E", "KNOWLEDGE_FRONTMATTER_INVALID", p, `Invalid front-matter: ${fm.error}`, "Use a --- block with 'key: value' lines.");
      else if (fm.kind === "ok") {
        for (const key of ["source_date", "valid_until"] as const) {
          const v = fm.data[key];
          if (v !== undefined && (typeof v !== "string" || !isIsoDate(v))) add("E", "KNOWLEDGE_DATE_INVALID", p, `${key} must be a valid YYYY-MM-DD date`, "Write the date as 2026-09-30.");
        }
        const sd = fm.data.source_date;
        if (typeof sd === "string" && isIsoDate(sd)) {
          withDate += 1;
        }
        const vu = fm.data.valid_until;
        if (typeof vu === "string" && isIsoDate(vu) && vu < todayInSaoPaulo(now)) {
          expired += 1;
          add("A", "KNOWLEDGE_EXPIRED", p, `The content expired on ${vu}`, "Update the file or remove it.");
        }
        if (strict && typeof fm.data.source !== "string") add("E", "KNOWLEDGE_SOURCE_MISSING", p, "'source' is missing from the front-matter", "Provide the source (e.g. source: World Bank).");
      } else if (strict) {
        add("E", "KNOWLEDGE_SOURCE_MISSING", p, "No front-matter: the content source is missing", "Add a --- block with source and source_date.");
      }
    } else if (strict && !files.has(`${p}.meta.json`)) {
      add("E", "KNOWLEDGE_SOURCE_MISSING", p, "A .txt file without a name.txt.meta.json holding the source", "Create the .meta.json file with source and source_date.");
    }
    stats.knowledgeChunksEstimate += chunkMarkdown(body).length;
    scanText(p, text, "knowledge");
  }
  if (stats.knowledgeChunksEstimate > limits.knowledgeChunks) {
    add("E", "KNOWLEDGE_TOO_BIG", "knowledge/", `The knowledge base produces ${stats.knowledgeChunksEstimate} chunks (limit ${limits.knowledgeChunks})`, "Reduce the content or prioritize the essentials.");
  }
  if (strict && m.knowledge && !isIsoDate(m.knowledge.updatedAt)) add("E", "KNOWLEDGE_DATE_INVALID", mp("knowledge.updatedAt"), "updatedAt must be a valid YYYY-MM-DD date", "Write the date as 2026-09-30.");

  // ---- Onboarding
  if (m.onboarding) {
    if (m.usesMemory !== true) add("E", "ONBOARDING_NEEDS_MEMORY", mp("usesMemory"), "onboarding requires usesMemory: true (the profile is kept in memory)", 'Add "usesMemory": true.');
    for (const [i, q] of m.onboarding.questions.entries()) {
      if (sensitiveQuestion(`${q.ask} ${q.why} ${(q.options ?? []).join(" ")}`)) add("A", "ONBOARDING_SENSITIVE", mp(`onboarding.questions.${i}`), "The question seems to ask for sensitive data", "Do not ask for passwords, documents or credentials during calibration.");
    }
  }

  // ---- Evals
  const caseFiles = [...files.keys()].filter((p) => /^evals\/cases\/[^/]+\.json$/.test(p));
  stats.cases = caseFiles.length;
  const caseIds = new Set<string>();
  for (const p of caseFiles) {
    const text = readText(p);
    if (text === null) continue;
    const why = evalCaseProblem(text, caseIds);
    if (why) add("E", "EVAL_CASE_INVALID", p, why, "Use { id, input, checks: [{ type, value, description }] }.");
  }
  if (caseFiles.length < limits.minEvalCases) add(L("E"), "EVAL_TOO_FEW_CASES", "evals/cases/", `There are ${caseFiles.length} test cases (minimum ${limits.minEvalCases})`, "Write more cases covering typical requests.");

  // ---- Diferenciais
  const joined = stepTexts.join("\n");
  const proven: string[] = [];
  if (m.tools.length >= 1 && m.tools.every((t) => joined.includes(t.name))) proven.push("tool");
  if (origin === "platform" && m.guarantee?.available && (m.guarantee.milestones ?? []).some((x) => (x.verify ?? "tests") === "tests")) proven.push("verifier");
  const k = m.knowledge;
  const fresh = k && isIsoDate(k.updatedAt) ? now.getTime() - new Date(`${k.updatedAt}T00:00:00Z`).getTime() <= k.reviewEveryDays * 86_400_000 : false;
  if ((mdLike > 0 && expired === 0 && withDate / mdLike >= 0.5 && fresh) || m.tools.some((t) => t.runner === "http")) proven.push("liveData");
  if (m.onboarding && /perfil|profile/i.test(joined)) proven.push("memory");
  if (m.escalation?.enabled === true) proven.push("escalation");
  stats.differentiators = proven;
  const declaredDiffs = m.differentiators ?? [];
  for (const d of declaredDiffs) {
    if (!proven.includes(d)) add("A", "MANIFEST_DIFFERENTIATOR_UNPROVEN", mp("differentiators"), `The differentiator "${d}" is not proven by the package`, diffHint(d));
  }
  if (strict && proven.length < 2) add("A", "MANIFEST_DIFFERENTIATORS_FEW", mp("differentiators"), `Only ${proven.length} differentiator(s) proven; the criterion is at least 2`, "Add dated knowledge, calibration, creator support or a tool.");

  // ---- packageContents x realidade
  const pc = m.packageContents.join(" ").toLowerCase();
  const mismatch = (cond: boolean, what: string) => cond && add("A", "CONTENTS_MISMATCH", mp("packageContents"), `packageContents mentions ${what}, but the package has none`, "Adjust the list to what the package really delivers.");
  mismatch(/template|modelo/.test(pc) && declared.length === 0 && templateFiles.length === 0, "templates");
  mismatch(/ferramenta|\btools?\b/.test(pc) && m.tools.length === 0, "tools");
  mismatch(/garantia|guarantee/.test(pc) && !m.guarantee?.available, "a guarantee");
  // usesMemory ausente é deduzido das etapas (como o carregador faz).
  const usesMemory = m.usesMemory ?? /(save_memory|get_memory)/.test(joined);
  mismatch(/mem(ó|o)ria|calibra|memory/.test(pc) && !usesMemory && !m.onboarding, "memory");
  mismatch(/base|conhecimento|fontes?\b|knowledge|sources?\b/.test(pc) && stats.knowledgeFiles === 0, "a knowledge base");

  return finish();
}

function diffHint(d: string): string {
  switch (d) {
    case "liveData":
      return "Keep knowledge.updatedAt within reviewEveryDays, with no expired files, and put source_date on at least half of the files.";
    case "memory":
      return "Declare onboarding and make at least one step use the user's profile.";
    case "escalation":
      return "Turn on escalation.enabled and link Telegram in the creator profile.";
    case "tool":
      return "Declare tools in tools and use them in the steps.";
    default:
      return "Declare the test-based guarantee (platform packages only).";
  }
}

/** JSON Schema do criador roda no servidor: sem $ref remoto, sem pattern (ReDoS), profundidade e tamanho limitados. */
function schemaUnsafe(schema: unknown): string | null {
  const size = JSON.stringify(schema).length;
  if (size > 20_000) return `The schema has ${size} characters (maximum 20,000)`;
  let problem: string | null = null;
  const walk = (node: unknown, depth: number) => {
    if (problem) return;
    if (depth > 6) {
      problem = "The schema is deeper than 6 levels";
      return;
    }
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "$ref" && !(typeof value === "string" && value.startsWith("#"))) problem = "The schema uses a remote $ref";
        else if (key === "pattern" || key === "patternProperties") problem = `The schema uses ${key} (risk of a slow regular expression)`;
        else walk(value, depth + 1);
        if (problem) return;
      }
    }
  };
  walk(schema, 0);
  return problem;
}

function httpHostProblem(http: NonNullable<ToolView["http"]>): string | null {
  let url: URL;
  try {
    url = new URL(http.url);
  } catch {
    return `Invalid URL: ${http.url}`;
  }
  if (url.protocol !== "https:") return "Only https is allowed";
  if (url.port && url.port !== "443") return "Only port 443 is allowed";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "IP addresses and localhost are not allowed";
  if (!http.allowedHosts.map((h) => h.toLowerCase()).includes(host)) return `The host ${host} is not in allowedHosts`;
  if (SHARED_HOSTING.some((s) => host.endsWith(s))) return `A shared-hosting domain (${host}) does not prove control`;
  return null;
}

function evalCaseProblem(text: string, seen: Set<string>): string | null {
  let c: unknown;
  try {
    c = JSON.parse(text);
  } catch {
    return "invalid JSON";
  }
  if (!c || typeof c !== "object") return "the case must be an object";
  const o = c as { id?: unknown; input?: unknown; checks?: unknown };
  if (typeof o.id !== "string" || !o.id) return "id is missing";
  if (seen.has(o.id)) return `duplicate id: ${o.id}`;
  seen.add(o.id);
  if (typeof o.input !== "string" || o.input.length < 3) return "input is missing";
  if (!Array.isArray(o.checks) || o.checks.length === 0) return "checks is missing";
  for (const k of o.checks as { type?: unknown; value?: unknown; description?: unknown }[]) {
    if (!k || !["regex", "contains", "not_contains"].includes(String(k.type))) return `check with invalid type: ${String(k?.type)}`;
    if (typeof k.value !== "string" || !k.value) return "check without value";
    if (typeof k.description !== "string" || !k.description) return "check without description";
    if (k.type === "regex") {
      try {
        new RegExp(k.value, "iu");
      } catch {
        return `invalid regex: ${k.value}`;
      }
    }
  }
  return null;
}

export { CODES };
export type { Code };

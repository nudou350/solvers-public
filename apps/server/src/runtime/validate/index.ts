import { chunkMarkdown } from "../../knowledge/chunk.js";
import { VERSION_RE } from "../agent-ids.js";
import { Manifest } from "../manifest.js";
import { relativePathProblem } from "../package-paths.js";
import { CODES, type Code } from "./codes.js";
import { isIsoDate, parseFrontMatter } from "./frontmatter.js";
import { CATEGORIES, ManifestV1, NUCLEO_FORBIDDEN_CATEGORIES, type ManifestV1 as ManifestV1Type } from "./schema-v1.js";
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
  /** Quem envia: terceiros passam pelas regras estritas (v1) e pelas proibições do Núcleo. */
  origin: "platform" | "third_party";
  /** Padrão: "nucleo". Na Abertura entram `http`, PDF/HTML/CSV etc. */
  phase?: "nucleo" | "abertura";
  limits?: Partial<Limits>;
  now?: Date;
  /** `min_price` da config on-chain, em USDC (hoje 5). */
  minPriceUsdc?: number;
  reservedSlugs?: readonly string[];
  /** Quem é o criador logado e de quem já são o `id` e o `slug` (vindo do banco). */
  existing?: { creatorId?: string; ownerOfId?: (id: string) => string | undefined; ownerOfSlug?: (slug: string) => string | undefined };
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
  requirements: { label: string; howTo?: string }[];
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
  trial?: { summary: string; lockedSummary: string };
  versions: { version: string; notes: string }[];
};

const NAME_MAX_BYTES = 32;
const STEP_MIN_CHARS = 400;
const STEP_MAX_CHARS = 12_000;
const MAX_GATE_ITEMS = 6;
const REQUIRED_SECTIONS = ["Objetivo", "Como executar", "Formato do result_summary"] as const;
const OPTIONAL_SECTIONS = ["O que perguntar ao usuário", "Erros comuns"] as const;
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

export function validatePackage(input: PackageInput, opts: ValidateOptions): ValidationResult {
  const limits = { ...NUCLEO_LIMITS, ...opts.limits };
  const phase = opts.phase ?? "nucleo";
  const now = opts.now ?? new Date();
  const third = opts.origin === "third_party";
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (level: "E" | "A", code: Code, path: string, message: string, fix: string) => (level === "E" ? errors : warnings).push({ code, path, message, fix });
  const stats: ValidationStats = { specVersion: 0, files: 0, steps: 0, cases: 0, knowledgeFiles: 0, knowledgeChunksEstimate: 0, templates: 0, tools: 0, differentiators: [] };
  const finish = (): ValidationResult => ({ ok: errors.length === 0, errors, warnings, stats });

  // ---- Envelope do ZIP (dados que só o extrator conhece)
  const ar = opts.archive;
  if (ar?.zipBytes !== undefined && ar.zipBytes > limits.zipBytes) add("E", "ZIP_TOO_LARGE", "", `ZIP de ${ar.zipBytes} bytes passa do teto de ${limits.zipBytes}`, "Reduza o conhecimento ou divida o conteúdo.");
  if (ar?.expandedBytes !== undefined && ar.expandedBytes > limits.expandedBytes) add("E", "ZIP_EXPANDS_TOO_MUCH", "", `Conteúdo extraído de ${ar.expandedBytes} bytes passa do teto de ${limits.expandedBytes}`, "Reduza o tamanho dos arquivos.");
  if (ar?.roots !== undefined && ar.roots !== 1) add("E", "ZIP_BAD_ROOT", "", `O ZIP precisa ter exatamente 1 pasta raiz (achei ${ar.roots})`, "Coloque tudo dentro de uma única pasta com o manifest.json.");

  // ---- Arquivos: caminhos, duplicatas, links, tipos, tamanhos
  const files = new Map<string, PackageEntry>();
  const seen = new Map<string, string>();
  const sorted = [...input.entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    const base = e.path.slice(e.path.lastIndexOf("/") + 1);
    if (e.path.startsWith("__MACOSX/") || base === ".DS_Store" || base === "Thumbs.db") {
      add("A", "ZIP_IGNORED_FILE", e.path, "Arquivo de sistema removido da extração", "Não precisa fazer nada; evite compactar pelo Finder sem limpar.");
      continue;
    }
    if (e.isSymlink) {
      add("E", "ZIP_SYMLINK", e.path, "Link simbólico não é permitido", "Troque o link pelo arquivo real.");
      continue;
    }
    const nfc = e.path.normalize("NFC");
    const segs = e.path.split("/");
    const badChars = !/^[\p{L}\p{N}._\-/ ]+$/u.test(e.path);
    const why = relativePathProblem(e.path, [""]) ?? (nfc !== e.path ? "não está normalizado em NFC" : segs.some((s) => s.startsWith(".")) ? "nome começa com ponto" : badChars ? "tem caractere fora de letras, dígitos, . _ - e espaço" : null);
    if (why) {
      add("E", "ZIP_BAD_PATH", e.path, `Caminho inválido: ${why}`, "Renomeie o arquivo com letras, dígitos, hífen, sublinhado e ponto.");
      continue;
    }
    const key = nfc.toLowerCase();
    if (seen.has(key)) {
      add("E", "ZIP_DUPLICATE_ENTRY", e.path, `Repete o arquivo ${seen.get(key)} (NFC, sem distinguir maiúsculas)`, "Deixe só uma versão do arquivo.");
      continue;
    }
    seen.set(key, e.path);
    files.set(e.path, e);
  }
  stats.files = files.size;
  if (files.size > limits.files) add("E", "ZIP_TOO_MANY_FILES", "", `${files.size} arquivos passam do teto de ${limits.files}`, "Junte arquivos pequenos de conhecimento.");

  const textCache = new Map<string, string | null>();
  const readText = (path: string): string | null => {
    if (textCache.has(path)) return textCache.get(path)!;
    const bytes = input.read(path);
    let out: string | null = null;
    if (bytes) {
      try {
        out = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        add("E", "FILE_NOT_UTF8", path, "O arquivo não é UTF-8 válido", "Salve o arquivo como UTF-8.");
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
      default:
        return false;
    }
  };

  for (const [path, e] of files) {
    if (e.size > limits.fileBytes) add("E", "FILE_TOO_LARGE", path, `Arquivo de ${e.size} bytes passa do teto de ${limits.fileBytes}`, "Divida o arquivo em partes menores.");
    if (path === "manifest.json" || path === "README.md") continue;
    const folder = path.split("/")[0]!;
    if (folder === "verifier") {
      if (third) add("E", "MANIFEST_PLATFORM_FORBIDDEN", path, "A pasta verifier/ é só de pacotes da plataforma", "Remova a pasta verifier/.");
      continue;
    }
    if (third && !allowedIn(folder, extOf(path)) && !(folder === "knowledge" && path.endsWith(".meta.json"))) {
      add("E", "FILE_TYPE_NOT_ALLOWED", path, `Tipo de arquivo não permitido em ${folder}/ nesta fase (${extOf(path) || "sem extensão"})`, "Converta para .md ou .txt (PDF, HTML e CSV entram só na Abertura).");
    }
  }

  // ---- Manifesto
  if (!files.has("manifest.json")) {
    add("E", "MANIFEST_MISSING", "manifest.json", "Falta o manifest.json na raiz do pacote", "Crie o manifest.json (veja o esqueleto no Criador de Solvers).");
    return finish();
  }
  const manifestText = readText("manifest.json");
  if (manifestText === null) return finish();
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch (e) {
    add("E", "MANIFEST_INVALID_JSON", "manifest.json", `JSON inválido: ${(e as Error).message}`, "Corrija a sintaxe do JSON.");
    return finish();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    add("E", "MANIFEST_SCHEMA", "manifest.json", "O manifesto precisa ser um objeto JSON", "Use { ... } na raiz.");
    return finish();
  }
  const rawObj = raw as Record<string, unknown>;
  const strict = rawObj.specVersion === 1 || third;
  if (third && rawObj.specVersion !== 1) {
    add("E", "MANIFEST_SPEC_VERSION", "manifest.json#specVersion", "Envios de terceiros precisam de \"specVersion\": 1", "Acrescente \"specVersion\": 1 ao manifesto.");
    rawObj.specVersion = 1;
  }
  // Nome e limites de tamanho do v1 viram erros com código próprio; o schema cuida do resto.
  const schemaIssues = (issues: { code: string; path: (string | number)[]; message: string; keys?: string[] }[]) => {
    for (const i of issues) {
      const path = `manifest.json#${dotted(i.path)}`;
      if (i.code === "unrecognized_keys") {
        for (const k of i.keys ?? []) add("E", "MANIFEST_UNKNOWN_FIELD", `manifest.json#${[...i.path, k].join(".")}`, `Campo desconhecido: ${k}`, "Remova o campo ou use um campo da especificação.");
      } else if (/formato de um id/.test(i.message)) add("E", "MANIFEST_SLUG_LOOKS_LIKE_ID", path, i.message, "Escolha um slug com palavras (ex.: meu-solver).");
      else if (/16 bytes/.test(i.message)) add("E", "MANIFEST_VERSION_TOO_LONG", path, i.message, "Use uma versão curta como 1.0.0.");
      else if (i.path[0] === "trial" && i.path[1] === "steps") add("E", "TRIAL_STEPS_EXCEED", path, i.message, "Reduza trial.steps ao número de etapas.");
      else if (i.path[0] === "trial" && i.path[1] === "tools") add("E", "TRIAL_TOOL_UNKNOWN", path, i.message, "Use só nomes que existem em tools.");
      else if (i.path[0] === "trial" && i.path[1] === "templates") add("E", "TRIAL_TEMPLATE_UNKNOWN", path, i.message, "Use só nomes que existem em templates.");
      else add("E", "MANIFEST_SCHEMA", path, i.message, "Corrija o campo conforme o schema do manifesto.");
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
  if (Buffer.byteLength(m.name) > NAME_MAX_BYTES) add(L("E"), "MANIFEST_NAME_TOO_LONG", mp("name"), `O nome passa de ${NAME_MAX_BYTES} bytes (limite on-chain)`, "Encurte o nome.");
  if (strict) {
    if (Buffer.byteLength(m.name) < 3) add("E", "MANIFEST_SCHEMA", mp("name"), "O nome precisa ter pelo menos 3 caracteres", "Escreva um nome.");
    if (m.tagline.length < 10 || m.tagline.length > 100) add("E", "MANIFEST_SCHEMA", mp("tagline"), `A tagline precisa ter de 10 a 100 caracteres (tem ${m.tagline.length})`, "Reescreva em uma frase de valor.");
    if (m.description.length < 120 || m.description.length > 2000) add("E", "MANIFEST_SCHEMA", mp("description"), `A descrição precisa ter de 120 a 2.000 caracteres (tem ${m.description.length})`, "Explique o que entrega, para quem e o que não faz.");
    if (!(CATEGORIES as readonly string[]).includes(m.category)) add("E", "MANIFEST_SCHEMA", mp("category"), `Categoria desconhecida: ${m.category}`, `Use uma de: ${CATEGORIES.join(", ")}.`);
    if (m.pricing.royaltyBps < 0 || m.pricing.royaltyBps > 1000) add("E", "MANIFEST_SCHEMA", mp("pricing.royaltyBps"), "royaltyBps precisa ficar entre 0 e 1000", "Ajuste o royalty.");
    if (m.packageContents.length < 3 || m.packageContents.length > 8) add("E", "MANIFEST_SCHEMA", mp("packageContents"), "packageContents precisa ter de 3 a 8 itens", "Liste de 3 a 8 itens do que o pacote entrega.");
  }
  if (third) {
    if (m.platform === true) add("E", "MANIFEST_PLATFORM_FORBIDDEN", mp("platform"), "Só pacotes da plataforma podem usar platform: true", "Remova o campo platform.");
    if (phase === "nucleo" && NUCLEO_FORBIDDEN_CATEGORIES.includes(m.category)) {
      add("E", "MANIFEST_CATEGORY_FORBIDDEN", mp("category"), `A categoria ${m.category} não é aceita de terceiros nesta fase`, "Use outra categoria (conteúdo regulado espera a revisão jurídica).");
    }
    if (phase === "nucleo" && m.guarantee?.available === true) {
      add("E", "MANIFEST_GUARANTEE_FORBIDDEN", mp("guarantee.available"), "Terceiros ainda não oferecem garantia", "Use guarantee: { available: false, defaultCriteria: [] }.");
    }
  }
  if (opts.minPriceUsdc !== undefined && m.pricing.priceUsdc < opts.minPriceUsdc) {
    add(third || strict ? "E" : "A", "MANIFEST_PRICE_BELOW_MIN", mp("pricing.priceUsdc"), `O preço (${m.pricing.priceUsdc} USDC) é menor que o mínimo (${opts.minPriceUsdc} USDC)`, `Use ${opts.minPriceUsdc} USDC ou mais.`);
  }
  if (!m.versions.some((v) => v.version === m.version)) {
    add(L("E"), "MANIFEST_VERSIONS_MISSING", mp("versions"), `Falta a entrada de versions[] para a versão ${m.version}`, "Acrescente { version, releasedAt, notes } da versão atual.");
  }
  if (m.catalogOnly !== undefined) add("A", "CATALOG_ONLY_IGNORED", mp("catalogOnly"), "catalogOnly não tem efeito no servidor", "Remova o campo.");
  if (strict && !(m.terms?.rightsConfirmed === true && m.terms.sourcesListed === true)) {
    add("E", "TERMS_MISSING", mp("terms"), "Confirme os direitos e a lista de fontes em terms", 'Use "terms": { "rightsConfirmed": true, "sourcesListed": true }.');
  } else if (!strict) {
    add("A", "TERMS_MISSING", mp("terms"), "Pacote v0 sem terms", "Acrescente terms ao migrar para specVersion 1.");
  }
  if (opts.reservedSlugs?.includes(m.slug)) add("E", "MANIFEST_SLUG_RESERVED", mp("slug"), `O slug ${m.slug} é reservado`, "Escolha outro slug.");
  const ex = opts.existing;
  if (ex) {
    const idOwner = m.id ? ex.ownerOfId?.(m.id) : undefined;
    const slugOwner = ex.ownerOfSlug?.(m.slug);
    if (idOwner !== undefined && idOwner !== ex.creatorId) add("E", "MANIFEST_ID_OWNER", mp("id"), "Este id já pertence a outro criador", "Remova o id (o servidor atribui um novo) ou use o de um pacote seu.");
    if (slugOwner !== undefined && slugOwner !== ex.creatorId) add("E", "MANIFEST_ID_OWNER", mp("slug"), "Este slug já pertence a outro criador", "Escolha outro slug.");
  }
  const prev = opts.previous;
  if (prev) {
    if (!semverGreater(m.version, prev.version)) {
      add("E", "MANIFEST_VERSION_NOT_GREATER", mp("version"), `A versão ${m.version} não é maior que a publicada (${prev.version})`, "Suba a versão (MAJOR.MINOR.PATCH).");
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
      if (changed.length) add("E", "DIFF_ENDPOINT_CHANGED_MINOR", mp(changed[0]!), `Mudou ${changed.join(", ")} sem subir a versão MAJOR`, "Suba o MAJOR (ex.: 1.4.2 para 2.0.0) para mudanças nestes campos.");
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
    if (hidden) add("A", "TEXT_HIDDEN_CHARS", path, `Caractere invisível ou de direção ${hidden.codePoint} na posição ${hidden.index}`, "Remova o caractere (pode esconder instruções do revisor).");
    const inj = injectionMatch(text);
    if (inj) add("A", "STEP_INJECTION_PATTERN", path, `Trecho parecido com injeção de instruções: "${inj}"`, "Reescreva sem mandar a IA ignorar regras nem esconder coisas do usuário.");
    if (kind === "step") {
      const ask = sensitiveAsk(text);
      if (ask) add("A", "STEP_SENSITIVE_ASK", path, `Pede dado sensível ao usuário: "${ask}"`, "Não peça senhas, CPF, cartão ou credenciais.");
      const url = sendingUrl(text);
      if (url) add("A", "STEP_EXTERNAL_URL", path, `URL de envio de dados: ${url}`, "Não mande a IA enviar dados do usuário para endereços externos.");
    }
  };
  for (const [p, t] of manifestTexts) scanText(p, t, "manifest");

  // ---- Ferramentas
  const toolNames = new Set(m.tools.map((t) => t.name));
  stats.tools = m.tools.length;
  for (const [i, t] of m.tools.entries()) {
    const tp = mp(`tools.${i}`);
    const builtin = t.runner.startsWith("builtin:") || LEGACY_RUNNERS.has(t.runner);
    const remote = t.runner === "http" || t.runner === "mcp";
    if (third) {
      if (builtin || (phase === "nucleo" && remote) || !(builtin || remote)) {
        add("E", "TOOL_FORBIDDEN_RUNNER", `${tp}.runner`, `O runner "${t.runner}" não é permitido a terceiros nesta fase`, phase === "nucleo" ? "Pacotes de terceiros ainda não têm ferramentas: remova tools." : "Use o runner http.");
        continue;
      }
    }
    if (!t.inputSchema) add(L("E"), "TOOL_SCHEMA_MISSING", `${tp}.inputSchema`, "A ferramenta não declara inputSchema", "Descreva a entrada com um JSON Schema.");
    for (const key of ["inputSchema", "outputSchema"] as const) {
      const schema = t[key];
      if (schema) {
        const why = schemaUnsafe(schema);
        if (why) add("E", "TOOL_SCHEMA_UNSAFE", `${tp}.${key}`, why, "Use um schema simples, sem $ref remoto nem pattern.");
      }
    }
    if (remote) {
      if (t.egress !== true) add("E", "TOOL_EGRESS_MISSING", `${tp}.egress`, "Ferramenta que envia dados a um serviço do criador precisa de egress: true", "Acrescente egress: true.");
      const host = t.runner === "http" && t.http ? httpHostProblem(t.http) : t.runner === "http" ? "falta o bloco http" : null;
      if (host) add("E", "TOOL_HTTP_HOST", `${tp}.http`, host, "Use https, porta 443, um domínio próprio e liste-o em allowedHosts.");
    }
  }

  // ---- Etapas
  stats.steps = m.steps.length;
  const stepTexts: string[] = [];
  for (const [i, s] of m.steps.entries()) {
    const sp = mp(`steps.${i}.file`);
    const why = relativePathProblem(s.file, ["steps/"]);
    if (why) {
      add("E", "MANIFEST_PATH_ESCAPE", sp, `Caminho "${s.file}" inválido: ${why}`, "Use um caminho como steps/01-nome.md.");
      continue;
    }
    if (!files.has(s.file)) {
      add("E", "STEP_FILE_MISSING", sp, `A etapa ${i + 1} aponta para ${s.file}, que não existe no pacote`, "Crie o arquivo ou corrija o caminho.");
      continue;
    }
    const text = readText(s.file);
    if (text === null) continue;
    stepTexts.push(text);
    if (text.length < STEP_MIN_CHARS || text.length > STEP_MAX_CHARS) {
      add(L("E"), "STEP_TOO_SHORT_LONG", s.file, `A etapa tem ${text.length} caracteres (precisa ter de ${STEP_MIN_CHARS} a ${STEP_MAX_CHARS})`, "Detalhe a etapa ou divida em duas.");
    }
    for (const title of [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS]) {
      const has = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(text);
      if (!has) add((REQUIRED_SECTIONS as readonly string[]).includes(title) ? L("E") : "A", "STEP_SECTION_MISSING", s.file, `Falta a seção "## ${title}"`, `Acrescente a seção "## ${title}".`);
    }
    scanText(s.file, text, "step");
    // Referências a ferramentas: nomes snake_case entre crases em linhas que falam de ferramenta.
    for (const line of text.split("\n")) {
      if (!/run_tool|ferramenta/i.test(line)) continue;
      for (const match of line.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g)) {
        const name = match[1]!;
        if (!toolNames.has(name) && !GLOBAL_NAMES.has(name)) add("A", "STEP_REFERENCE_UNKNOWN", s.file, `Cita a ferramenta ${name}, que não existe em tools`, "Declare a ferramenta em tools ou corrija o nome.");
      }
    }
    if (s.gate.length > MAX_GATE_ITEMS) add(L("E"), "GATE_TOO_MANY", mp(`steps.${i}.gate`), `O gate tem ${s.gate.length} itens (máximo ${MAX_GATE_ITEMS})`, "Reduza o checklist.");
    for (const [gi, g] of s.gate.entries()) {
      if (typeof g !== "string" && !toolNames.has(g.evidence.tool)) {
        add("E", "GATE_EVIDENCE_UNKNOWN_TOOL", mp(`steps.${i}.gate.${gi}.evidence.tool`), `A evidência usa a ferramenta ${g.evidence.tool}, que não existe em tools`, "Use o nome de uma ferramenta declarada.");
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
    if (why) add("E", "MANIFEST_PATH_ESCAPE", mp(`templates.${t.name}.path`), `Caminho "${tp}" inválido: ${why}`, "Use um caminho como templates/modelo.md.");
    else if (!files.has(tp)) add("E", "TEMPLATE_MISSING", mp(`templates.${t.name}.path`), `O template ${t.name} aponta para ${tp}, que não existe`, "Crie o arquivo ou corrija o caminho.");
  }
  for (const p of templateFiles) {
    if (third && !allowedIn("templates", extOf(p))) add("E", "TEMPLATE_TYPE_FORBIDDEN", p, `Tipo ${extOf(p)} não é permitido em templates nesta fase`, "Use .md, .txt ou .json.");
    if (!declared.some((t) => t.path === p)) add("A", "TEMPLATE_UNDECLARED", p, "Arquivo em templates/ que não está declarado em templates[] (não será entregue)", "Declare em templates[] ou remova.");
    if ([".md", ".txt", ".json"].includes(extOf(p))) {
      const text = readText(p);
      if (text) scanText(p, text, "template");
    }
  }
  if (phase === "abertura" && third) {
    for (const p of templateFiles) if ([".svg", ".html", ".htm", ".js"].includes(extOf(p))) add("E", "TEMPLATE_TYPE_FORBIDDEN", p, `Tipo ${extOf(p)} é bloqueado em templates`, "Use .md, .txt ou .json.");
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
      if (fm.kind === "invalid") add("E", "KNOWLEDGE_FRONTMATTER_INVALID", p, `Front-matter inválido: ${fm.error}`, "Use um bloco --- com linhas 'chave: valor'.");
      else if (fm.kind === "ok") {
        for (const key of ["source_date", "valid_until"] as const) {
          const v = fm.data[key];
          if (v !== undefined && (typeof v !== "string" || !isIsoDate(v))) add("E", "KNOWLEDGE_DATE_INVALID", p, `${key} precisa ser uma data AAAA-MM-DD válida`, "Escreva a data como 2026-09-30.");
        }
        const sd = fm.data.source_date;
        if (typeof sd === "string" && isIsoDate(sd)) {
          withDate += 1;
        }
        const vu = fm.data.valid_until;
        if (typeof vu === "string" && isIsoDate(vu) && new Date(`${vu}T23:59:59Z`) < now) {
          expired += 1;
          add("A", "KNOWLEDGE_EXPIRED", p, `O conteúdo venceu em ${vu}`, "Atualize o arquivo ou remova-o.");
        }
        if (strict && typeof fm.data.source !== "string") add("E", "KNOWLEDGE_SOURCE_MISSING", p, "Falta 'source' no front-matter", "Informe a fonte (ex.: source: Banco Central do Brasil).");
      } else if (strict) {
        add("E", "KNOWLEDGE_SOURCE_MISSING", p, "Sem front-matter: falta a fonte do conteúdo", "Acrescente um bloco --- com source e source_date.");
      }
    } else if (strict && !files.has(`${p}.meta.json`)) {
      add("E", "KNOWLEDGE_SOURCE_MISSING", p, "Arquivo .txt sem nome.txt.meta.json com a fonte", "Crie o arquivo .meta.json com source e source_date.");
    }
    stats.knowledgeChunksEstimate += chunkMarkdown(body).length;
    scanText(p, text, "knowledge");
  }
  if (stats.knowledgeChunksEstimate > limits.knowledgeChunks) {
    add("E", "KNOWLEDGE_TOO_BIG", "knowledge/", `O conhecimento gera ${stats.knowledgeChunksEstimate} trechos (teto ${limits.knowledgeChunks})`, "Reduza o conteúdo ou dê prioridade ao essencial.");
  }
  if (strict && m.knowledge && !isIsoDate(m.knowledge.updatedAt)) add("E", "KNOWLEDGE_DATE_INVALID", mp("knowledge.updatedAt"), "updatedAt precisa ser uma data AAAA-MM-DD válida", "Escreva a data como 2026-09-30.");

  // ---- Onboarding
  if (m.onboarding) {
    if (m.usesMemory !== true) add("E", "ONBOARDING_NEEDS_MEMORY", mp("usesMemory"), "onboarding exige usesMemory: true (o perfil fica na memória)", 'Acrescente "usesMemory": true.');
    for (const [i, q] of m.onboarding.questions.entries()) {
      if (sensitiveQuestion(`${q.ask} ${q.why} ${(q.options ?? []).join(" ")}`)) add("A", "ONBOARDING_SENSITIVE", mp(`onboarding.questions.${i}`), "A pergunta parece pedir dado sensível", "Não peça senhas, documentos ou credenciais na calibragem.");
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
  if (caseFiles.length < limits.minEvalCases) add(L("E"), "EVAL_TOO_FEW_CASES", "evals/cases/", `Há ${caseFiles.length} casos de teste (mínimo ${limits.minEvalCases})`, "Escreva mais casos cobrindo os pedidos típicos.");

  // ---- Diferenciais
  const joined = stepTexts.join("\n");
  const proven: string[] = [];
  if (m.tools.length >= 1 && m.tools.every((t) => joined.includes(t.name))) proven.push("tool");
  if (opts.origin === "platform" && m.guarantee?.available && (m.guarantee.milestones ?? []).some((x) => (x.verify ?? "tests") === "tests")) proven.push("verifier");
  const k = m.knowledge;
  const fresh = k && isIsoDate(k.updatedAt) ? now.getTime() - new Date(`${k.updatedAt}T00:00:00Z`).getTime() <= k.reviewEveryDays * 86_400_000 : false;
  if ((mdLike > 0 && expired === 0 && withDate / mdLike >= 0.5 && fresh) || m.tools.some((t) => t.runner === "http")) proven.push("liveData");
  if (m.onboarding && /perfil|profile/i.test(joined)) proven.push("memory");
  if (m.escalation?.enabled === true) proven.push("escalation");
  stats.differentiators = proven;
  const declaredDiffs = m.differentiators ?? [];
  for (const d of declaredDiffs) {
    if (!proven.includes(d)) add("A", "MANIFEST_DIFFERENTIATOR_UNPROVEN", mp("differentiators"), `O diferencial "${d}" não foi comprovado pelo pacote`, diffHint(d));
  }
  if (strict && proven.length < 2) add("A", "MANIFEST_DIFFERENTIATORS_FEW", mp("differentiators"), `Só ${proven.length} diferencial(is) comprovado(s); o critério é ter pelo menos 2`, "Acrescente conhecimento datado, calibragem, atendimento do criador ou ferramenta.");

  // ---- packageContents x realidade
  const pc = m.packageContents.join(" ").toLowerCase();
  const mismatch = (cond: boolean, what: string) => cond && add("A", "CONTENTS_MISMATCH", mp("packageContents"), `packageContents cita ${what}, mas o pacote não tem`, "Ajuste a lista ao que o pacote realmente entrega.");
  mismatch(/template|modelo/.test(pc) && declared.length === 0 && templateFiles.length === 0, "templates/modelos");
  mismatch(/ferramenta/.test(pc) && m.tools.length === 0, "ferramentas");
  mismatch(/garantia/.test(pc) && !m.guarantee?.available, "garantia");
  // usesMemory ausente é deduzido das etapas (como o carregador faz).
  const usesMemory = m.usesMemory ?? /(save_memory|get_memory)/.test(joined);
  mismatch(/mem(ó|o)ria|calibra/.test(pc) && !usesMemory && !m.onboarding, "memória");
  mismatch(/base|conhecimento|fontes?\b/.test(pc) && stats.knowledgeFiles === 0, "base de conhecimento");

  return finish();
}

function diffHint(d: string): string {
  switch (d) {
    case "liveData":
      return "Mantenha knowledge.updatedAt dentro de reviewEveryDays, sem arquivos vencidos, e ponha source_date em pelo menos metade dos arquivos.";
    case "memory":
      return "Declare onboarding e faça pelo menos uma etapa usar o perfil do usuário.";
    case "escalation":
      return "Ative escalation.enabled e vincule o Telegram no perfil do criador.";
    case "tool":
      return "Declare ferramentas em tools e use-as nas etapas.";
    default:
      return "Declare a garantia por testes (só pacotes da plataforma).";
  }
}

/** JSON Schema do criador roda no servidor: sem $ref remoto, sem pattern (ReDoS), profundidade e tamanho limitados. */
function schemaUnsafe(schema: unknown): string | null {
  const size = JSON.stringify(schema).length;
  if (size > 20_000) return `O schema tem ${size} caracteres (máximo 20.000)`;
  let problem: string | null = null;
  const walk = (node: unknown, depth: number) => {
    if (problem) return;
    if (depth > 6) {
      problem = "O schema passa de 6 níveis de profundidade";
      return;
    }
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "$ref" && !(typeof value === "string" && value.startsWith("#"))) problem = "O schema usa $ref remoto";
        else if (key === "pattern" || key === "patternProperties") problem = `O schema usa ${key} (risco de expressão regular lenta)`;
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
    return `URL inválida: ${http.url}`;
  }
  if (url.protocol !== "https:") return "Só https é permitido";
  if (url.port && url.port !== "443") return "Só a porta 443 é permitida";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "Endereço IP ou localhost não é permitido";
  if (!http.allowedHosts.map((h) => h.toLowerCase()).includes(host)) return `O host ${host} não está em allowedHosts`;
  if (SHARED_HOSTING.some((s) => host.endsWith(s))) return `Domínio de hospedagem compartilhada (${host}) não serve como prova de controle`;
  return null;
}

function evalCaseProblem(text: string, seen: Set<string>): string | null {
  let c: unknown;
  try {
    c = JSON.parse(text);
  } catch {
    return "JSON inválido";
  }
  if (!c || typeof c !== "object") return "o caso precisa ser um objeto";
  const o = c as { id?: unknown; input?: unknown; checks?: unknown };
  if (typeof o.id !== "string" || !o.id) return "falta id";
  if (seen.has(o.id)) return `id repetido: ${o.id}`;
  seen.add(o.id);
  if (typeof o.input !== "string" || o.input.length < 3) return "falta input";
  if (!Array.isArray(o.checks) || o.checks.length === 0) return "falta checks";
  for (const k of o.checks as { type?: unknown; value?: unknown; description?: unknown }[]) {
    if (!k || !["regex", "contains", "not_contains"].includes(String(k.type))) return `checagem com type inválido: ${String(k?.type)}`;
    if (typeof k.value !== "string" || !k.value) return "checagem sem value";
    if (typeof k.description !== "string" || !k.description) return "checagem sem description";
    if (k.type === "regex") {
      try {
        new RegExp(k.value, "iu");
      } catch {
        return `regex inválida: ${k.value}`;
      }
    }
  }
  return null;
}

export { CODES };
export type { Code };

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { localeFilePath, PACKAGE_LOCALE_LANGS, PackageLocale, type AgentTranslations } from "@solvers/shared";
import { Manifest } from "./manifest.js";
import { resolveInsidePackage } from "./package-paths.js";
import { platformVerdict } from "./platform-agents.js";
import { ManifestV1 } from "./validate/schema-v1.js";

// Leitura de UM pacote do disco e registro no mapa de pacotes (INSTRUCTIONS.md 5.4 e 6). Sem env/banco:
// testado em test/packages.test.ts. O cache e as pastas raiz ficam em packages.ts.

/** Template declarado em `manifest.templates[]` (PACKAGE_SPEC.md 7). */
export type TemplateDecl = { name: string; path: string; title: string; description: string };

/** Campos do manifesto v1 que o zod v0 não conhece (o carregador usa ManifestV1 quando `specVersion` é 1). */
export type ManifestExtras = {
  specVersion?: 1;
  platform?: boolean;
  templates?: TemplateDecl[];
  differentiators?: string[];
  /** Calibragem do primeiro uso (PACKAGE_SPEC.md 10): perguntas que o get_memory entrega enquanto não há perfil. */
  onboarding?: { questions: { id: string; ask: string; why: string; options?: string[] }[] };
};

export type SolverPackage = {
  manifest: Manifest & ManifestExtras;
  dir: string;
  steps: { title: string; body: string; gate: string[] }[];
  /** Calculado sob demanda (lê todos os arquivos do pacote): o boot não paga por isso. */
  versionHash: string;
  evalReport: { scoreBps: number; hash: string } | null;
  /** Textos de catálogo traduzidos (locales/<lang>.json); vazio = só o inglês do manifest. */
  translations: AgentTranslations;
  usesMemory: boolean;
  /** De onde veio: pasta da plataforma (AGENTS_DIR) ou pacotes publicados de criadores (PUBLISHED_DIR). Padrão: agents. */
  source?: PackageSource;
  /** Solver da plataforma: vale a lista PLATFORM_AGENTS do servidor, não o campo do manifesto. */
  platform?: boolean;
};

export type PackageSource = "agents" | "published";

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = lstatSync(full);
    // Link simbólico entraria no hash (e numa leitura futura) apontando para fora da pasta.
    // Confere antes de ignorar arquivos ocultos: `knowledge/.x.md` também pode ser um link.
    if (st.isSymbolicLink()) throw new Error(`link simbólico não é permitido no pacote: ${relative(dir, full)}`);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (st.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Hash determinístico do pacote: sha256 sobre (caminho relativo + sha256 do conteúdo) de todos os
 * arquivos em ordem alfabética, sem datas. Mesmo pacote => mesmo hash em qualquer máquina.
 * O relatório de evals fica de fora (ele é gerado depois e tem hash próprio on-chain).
 */
export function packageHash(dir: string): string {
  const h = createHash("sha256");
  const files = listFiles(dir)
    .map((f) => relative(dir, f).split(sep).join("/"))
    .filter((f) => f !== "evals/report.json")
    .sort();
  for (const rel of files) {
    const raw = readFileSync(join(dir, rel));
    // Texto com CRLF (checkout no Windows) e LF (VPS) precisa dar o mesmo hash.
    const content = /\.(md|json|tsx?|jsx?|css|txt|ya?ml)$/.test(rel) ? Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n")) : raw;
    h.update(rel);
    h.update("\0");
    h.update(createHash("sha256").update(content).digest());
  }
  return h.digest("hex");
}

/**
 * Carimbo barato das pastas de pacotes (nome, inode, mtime e tamanho do `manifest.json` de cada pacote): muda quando outro
 * processo (a CLI `cli:approve`, o worker) troca uma pasta ou publica uma versão nova. Só stat, sem ler conteúdo.
 */
export function packagesStamp(roots: readonly string[]): string {
  const parts: string[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root).sort();
    } catch {
      continue; // pasta inexistente (nenhum criador publicou ainda)
    }
    for (const name of names) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      try {
        const st = statSync(join(root, name, "manifest.json"));
        // As traduções de catálogo (locales/pt.json) também entram: editá-las sem mexer no manifest recarrega o pacote.
        let loc = "";
        try {
          const ls = statSync(join(root, name, localeFilePath("pt")));
          loc = `|${Math.trunc(ls.mtimeMs)}|${ls.size}`;
        } catch {
          // sem traduções
        }
        parts.push(`${root}|${name}|${st.ino}|${Math.trunc(st.mtimeMs)}|${st.size}${loc}`);
      } catch {
        // sem manifest.json (pasta solta ou troca em andamento): não entra
      }
    }
  }
  return parts.join("\n");
}

/** Item de gate: texto ou objeto com evidência (v1); o motor entrega só o texto. */
const gateText = (g: string | { text: string }): string => (typeof g === "string" ? g : g.text);

/** Manifesto v1 (`specVersion: 1`) usa o schema estrito novo; sem `specVersion` vale o v0 da plataforma (zod remove o que não conhece). */
function parseManifest(raw: unknown): Manifest & ManifestExtras {
  if (raw && typeof raw === "object" && (raw as { specVersion?: unknown }).specVersion === 1) {
    const m = ManifestV1.parse(raw);
    if (!m.id) throw new Error("manifesto v1 sem id (o servidor atribui o id no envio; um pacote publicado precisa dele)");
    return { ...m, id: m.id, steps: m.steps.map((s) => ({ ...s, gate: s.gate.map(gateText) })) } as unknown as Manifest & ManifestExtras;
  }
  return Manifest.parse(raw);
}

/**
 * Traduções de catálogo do pacote (`locales/<lang>.json`, só pt por ora). O arquivo é opcional; presente e inválido
 * recusa o pacote (o validador do envio já barra antes: aqui só protege o que está em disco).
 */
export function loadLocales(dir: string): AgentTranslations {
  const out: AgentTranslations = {};
  for (const lang of PACKAGE_LOCALE_LANGS) {
    const rel = localeFilePath(lang);
    // Nunca segue link simbólico: o caminho é fixo, mas a pasta vem de um ZIP de terceiros.
    const path = join(dir, rel);
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) throw new Error(`link simbólico não é permitido no pacote: ${rel}`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`${rel}: JSON inválido (${(e as Error).message})`);
    }
    const parsed = PackageLocale.safeParse(raw);
    if (!parsed.success) throw new Error(`${rel}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ")}`);
    out[lang] = parsed.data;
  }
  return out;
}

export function loadPackage(dir: string, opts: { source?: PackageSource } = {}): SolverPackage {
  const source = opts.source ?? "agents";
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  // Autoridade de "plataforma" é a lista do servidor; o campo do manifesto só vale se ela concordar.
  const verdict = platformVerdict(manifest, source);
  if (verdict.error) throw new Error(verdict.error);
  // Pacote publicado vive em PUBLISHED_DIR/<slug>/: a pasta com outro nome indica cópia solta ou troca em andamento.
  if (source === "published" && basename(dir) !== manifest.slug) throw new Error(`a pasta ${basename(dir)} não é o slug do pacote (${manifest.slug})`);
  // Link simbólico nunca é aceito no pacote (só lstat, sem ler conteúdo): o hash é preguiçoso, então a recusa não pode depender dele.
  listFiles(dir);
  const steps = manifest.steps.map((s, i) => {
    // O caminho vem do manifesto: nunca junta direto (../ e links simbólicos escapariam da pasta).
    const body = readFileSync(resolveInsidePackage(dir, s.file, ["steps/"]), "utf8");
    const title = s.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? `Step ${i + 1}`;
    return { title, body, gate: s.gate };
  });
  const reportPath = join(dir, "evals", "report.json");
  let evalReport: SolverPackage["evalReport"] = null;
  if (existsSync(reportPath)) {
    const raw = readFileSync(reportPath);
    const r = JSON.parse(raw.toString("utf8")) as { scoreBps?: number };
    evalReport = { scoreBps: Number(r.scoreBps ?? 0), hash: createHash("sha256").update(raw).digest("hex") };
  }
  const usesMemory = manifest.usesMemory ?? steps.some((s) => /(save_memory|get_memory)/.test(s.body));
  // O hash lê TODOS os arquivos (conhecimento incluso): só é calculado quando alguém precisa dele (publish, catálogo).
  let hash: string | undefined;
  return {
    manifest,
    dir,
    steps,
    get versionHash() {
      return (hash ??= packageHash(dir));
    },
    evalReport,
    translations: loadLocales(dir),
    usesMemory,
    source,
    platform: verdict.platform,
  };
}

/**
 * Registra o pacote pelo `id` e pelo `slug` no mesmo mapa. `id` e `slug` formam UM espaço de nomes:
 * qualquer colisão (id repetido, slug repetido, slug de um igual ao id de outro) recusa o pacote novo e
 * mantém o que já estava, em vez de o último sobrescrever o primeiro em silêncio.
 */
export function registerPackage(registry: Map<string, SolverPackage>, pkg: SolverPackage): void {
  const { id, slug } = pkg.manifest;
  for (const key of [id, slug]) {
    const owner = registry.get(key);
    if (owner) throw new Error(`"${key}" já pertence ao pacote ${owner.manifest.slug} (${owner.manifest.id})`);
  }
  registry.set(id, pkg);
  registry.set(slug, pkg);
}

/**
 * Carrega todos os pacotes de uma pasta raiz (um por subpasta com manifest.json). Pacote inválido ou em colisão é pulado
 * e registrado. `into` mescla várias raízes no MESMO mapa: o que já está nele tem prioridade (a plataforma vem antes dos
 * criadores) e a colisão de id/slug entre raízes recusa o pacote novo. Raiz inexistente não é erro (PUBLISHED_DIR pode não existir).
 */
export function loadAll(
  root: string,
  onError: (dir: string, e: Error) => void = () => undefined,
  opts: { source?: PackageSource; into?: Map<string, SolverPackage> } = {},
): Map<string, SolverPackage> {
  const registry = opts.into ?? new Map<string, SolverPackage>();
  if (!existsSync(root)) return registry;
  for (const name of readdirSync(root).sort()) {
    // `_archive/` (versões antigas), pastas de trabalho (`.tmp`) e `node_modules` nunca são pacotes.
    if (name.startsWith("_") || name.startsWith(".") || name === "node_modules") continue;
    const dir = join(root, name);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    try {
      registerPackage(registry, loadPackage(dir, { source: opts.source }));
    } catch (e) {
      onError(dir, e as Error);
    }
  }
  return registry;
}

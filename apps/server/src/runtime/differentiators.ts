import { statSync } from "node:fs";
import { join } from "node:path";
import type { SolverPackage } from "./package-loader.js";
import { validatePackage, type PackageInput } from "./validate/index.js";
import { packageFromFolder } from "./validate/input.js";

// Diferenciais COMPROVADOS de um pacote v1 (PACKAGE_SPEC.md 4.2 e 20): o que o validador consegue conferir, não o que o
// criador declarou. Aparecem na vitrine (`Agent.differentiators`) e no find_solver. Pacote v0 não tem (lista vazia).
// Custo: o catálogo público chama isto por pacote, e rodar o validador inteiro lê a pasta toda. Por isso (1) o validador
// recebe uma visão enxuta do pacote (manifesto, etapas e só o front-matter do conhecimento: é só o que os diferenciais
// leem; evals, templates e o corpo do conhecimento ficam de fora) e (2) o resultado fica em cache por identidade do
// pacote (id, versão e carimbo do manifest.json), que sobrevive a `reloadPackages()`, por 12 h porque `liveData`
// depende da data de hoje.

const TTL_MS = 12 * 3600_000;
const MAX_ENTRIES = 500;
const byIdentity = new Map<string, { at: number; value: string[] }>();
const identityOf = new WeakMap<SolverPackage, string>();

function keyOf(pkg: SolverPackage): string {
  let key = identityOf.get(pkg);
  if (key) return key;
  let stamp = "?";
  try {
    const st = statSync(join(pkg.dir, "manifest.json"));
    stamp = `${Math.trunc(st.mtimeMs)}:${st.size}`;
  } catch {
    // sem manifest.json legível: a chave cai no objeto (o validador vai falhar do mesmo jeito)
  }
  key = `${pkg.manifest.id}|${pkg.manifest.version}|${pkg.source ?? "agents"}|${stamp}`;
  identityOf.set(pkg, key);
  return key;
}

/** Só o bloco de front-matter de um arquivo de conhecimento (o resto é corpo, que os diferenciais não leem). */
export function frontMatterHead(text: string): string {
  if (!/^---[ \t]*\r?\n/.test(text)) return "";
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*\r?$/.test(lines[i]!)) return `${lines.slice(0, i + 1).join("\n")}\n`;
  }
  return text; // front-matter sem fechamento: o validador precisa vê-lo inteiro para dar o mesmo veredito
}

/** Visão enxuta da pasta do pacote para o cálculo dos diferenciais (mesmas entradas, leitura só do que importa). */
export function differentiatorsInput(full: PackageInput): PackageInput {
  return {
    entries: full.entries,
    read: (path) => {
      if (path === "manifest.json" || path.startsWith("steps/")) return full.read(path);
      if (path.startsWith("knowledge/") && !path.endsWith(".meta.json")) {
        const raw = full.read(path);
        if (!raw) return undefined;
        return path.endsWith(".md") ? new TextEncoder().encode(frontMatterHead(new TextDecoder().decode(raw))) : new Uint8Array();
      }
      return undefined;
    },
  };
}

export function provenDifferentiators(pkg: SolverPackage | undefined, now = new Date()): string[] {
  if (!pkg || pkg.manifest.specVersion !== 1) return [];
  const key = keyOf(pkg);
  const hit = byIdentity.get(key);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.value;
  let value: string[] = [];
  try {
    // Pacote de criador vale pelas regras de terceiros (sem "verifier"); o da plataforma, pelas da plataforma.
    value = validatePackage(differentiatorsInput(packageFromFolder(pkg.dir)), { mode: pkg.source === "published" ? "third_party" : "platform", now }).stats.differentiators;
  } catch (e) {
    console.error(`[runtime] não consegui calcular os diferenciais de ${pkg.manifest.slug}:`, (e as Error).message);
  }
  if (byIdentity.size >= MAX_ENTRIES) byIdentity.clear();
  byIdentity.set(key, { at: now.getTime(), value });
  return value;
}

/** Para testes: esvazia o cache. */
export function clearDifferentiatorsCache(): void {
  byIdentity.clear();
}

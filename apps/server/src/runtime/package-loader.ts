import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Manifest } from "./manifest.js";
import { resolveInsidePackage } from "./package-paths.js";

// Leitura de UM pacote do disco e registro no mapa de pacotes (INSTRUCTIONS.md 5.4 e 6). Sem env/banco:
// testado em test/packages.test.ts. O cache e a pasta raiz ficam em packages.ts.

export type SolverPackage = {
  manifest: Manifest;
  dir: string;
  steps: { title: string; body: string; gate: string[] }[];
  versionHash: string;
  evalReport: { scoreBps: number; hash: string } | null;
  usesMemory: boolean;
};

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = lstatSync(full);
    // Link simbólico entraria no hash (e numa leitura futura) apontando para fora da pasta.
    if (st.isSymbolicLink()) throw new Error(`link simbólico não é permitido no pacote: ${relative(dir, full)}`);
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

export function loadPackage(dir: string): SolverPackage {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const steps = manifest.steps.map((s, i) => {
    // O caminho vem do manifesto: nunca junta direto (../ e links simbólicos escapariam da pasta).
    const body = readFileSync(resolveInsidePackage(dir, s.file, ["steps/"]), "utf8");
    const title = s.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? `Etapa ${i + 1}`;
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
  return { manifest, dir, steps, versionHash: packageHash(dir), evalReport, usesMemory };
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

/** Carrega todos os pacotes de uma pasta raiz (um por subpasta com manifest.json). Pacote inválido ou em colisão é pulado e registrado. */
export function loadAll(root: string, onError: (dir: string, e: Error) => void = () => undefined): Map<string, SolverPackage> {
  const registry = new Map<string, SolverPackage>();
  if (!existsSync(root)) return registry;
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    try {
      registerPackage(registry, loadPackage(dir));
    } catch (e) {
      onError(dir, e as Error);
    }
  }
  return registry;
}

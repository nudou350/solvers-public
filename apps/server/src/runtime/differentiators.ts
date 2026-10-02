import type { SolverPackage } from "./package-loader.js";
import { validatePackage } from "./validate/index.js";
import { packageFromFolder } from "./validate/input.js";

// Diferenciais COMPROVADOS de um pacote v1 (PACKAGE_SPEC.md 4.2 e 20): o que o validador consegue conferir, não o que o
// criador declarou. Aparecem na vitrine (`Agent.differentiators`) e no find_solver. Pacote v0 não tem (lista vazia).
// Rodar o validador lê o pacote inteiro do disco: o resultado fica em cache (por objeto de pacote, e por 6 h porque
// `liveData` depende da data de hoje) e o cache cai sozinho quando `reloadPackages()` troca os pacotes.

const TTL_MS = 6 * 3600_000;
const cache = new WeakMap<SolverPackage, { at: number; value: string[] }>();

export function provenDifferentiators(pkg: SolverPackage | undefined, now = new Date()): string[] {
  if (!pkg || pkg.manifest.specVersion !== 1) return [];
  const hit = cache.get(pkg);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.value;
  let value: string[] = [];
  try {
    // Pacote de criador vale pelas regras de terceiros (sem "verifier"); o da plataforma, pelas da plataforma.
    value = validatePackage(packageFromFolder(pkg.dir), { mode: pkg.source === "published" ? "third_party" : "platform", now }).stats.differentiators;
  } catch (e) {
    console.error(`[runtime] não consegui calcular os diferenciais de ${pkg.manifest.slug}:`, (e as Error).message);
  }
  cache.set(pkg, { at: now.getTime(), value });
  return value;
}

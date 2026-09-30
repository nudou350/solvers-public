import { resolve } from "node:path";
import { env } from "../env.js";
import { loadAll, type SolverPackage } from "./package-loader.js";
import { Manifest } from "./manifest.js";

// Cache dos pacotes dos solvers lidos do disco (INSTRUCTIONS.md 5.4 e 6). No MVP o servidor lê
// agents/<slug>; o conteúdo das etapas nunca sai inteiro: só a etapa corrente é entregue.
// A leitura de cada pacote e as regras de colisão estão em package-loader.ts (sem env, testáveis).

export { Manifest };
export { loadPackage, packageHash, registerPackage, type SolverPackage } from "./package-loader.js";

let cache: Map<string, SolverPackage> | null = null;

export function agentsDir(): string {
  return resolve(process.cwd(), env.AGENTS_DIR);
}

/** Todos os pacotes, indexados por id e por slug (um único espaço de nomes). */
export function packages(): Map<string, SolverPackage> {
  if (cache) return cache;
  cache = loadAll(agentsDir(), (dir, e) => console.error(`[runtime] pacote inválido em ${dir}:`, e.message));
  return cache;
}

export function getPackage(idOrSlug: string): SolverPackage | undefined {
  return packages().get(idOrSlug);
}

export function reloadPackages() {
  cache = null;
  return packages();
}

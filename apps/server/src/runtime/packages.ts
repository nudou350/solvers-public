import { resolve } from "node:path";
import { env } from "../env.js";
import { loadAll, type SolverPackage } from "./package-loader.js";
import { Manifest } from "./manifest.js";

// Cache dos pacotes dos solvers lidos do disco (INSTRUCTIONS.md 5.4 e 6; PACKAGE_SPEC.md 15.1). O servidor mescla duas
// fontes: AGENTS_DIR (plataforma, agents/<slug>) e PUBLISHED_DIR (criadores, <slug>/, um ativo por slug). O conteúdo das
// etapas nunca sai inteiro: só a etapa corrente é entregue. A leitura de cada pacote e as regras de colisão estão em
// package-loader.ts (sem env, testáveis).

export { Manifest };
export { loadPackage, packageHash, registerPackage, type SolverPackage } from "./package-loader.js";

let cache: Map<string, SolverPackage> | null = null;
/** Erros da última carga (pacote inválido, id/slug duplicado, platform sem autorização): para log e diagnóstico. */
let lastErrors: { dir: string; message: string }[] = [];

export function agentsDir(): string {
  return resolve(process.cwd(), env.AGENTS_DIR);
}

export function publishedDir(): string {
  return resolve(process.cwd(), env.PUBLISHED_DIR);
}

/**
 * Todos os pacotes, indexados por id e por slug (um único espaço de nomes). A carga é sob demanda (na primeira
 * chamada, não na importação do módulo) e o hash de versão de cada pacote só é calculado quando alguém o lê.
 * `id`/`slug` duplicados, dentro de uma fonte ou entre as duas, NÃO sobrescrevem: o pacote que chegou depois é
 * recusado e reportado (a plataforma vem primeiro e sempre vence).
 */
export function packages(): Map<string, SolverPackage> {
  if (cache) return cache;
  const errors: { dir: string; message: string }[] = [];
  const onError = (dir: string, e: Error) => {
    errors.push({ dir, message: e.message });
    console.error(`[runtime] pacote inválido em ${dir}:`, e.message);
  };
  const registry = loadAll(agentsDir(), onError, { source: "agents" });
  // PUBLISHED_DIR pode não existir (nenhum criador publicou ainda): não é erro.
  loadAll(publishedDir(), onError, { source: "published", into: registry });
  lastErrors = errors;
  cache = registry;
  return cache;
}

export function packageLoadErrors(): readonly { dir: string; message: string }[] {
  packages();
  return lastErrors;
}

export function getPackage(idOrSlug: string): SolverPackage | undefined {
  return packages().get(idOrSlug);
}

/** Invalida o cache e recarrega do disco (chamado depois de publicar, atualizar ou suspender um pacote). */
export function reloadPackages(): Map<string, SolverPackage> {
  cache = null;
  return packages();
}

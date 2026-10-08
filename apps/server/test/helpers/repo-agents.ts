import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Pacotes de agents/ que só existem no repositório de trabalho: o export público leva apenas _exemplos e criador-de-solvers.
export const REPO_AGENTS = resolve(import.meta.dirname, "../../../../agents");
export const PAID_SLUGS = ["backend-node", "copy-marketing", "financas-pessoais", "frontend-react", "planejador-viagens", "planilhas-dados", "revisao-contratos", "ui-design"];

/** Opção `skip` do node:test para testes que leem os pacotes pagos (false quando todos estão presentes). */
export const SKIP_WITHOUT_PAID = PAID_SLUGS.every((s) => existsSync(join(REPO_AGENTS, s, "manifest.json")))
  ? false
  : "pacotes pagos de agents/ ausentes (export público)";

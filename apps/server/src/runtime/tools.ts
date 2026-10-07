import { z } from "zod";
import { badRequest } from "../lib/http.js";
import { runTests } from "../verifier/sandbox.js";
import type { SolverPackage } from "./packages.js";
import { a11yCheck, budgetSplit, contrastCheck, normalizeFiles } from "./tool-fns.js";
import { validatePackageTool } from "./validate-package-tool.js";

// Ferramentas de servidor declaradas no manifesto (run_tool). O valor do solver fica aqui:
// a IA do usuário não tem acesso a estas execuções sem a licença.

type Runner = (input: unknown) => Promise<unknown>;

// Funções puras (sem env/banco) ficam em tool-fns.ts; reexportadas para o verificador.
export { a11yCheck, contrastRatio } from "./tool-fns.js";

const dockerReactTest: Runner = async (input) => (await runTests(normalizeFiles(input))).report;
const a11y: Runner = async (input) => a11yCheck(normalizeFiles(input));
const contrast: Runner = async (input) => contrastCheck(input);
const budget: Runner = async (input) => budgetSplit(input);

// Runners internos (PACKAGE_SPEC.md 8.1): `builtin:<nome>` e os nomes antigos como alias. SÓ pacotes da plataforma
// (AGENTS_DIR) podem usá-los; um pacote de criador com runner interno é recusado em runServerTool.
const RUNNERS: Record<string, Runner> = {
  "builtin:docker-react-test": dockerReactTest,
  "builtin:a11y": a11y,
  "builtin:contrast": contrast,
  "builtin:budget": budget,
  "builtin:validate-package": async (input) => validatePackageTool(input),
  "docker:solvers-react-test": dockerReactTest,
  "node:a11y": a11y,
  "node:contrast": contrast,
  "node:budget": budget,
};

export async function runServerTool(pkg: SolverPackage, toolName: string, input: unknown) {
  const tool = pkg.manifest.tools.find((t) => t.name === toolName);
  if (!tool) {
    const names = pkg.manifest.tools.map((t) => t.name).join(", ") || "none";
    throw badRequest(`Tool "${toolName}" does not exist in this solver. Available: ${names}`);
  }
  const runner = RUNNERS[tool.runner];
  // Pacote de criador (PUBLISHED_DIR) nunca roda executor interno: monopolizaria o Docker ou a validação do servidor.
  if (!runner || pkg.source === "published") throw badRequest(`Runner ${tool.runner} is not available on this server`);
  try {
    return await runner(input);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw badRequest(`Invalid input for ${toolName}: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    throw e;
  }
}

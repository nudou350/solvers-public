import { z } from "zod";
import { badRequest } from "../lib/http.js";
import { runTests } from "../verifier/sandbox.js";
import type { SolverPackage } from "./packages.js";
import { a11yCheck, budgetSplit, contrastCheck, normalizeFiles } from "./tool-fns.js";

// Ferramentas de servidor declaradas no manifesto (run_tool). O valor do solver fica aqui:
// a IA do usuário não tem acesso a estas execuções sem a licença.

type Runner = (input: unknown) => Promise<unknown>;

// Funções puras (sem env/banco) ficam em tool-fns.ts; reexportadas para o verificador.
export { a11yCheck, contrastRatio } from "./tool-fns.js";

const RUNNERS: Record<string, Runner> = {
  "docker:solvers-react-test": async (input) => (await runTests(normalizeFiles(input))).report,
  "node:a11y": async (input) => a11yCheck(normalizeFiles(input)),
  "node:contrast": async (input) => contrastCheck(input),
  "node:budget": async (input) => budgetSplit(input),
};

export async function runServerTool(pkg: SolverPackage, toolName: string, input: unknown) {
  const tool = pkg.manifest.tools.find((t) => t.name === toolName);
  if (!tool) {
    const names = pkg.manifest.tools.map((t) => t.name).join(", ") || "nenhuma";
    throw badRequest(`Ferramenta "${toolName}" não existe neste solver. Disponíveis: ${names}`);
  }
  const runner = RUNNERS[tool.runner];
  if (!runner) throw badRequest(`Executor ${tool.runner} indisponível neste servidor`);
  try {
    return await runner(input);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw badRequest(`Entrada inválida para ${toolName}: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    throw e;
  }
}

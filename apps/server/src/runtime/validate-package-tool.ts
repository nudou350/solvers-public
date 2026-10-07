import { z } from "zod";
import { badRequest } from "../lib/http.js";
import { validatePackage, type Issue, type PackageInput, type ValidationResult } from "./validate/index.js";

// Ferramenta `builtin:validate-package` do Criador de Solvers (PACKAGE_SPEC.md 13 e 19): a IA do criador manda o
// manifesto, o texto das etapas, a lista de arquivos e o começo do conhecimento; o servidor monta um pacote em memória
// e roda o MESMO validador do upload, no modo de terceiros. Valida MANIFESTO e ETAPAS (e templates/casos de eval, se
// vierem com conteúdo); a validação completa (chunks do conhecimento, ZIP) só existe no upload ou no script.
// Puro (sem env, banco ou rede): testado em test/validate-package-tool.test.ts.

/** Teto do corpo da chamada (o mesmo do /mcp). */
export const MAX_INPUT_BYTES = 1_000_000;

/** `min_price` da config on-chain hoje (5 USDC); o upload confere com o valor real da cadeia. */
const MIN_PRICE_USDC = 5;

const Path = z.string().min(1).max(200);

export const ValidatePackageInput = z
  .object({
    manifest: z.record(z.unknown()),
    steps: z.array(z.object({ file: Path, content: z.string().max(200_000) })).max(20).default([]),
    /** Lista completa de arquivos do pacote com o tamanho em bytes (sem conteúdo). */
    files: z.array(z.object({ path: Path, size: z.number().int().min(0) })).max(2000).optional(),
    /** Começo (cabeçalho e primeiras linhas) de cada arquivo de conhecimento. */
    knowledge: z.array(z.object({ path: Path, head: z.string().max(20_000) })).max(500).optional(),
    templates: z.array(z.object({ path: Path, content: z.string().max(100_000) })).max(50).optional(),
    evals: z.array(z.object({ path: Path, content: z.string().max(20_000) })).max(100).optional(),
  })
  .strict();
export type ValidatePackageInput = z.infer<typeof ValidatePackageInput>;

export type ValidatePackageOutput = {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  stats: ValidationResult["stats"];
  /** Em inglês, curta: o que corrigir primeiro. */
  summary: string;
};

const enc = new TextEncoder();

/** Monta o pacote em memória. Caminho repetido entre as listas de conteúdo é erro de uso (a IA mandou o mesmo arquivo duas vezes). */
export function buildPackage(input: ValidatePackageInput): PackageInput {
  const contents = new Map<string, Uint8Array>();
  const put = (path: string, text: string) => {
    if (contents.has(path)) throw badRequest(`The file ${path} appeared more than once in the input (steps, knowledge, templates and evals can't repeat a path).`);
    contents.set(path, enc.encode(text));
  };
  put("manifest.json", JSON.stringify(input.manifest));
  for (const s of input.steps) put(s.file, s.content);
  for (const k of input.knowledge ?? []) put(k.path, k.head);
  for (const t of input.templates ?? []) put(t.path, t.content);
  for (const e of input.evals ?? []) put(e.path, e.content);

  // `files` dá o tamanho real de cada arquivo (inclusive os que só vieram como lista); sem ele, vale o tamanho do conteúdo recebido.
  const sizes = new Map<string, number>();
  for (const f of input.files ?? []) {
    if (sizes.has(f.path)) throw badRequest(`The file ${f.path} is repeated in files.`);
    sizes.set(f.path, f.size);
  }
  const entries = new Map<string, number>(sizes);
  for (const [path, bytes] of contents) if (!entries.has(path)) entries.set(path, bytes.byteLength);
  // O manifesto vai sempre como arquivo, mesmo que `files` não o liste.
  return { entries: [...entries].map(([path, size]) => ({ path, size })), read: (path) => contents.get(path) };
}

/** Códigos que só fazem sentido com a informação completa (ZIP, conhecimento inteiro, evals): saem quando a entrada não a traz. */
function outOfScope(code: string, message: string, has: { files: boolean; knowledge: boolean; templates: boolean; evals: boolean }): boolean {
  if (/^ZIP_(TOO_LARGE|EXPANDS_TOO_MUCH|BAD_ROOT)$/.test(code)) return true;
  // Só o começo do conhecimento chega aqui: nem o tamanho em trechos nem o teto valem.
  if (code === "KNOWLEDGE_TOO_BIG") return true;
  if (code.startsWith("KNOWLEDGE_") && !has.knowledge) return true;
  if (code === "EVAL_TOO_FEW_CASES" && !has.evals) return true;
  if (code === "TEMPLATE_MISSING" && !has.files && !has.templates) return true;
  if (code === "CONTENTS_MISMATCH") {
    if (/base de conhecimento/.test(message) && !has.knowledge && !has.files) return true;
    if (/templates\/modelos/.test(message) && !has.files && !has.templates) return true;
  }
  return false;
}

/** Ordem de leitura: manifesto, termos, ferramentas, etapas, o resto. Dentro do grupo, a ordem do validador. */
function priority(code: string): number {
  if (code.startsWith("MANIFEST_")) return 0;
  if (code === "TERMS_MISSING") return 1;
  if (code.startsWith("TOOL_") || code.startsWith("TRIAL_")) return 2;
  if (code.startsWith("STEP_") || code.startsWith("GATE_")) return 3;
  return 4;
}

const SHOWN = 5;

/** Resumo curto em inglês: o que corrigir primeiro. Puro. */
export function summarize(errors: readonly Issue[], warnings: readonly Issue[], notes: readonly string[] = []): string {
  const tail = notes.length ? ` ${notes.join(" ")}` : "";
  if (errors.length === 0) {
    const w = warnings.length ? ` There ${warnings.length === 1 ? "is" : "are"} ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"} (the reviewer will read ${warnings.length === 1 ? "it" : "them"}).` : "";
    return `Manifest and steps have no errors.${w} The full validation (whole knowledge base, evals and ZIP) is still missing; it runs on upload through the site or with the solvers validate script.${tail}`;
  }
  const ordered = errors.map((e, i) => ({ e, i })).sort((a, b) => priority(a.e.code) - priority(b.e.code) || a.i - b.i).map((x) => x.e);
  const lines = ordered.slice(0, SHOWN).map((e, i) => `${i + 1}) ${e.code}${e.path ? ` at ${e.path}` : ""}: ${e.message}. Fix: ${e.fix}`);
  const more = ordered.length > SHOWN ? ` After fixing these, validate again (${ordered.length - SHOWN} left).` : " After fixing, validate again.";
  return `${errors.length} ${errors.length === 1 ? "error" : "errors"} to fix. Start with:\n${lines.join("\n")}${more}${tail}`;
}

/** Executa a validação do Criador. Entrada inválida vira ZodError (o executor responde 400 com o motivo). */
export function validatePackageTool(raw: unknown): ValidatePackageOutput {
  const input = ValidatePackageInput.parse(raw);
  const bytes = enc.encode(JSON.stringify(input)).byteLength;
  if (bytes > MAX_INPUT_BYTES) throw badRequest(`The input is ${bytes} bytes and the limit is ${MAX_INPUT_BYTES}. Send only the beginning of the knowledge files and validate the eval cases in another call.`);
  const has = { files: input.files !== undefined, knowledge: input.knowledge !== undefined, templates: input.templates !== undefined, evals: input.evals !== undefined };
  const result = validatePackage(buildPackage(input), { mode: "third_party", minPriceUsdc: MIN_PRICE_USDC });
  const keep = (i: Issue) => !outOfScope(i.code, i.message, has);
  const errors = result.errors.filter(keep);
  const warnings = result.warnings.filter(keep);
  const notes: string[] = [];
  if (!has.knowledge) notes.push("The knowledge base was not sent, so it was not checked.");
  if (!has.evals) notes.push("The eval cases were not sent, so they were not checked.");
  // Caminho curto (sem a pasta) é o erro mais comum de quem monta a entrada à mão: o arquivo entra, mas não conta como caso nem como conhecimento.
  if (input.evals?.length && !input.evals.some((e) => /^evals\/cases\/[^/]+\.json$/.test(e.path))) notes.push("No eval came with the full path evals/cases/NN-name.json, and only that counts as a test case.");
  if (input.knowledge?.length && !input.knowledge.some((k) => k.path.startsWith("knowledge/"))) notes.push("No knowledge file came with the full path knowledge/name.md, and only that is checked as knowledge.");
  return { ok: errors.length === 0, errors, warnings, stats: result.stats, summary: summarize(errors, warnings, notes) };
}

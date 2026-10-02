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
  /** Em português, curta: o que corrigir primeiro. */
  summary: string;
};

const enc = new TextEncoder();

/** Monta o pacote em memória. Caminho repetido entre as listas de conteúdo é erro de uso (a IA mandou o mesmo arquivo duas vezes). */
export function buildPackage(input: ValidatePackageInput): PackageInput {
  const contents = new Map<string, Uint8Array>();
  const put = (path: string, text: string) => {
    if (contents.has(path)) throw badRequest(`O arquivo ${path} veio mais de uma vez na entrada (steps, knowledge, templates e evals não podem repetir caminho).`);
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
    if (sizes.has(f.path)) throw badRequest(`O arquivo ${f.path} está repetido em files.`);
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

/** Resumo curto em português: o que corrigir primeiro. Puro. */
export function summarize(errors: readonly Issue[], warnings: readonly Issue[], notes: readonly string[] = []): string {
  const tail = notes.length ? ` ${notes.join(" ")}` : "";
  if (errors.length === 0) {
    const w = warnings.length ? ` Há ${warnings.length} ${warnings.length === 1 ? "aviso" : "avisos"} (o revisor vai ler).` : "";
    return `Manifesto e etapas sem erros.${w} Falta a validação completa (conhecimento inteiro, evals e ZIP), que roda no envio pelo site ou no script solvers validate.${tail}`;
  }
  const ordered = errors.map((e, i) => ({ e, i })).sort((a, b) => priority(a.e.code) - priority(b.e.code) || a.i - b.i).map((x) => x.e);
  const lines = ordered.slice(0, SHOWN).map((e, i) => `${i + 1}) ${e.code}${e.path ? ` em ${e.path}` : ""}: ${e.message}. Corrija: ${e.fix}`);
  const more = ordered.length > SHOWN ? ` Depois de corrigir estes, valide de novo (restam ${ordered.length - SHOWN}).` : " Depois de corrigir, valide de novo.";
  return `${errors.length} ${errors.length === 1 ? "erro" : "erros"} para corrigir. Comece por:\n${lines.join("\n")}${more}${tail}`;
}

/** Executa a validação do Criador. Entrada inválida vira ZodError (o executor responde 400 com o motivo). */
export function validatePackageTool(raw: unknown): ValidatePackageOutput {
  const input = ValidatePackageInput.parse(raw);
  const bytes = enc.encode(JSON.stringify(input)).byteLength;
  if (bytes > MAX_INPUT_BYTES) throw badRequest(`A entrada tem ${bytes} bytes e o limite é ${MAX_INPUT_BYTES}. Mande só o começo dos arquivos de conhecimento e valide os casos de eval em outra chamada.`);
  const has = { files: input.files !== undefined, knowledge: input.knowledge !== undefined, templates: input.templates !== undefined, evals: input.evals !== undefined };
  const result = validatePackage(buildPackage(input), { mode: "third_party", minPriceUsdc: MIN_PRICE_USDC });
  const keep = (i: Issue) => !outOfScope(i.code, i.message, has);
  const errors = result.errors.filter(keep);
  const warnings = result.warnings.filter(keep);
  const notes: string[] = [];
  if (!has.knowledge) notes.push("O conhecimento não foi enviado, então não foi conferido.");
  if (!has.evals) notes.push("Os casos de eval não foram enviados, então não foram conferidos.");
  return { ok: errors.length === 0, errors, warnings, stats: result.stats, summary: summarize(errors, warnings, notes) };
}

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { ManifestExtras, TemplateDecl } from "./package-loader.js";
import { resolveInsidePackage } from "./package-paths.js";

// Templates do pacote (PACKAGE_SPEC.md 7): `manifest.templates[]` declara nome, caminho, título e descrição; o que não
// está declarado não é entregue. Tipos do Núcleo: .md, .txt e .json (imagem, PDF e planilha só pelo site, na Abertura;
// .svg e .html são bloqueados). Sem env nem banco; testado em test/templates.test.ts.

export type { TemplateDecl } from "./package-loader.js";

/** Extensões que a tool `get_template` entrega como texto. */
export const TEMPLATE_TEXT_EXTS: readonly string[] = [".md", ".txt", ".json"];

/** Teto de um template entregue (são modelos curtos; o mesmo vale para o conteúdo que vai para a conversa). */
export const MAX_TEMPLATE_BYTES = 100_000;

/** O manifesto só pode listar o que o carregador entende; a lista vazia é o padrão. */
export function declaredTemplates(m: Pick<ManifestExtras, "templates">): TemplateDecl[] {
  return m.templates ?? [];
}

/** Nomes liberados no teste grátis (`trial.templates`; padrão nenhum). */
export function trialTemplateNames(m: { trial?: { templates?: string[] } }): string[] {
  return m.trial?.templates ?? [];
}

/** Templates que a sessão enxerga: todos, ou só os de `trial.templates` numa sessão de teste. */
export function visibleTemplates(decls: readonly TemplateDecl[], trial: { templates: string[] } | null): TemplateDecl[] {
  return trial ? decls.filter((t) => trial.templates.includes(t.name)) : [...decls];
}

export type TemplateLookup =
  | { ok: true; decl: TemplateDecl }
  | { ok: false; reason: "none_declared" | "unknown" | "not_in_trial" | "type_not_allowed" };

/** Procura o template pelo nome declarado. Nada fora de `templates[]`, e no teste só os de `trial.templates`. */
export function lookupTemplate(decls: readonly TemplateDecl[], name: string, trial: { templates: string[] } | null): TemplateLookup {
  if (decls.length === 0) return { ok: false, reason: "none_declared" };
  const decl = decls.find((t) => t.name === name);
  if (!decl) return { ok: false, reason: "unknown" };
  if (!TEMPLATE_TEXT_EXTS.includes(extname(decl.path).toLowerCase())) return { ok: false, reason: "type_not_allowed" };
  if (trial && !trial.templates.includes(decl.name)) return { ok: false, reason: "not_in_trial" };
  return { ok: true, decl };
}

/** Texto para a IA quando o pedido não pôde ser atendido (nome certo na próxima chamada). */
export function templateProblemText(reason: Exclude<TemplateLookup, { ok: true }>["reason"], name: string, available: readonly TemplateDecl[]): string {
  const list = available.map((t) => t.name).join(", ");
  switch (reason) {
    case "none_declared":
      return "This specialist has no templates.";
    case "unknown":
      return `There is no template "${name}" for this specialist.${list ? ` Available: ${list}.` : ""}`;
    case "type_not_allowed":
      return `The template "${name}" is not a text file (.md, .txt or .json) and can't be delivered here.`;
    case "not_in_trial":
      return `The template "${name}" is not part of the free trial.${list ? ` Available in the trial: ${list}.` : ""}`;
  }
}

/** Seção da visão geral (activate_solver): os templates que a sessão pode pedir, e quantos ficam só para a licença. */
export function templatesOverview(decls: readonly TemplateDecl[], trial: { templates: string[] } | null): string[] {
  if (decls.length === 0) return [];
  const visible = visibleTemplates(decls, trial);
  const locked = decls.length - visible.length;
  const lines = visible.map((t) => `- ${t.name}: ${t.title}. ${t.description}`);
  if (locked > 0) lines.push(`- (${locked} more ${locked === 1 ? "template" : "templates"} with the license only)`);
  if (visible.length === 0 && locked === 0) return [];
  return ["", "## Available templates (request the content with get_template)", ...lines];
}

/** Lê o arquivo do template de dentro da pasta do pacote (caminho já contido por package-paths; texto UTF-8, com teto). */
export function readTemplateFile(pkgDir: string, decl: TemplateDecl): string {
  const real = resolveInsidePackage(pkgDir, decl.path, ["templates/"]);
  const raw = readFileSync(real);
  if (raw.byteLength > MAX_TEMPLATE_BYTES) throw new Error(`template ${decl.name} passa de ${MAX_TEMPLATE_BYTES} bytes`);
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
}

/** Resposta da tool: o conteúdo fica intacto (um .json continua válido) e a marca d'água vai fora dele. */
export function renderTemplate(decl: TemplateDecl, content: string, watermark: string): string {
  const lang = extname(decl.path).toLowerCase() === ".json" ? "json" : "";
  // A cerca cresce até não colidir com crases dentro do conteúdo.
  let fence = "```";
  while (content.includes(fence)) fence += "`";
  return [`# Template: ${decl.title} (${decl.name})`, decl.description, "", `${fence}${lang}`, content.replace(/\s+$/, ""), fence, "", watermark].join("\n");
}

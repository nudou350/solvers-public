import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

// Contenção de caminhos escritos no manifesto (PACKAGE_SPEC.md 3.3). O carregador lia
// `join(dir, steps[].file)` sem conferir: um pacote com "../../../.env" entregaria o arquivo como etapa.

export class PackagePathError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "PackagePathError";
  }
}

/**
 * Motivo pelo qual `rel` não serve como caminho relativo dentro do pacote, ou null. Só olha o texto (sem disco):
 * o validador usa isto sobre o conteúdo de um ZIP, e `resolveInsidePackage` soma as checagens de disco.
 */
export function relativePathProblem(rel: string, allowedPrefixes: readonly string[]): string | null {
  if (typeof rel !== "string" || rel.length === 0) return "vazio";
  if (rel.length > 200) return "longo demais";
  if (/[\u0000-\u001f\\]/.test(rel)) return "tem caractere de controle ou barra invertida";
  if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("/")) return "não pode ser absoluto";
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return "não pode ter '.', '..' ou segmento vazio";
  if (!allowedPrefixes.some((p) => rel.startsWith(p))) return `precisa começar por ${allowedPrefixes.join(" ou ")}`;
  return null;
}

/**
 * Resolve `rel` (caminho do manifesto) dentro de `dir` e devolve o caminho real do arquivo.
 * Recusa: caminho absoluto, `..`, `.`, segmento vazio, `\`, caracteres de controle, prefixo fora de
 * `allowedPrefixes`, link simbólico em qualquer segmento e qualquer coisa que, resolvida, saia da pasta.
 */
export function resolveInsidePackage(dir: string, rel: string, allowedPrefixes: readonly string[]): string {
  const bad = (why: string) => new PackagePathError(`caminho "${rel}" inválido: ${why}`, rel);
  const textual = relativePathProblem(rel, allowedPrefixes);
  if (textual) throw bad(textual);
  const parts = rel.split("/");

  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    throw bad("pasta do pacote não existe");
  }
  let cur = root;
  for (const p of parts) {
    cur = join(cur, p);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      throw bad("arquivo não existe no pacote");
    }
    if (st.isSymbolicLink()) throw bad("link simbólico não é permitido");
  }
  const real = realpathSync(cur);
  const fromRoot = relative(root, real);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw bad("sai da pasta do pacote");
  return real;
}

import type { PackageEntry, PackageInput } from "../runtime/validate/index.js";

// Utilidades comuns da revisão (varreduras, diff e hash): quais arquivos do pacote contam e como ler o texto. Puro.

/** Lixo de sistema que a extração do ZIP descarta (PACKAGE_SPEC.md 3.2). */
export function isJunkPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return path.startsWith("__MACOSX/") || base === ".DS_Store" || base === "Thumbs.db";
}

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

/** Extensões lidas como texto pela revisão (a Abertura acrescenta html e csv). */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".txt", ".json", ".html", ".htm", ".csv"]);

export const isTextPath = (path: string) => TEXT_EXTENSIONS.has(extOf(path));

/** Arquivos do pacote sem lixo de sistema e sem links simbólicos, em ordem alfabética estável. */
export function reviewableEntries(input: PackageInput): PackageEntry[] {
  return input.entries
    .filter((e) => !e.isSymlink && !isJunkPath(e.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Texto UTF-8 do arquivo (bytes inválidos viram U+FFFD: a revisão nunca falha por isso; o validador é quem recusa). */
export function readText(input: PackageInput, path: string): string | null {
  const bytes = input.read(path);
  return bytes ? new TextDecoder("utf-8").decode(bytes) : null;
}

/** CRLF vira LF, como no hash do pacote (checkout no Windows e na VPS precisam dar o mesmo resultado). */
export const normalizeEol = (s: string) => s.replace(/\r\n/g, "\n");

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// Disco da publicação (PACKAGE_SPEC.md 15.1): pasta extraída da submissão -> PUBLISHED_DIR/<slug> por `rename`, com a
// versão anterior indo para _archive/<slug>/<version>/. Só `node:fs`: testado em test/publish-fs.test.ts.

/** Pasta do pacote dentro da pasta extraída: ela mesma (tem manifest.json) ou a única subpasta que o tem (raiz do ZIP). */
export function findPackageRoot(extracted: string): string {
  if (!existsSync(extracted)) throw new Error(`pasta extraída não encontrada: ${extracted}`);
  if (existsSync(join(extracted, "manifest.json"))) return extracted;
  const candidates = readdirSync(extracted)
    .filter((n) => !n.startsWith(".") && n !== "__MACOSX")
    .map((n) => join(extracted, n))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, "manifest.json")));
  if (candidates.length !== 1) throw new Error(`não achei um único manifest.json em ${extracted} (${candidates.length} candidatos)`);
  return candidates[0]!;
}

/** Copia o pacote para `<parent>/<slug>` (o nome da pasta é o slug: o carregador confere). Refaz a cópia se já existir. */
export function stagePackage(srcRoot: string, parent: string, slug: string): string {
  const dest = join(parent, slug);
  mkdirSync(parent, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(srcRoot, dest, { recursive: true, errorOnExist: true });
  return dest;
}

/** `version` do manifest.json de uma pasta publicada (null se ilegível). */
export function publishedVersionOf(dir: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/** `id` e `version` do manifest.json de uma pasta publicada (null se ilegível). */
export function publishedIdentityOf(dir: string): { id: string | null; version: string | null } | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { id?: unknown; version?: unknown };
    return { id: typeof m.id === "string" && m.id ? m.id : null, version: typeof m.version === "string" && m.version ? m.version : null };
  } catch {
    return null;
  }
}

/** Nome livre dentro do arquivo morto (nunca sobrescreve uma versão já arquivada). */
function freeArchiveDir(archiveRoot: string, slug: string, version: string): string {
  let dest = join(archiveRoot, slug, version);
  for (let n = 1; existsSync(dest); n++) dest = join(archiveRoot, slug, `${version}-${n}`);
  return dest;
}

/**
 * Coloca `staged` em `<published>/<slug>`. Se já há um pacote ali, ele vai antes para `<published>/_archive/<slug>/<version>/`.
 * Ambos os passos são `rename` no mesmo volume (a pasta de preparo fica dentro de `published`). Devolve onde a versão
 * anterior foi parar (null se não havia). Não confere hash: o chamador já conferiu `staged` antes.
 */
export function swapInPublished(published: string, slug: string, staged: string, expectAgentId?: string): { archivedTo: string | null } {
  const target = join(published, slug);
  let archivedTo: string | null = null;
  if (existsSync(target)) {
    // Última defesa: nunca arquiva (nem substitui) a pasta de OUTRO Solver que ocupa este slug.
    const current = publishedIdentityOf(target);
    if (expectAgentId && current?.id && current.id !== expectAgentId) throw new Error("a pasta publicada deste slug pertence a outro Solver");
    const version = publishedVersionOf(target) ?? `desconhecida-${Date.now()}`;
    archivedTo = freeArchiveDir(join(published, "_archive"), slug, version);
    mkdirSync(join(archivedTo, ".."), { recursive: true });
    renameSync(target, archivedTo);
  }
  renameSync(staged, target);
  return { archivedTo };
}

/** Pasta de preparo de uma finalização (dentro de PUBLISHED_DIR, mesmo volume; oculta, o carregador ignora). */
export function incomingParent(published: string, submissionId: string): string {
  return join(published, ".incoming", submissionId);
}

/** Limpa a pasta de preparo (sucesso ou desistência). */
export function cleanIncoming(published: string, submissionId: string): void {
  rmSync(incomingParent(published, submissionId), { recursive: true, force: true });
}

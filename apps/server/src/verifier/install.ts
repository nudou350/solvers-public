import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomId } from "../lib/crypto.js";

// Instalação atômica (com desfazer) da entrega aprovada. Sem env/banco: testável sozinha.

function writeTree(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export type Installed = {
  dir: string;
  /** Restaura exatamente a entrega e a prévia que estavam antes (nada desta tentativa fica). */
  undo: () => void;
  /** Descarta os backups: a nova entrega é a definitiva. */
  commit: () => void;
};

/**
 * Coloca a entrega aprovada no lugar: monta tudo numa pasta temporária da própria tentativa e só
 * então troca por rename. A entrega e a prévia anteriores ficam de backup até `commit()`, e
 * `undo()` as devolve (usado quando a cadeia ficou com outra entrega).
 */
export function installDeliverable(mdir: string, files: Record<string, string>, previewHtml: string | null): Installed {
  const id = randomId(6);
  const stage = join(mdir, `.stage-${id}`);
  const oldFiles = join(mdir, `.old-${id}`);
  const oldPreview = join(mdir, `.old-${id}.html`);
  const dir = join(mdir, "files");
  const previewFile = join(mdir, "preview.html");
  let hadFiles = false;
  let hadPreview = false;
  const restore = () => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(previewFile, { force: true });
    if (hadFiles) renameSync(oldFiles, dir);
    if (hadPreview) renameSync(oldPreview, previewFile);
  };
  try {
    writeTree(join(stage, "files"), files);
    if (previewHtml) writeFileSync(join(stage, "preview.html"), previewHtml);
    hadFiles = existsSync(dir);
    hadPreview = existsSync(previewFile);
    if (hadFiles) renameSync(dir, oldFiles);
    if (hadPreview) renameSync(previewFile, oldPreview);
    try {
      renameSync(join(stage, "files"), dir);
      if (previewHtml) renameSync(join(stage, "preview.html"), previewFile);
    } catch (e) {
      restore();
      throw e;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return {
    dir,
    undo: restore,
    commit: () => {
      rmSync(oldFiles, { recursive: true, force: true });
      rmSync(oldPreview, { force: true });
    },
  };
}


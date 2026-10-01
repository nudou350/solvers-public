import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageInput } from "./index.js";

// Monta a entrada do validador a partir de uma pasta no disco ou de arquivos em memória (ex.: JSON vindo do MCP).

/** Pasta do pacote no disco (caminhos relativos com `/`). Links simbólicos entram marcados, nunca são seguidos. */
export function packageFromFolder(dir: string): PackageInput {
  const entries: PackageInput["entries"] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel))) {
      if (name === "node_modules" || name === ".git") continue;
      const relPath = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, relPath));
      if (st.isSymbolicLink()) entries.push({ path: relPath, size: 0, isSymlink: true });
      else if (st.isDirectory()) walk(relPath);
      else entries.push({ path: relPath, size: st.size });
    }
  };
  walk("");
  return {
    entries,
    read: (path) => {
      try {
        return readFileSync(join(dir, path));
      } catch {
        return undefined;
      }
    },
  };
}

/** Arquivos em memória: { "manifest.json": "...", "steps/01.md": "..." }. */
export function packageFromMemory(files: Record<string, string | Uint8Array>): PackageInput {
  const bytes = new Map(Object.entries(files).map(([p, c]) => [p, typeof c === "string" ? new TextEncoder().encode(c) : c]));
  return {
    entries: [...bytes].map(([path, b]) => ({ path, size: b.byteLength })),
    read: (path) => bytes.get(path),
  };
}

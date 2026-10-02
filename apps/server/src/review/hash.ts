import { createHash } from "node:crypto";
import type { PackageInput } from "../runtime/validate/index.js";

// Hash do pacote a partir de um PackageInput (ZIP extraído em memória ou pasta). É o MESMO algoritmo de
// `packageHash(dir)` em runtime/package-loader.ts, que vira o `versionHash` on-chain: sha256 sobre (caminho + "\0" +
// sha256 do conteúdo) de todos os arquivos em ordem alfabética, com CRLF normalizado nas extensões de texto, sem
// `evals/report.json`, sem `node_modules` nem nomes começando com ponto. Se um mudar, o outro muda junto (teste em
// test/review-hash.test.ts compara os dois nos pacotes de agents/).

const TEXT_FILE = /\.(md|json|tsx?|jsx?|css|txt|ya?ml)$/;

export function packageHashOf(input: PackageInput): string {
  const files: string[] = [];
  for (const e of input.entries) {
    // Link simbólico entraria no hash apontando para fora da pasta: recusa, como o carregador do disco.
    if (e.isSymlink) throw new Error(`link simbólico não é permitido no pacote: ${e.path}`);
    const segments = e.path.split("/");
    if (segments.some((s) => s === "node_modules" || s.startsWith("."))) continue;
    if (e.path === "evals/report.json") continue;
    files.push(e.path);
  }
  files.sort();
  const h = createHash("sha256");
  for (const rel of files) {
    const raw = input.read(rel);
    if (!raw) throw new Error(`arquivo ausente na entrada do hash: ${rel}`);
    const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    const content = TEXT_FILE.test(rel) ? Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n")) : buf;
    h.update(rel);
    h.update("\0");
    h.update(createHash("sha256").update(content).digest());
  }
  return h.digest("hex");
}

import type { SubmissionFileEntry } from "@solvers/shared";
import type { PackageInput } from "../runtime/validate/index.js";
import { extOf, isTextPath, normalizeEol, reviewableEntries } from "./files.js";

// Diff do pacote contra a versão publicada (PACKAGE_SPEC.md 14.5, item 3): status de TODOS os arquivos (inclusive
// conhecimento) e diff unificado de texto, com teto por arquivo e no total para a tela nunca receber megabytes.
// Puro. O texto sai como texto: a tela o exibe escapado, nunca como HTML.

/** Teto de linhas do diff por arquivo e no pacote inteiro. */
export const DIFF_MAX_LINES_PER_FILE = 400;
export const DIFF_MAX_LINES_TOTAL = 2000;
/** Arquivo de texto acima disto não entra no diff linha a linha. */
const DIFF_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Distância de edição máxima do algoritmo (acima disso o miolo vira "tudo removido, tudo adicionado"). */
const MYERS_MAX_D = 1500;
const CONTEXT = 3;

export type ChangedFile = { path: string; unified: string; truncated: boolean };
export type PackageDiff = {
  files: SubmissionFileEntry[];
  /** Arquivos com diff (added, removed ou changed), os mais importantes primeiro: manifesto, etapas, templates... */
  changed: ChangedFile[];
  /** Algum diff foi cortado pelo teto por arquivo ou pelo total. */
  truncated: boolean;
};

type Op = { t: " " | "-" | "+"; s: string };

/** Diff de linhas (Myers). Tira o prefixo e o sufixo iguais antes; passando de MYERS_MAX_D, troca o miolo inteiro. */
export function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: Op[] = a.slice(0, start).map((s) => ({ t: " ", s }));
  const tail: Op[] = a.slice(endA).map((s) => ({ t: " ", s }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const mid = midA.length === 0 ? midB.map((s): Op => ({ t: "+", s })) : midB.length === 0 ? midA.map((s): Op => ({ t: "-", s })) : (myers(midA, midB) ?? [...midA.map((s): Op => ({ t: "-", s })), ...midB.map((s): Op => ({ t: "+", s }))]);
  return [...head, ...mid, ...tail];
}

function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MYERS_MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const out: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[off + k - 1]! < vd[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ t: " ", s: a[x - 1]! });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ t: "+", s: b[prevY]! });
      else out.push({ t: "-", s: a[prevX]! });
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

/** Linhas do arquivo: sem a linha vazia fantasma depois do último "\n". */
const toLines = (s: string): string[] => {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** Hunks no formato unificado (3 linhas de contexto), sem cabeçalho de arquivo. Vazio se não há mudança de linha. */
export function unifiedHunks(ops: Op[]): string[] {
  const aBefore: number[] = [0];
  const bBefore: number[] = [0];
  for (const o of ops) {
    aBefore.push(aBefore[aBefore.length - 1]! + (o.t !== "+" ? 1 : 0));
    bBefore.push(bBefore[bBefore.length - 1]! + (o.t !== "-" ? 1 : 0));
  }
  const out: string[] = [];
  let i = 0;
  while (i < ops.length) {
    let c = i;
    while (c < ops.length && ops[c]!.t === " ") c++;
    if (c >= ops.length) break;
    const from = Math.max(i, c - CONTEXT);
    let last = c;
    for (let j = c; j < ops.length; j++) {
      if (ops[j]!.t !== " ") last = j;
      else if (j - last > 2 * CONTEXT) break;
    }
    const to = Math.min(ops.length, last + CONTEXT + 1);
    const aCount = aBefore[to]! - aBefore[from]!;
    const bCount = bBefore[to]! - bBefore[from]!;
    const aStart = aCount === 0 ? aBefore[from]! : aBefore[from]! + 1;
    const bStart = bCount === 0 ? bBefore[from]! : bBefore[from]! + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (let j = from; j < to; j++) out.push(`${ops[j]!.t}${ops[j]!.s}`);
    i = to;
  }
  return out;
}

/** Texto comparável: CRLF normalizado e, em JSON válido e de tamanho razoável, indentado (manifesto minificado vira diff legível). */
function comparable(path: string, bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const text = normalizeEol(new TextDecoder("utf-8").decode(bytes));
  if (extOf(path) === ".json" && text.length <= 1024 * 1024) {
    try {
      return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
    } catch {
      return text;
    }
  }
  return text;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

function rank(path: string): number {
  if (path === "manifest.json") return 0;
  if (path.startsWith("steps/")) return 1;
  if (path.startsWith("templates/")) return 2;
  if (path === "README.md") return 3;
  if (path.startsWith("evals/")) return 4;
  if (path.startsWith("knowledge/")) return 5;
  return 6;
}

/** Diff unificado de um arquivo (cabeçalho + hunks), sem o corte de tamanho. `null` do lado ausente = arquivo novo ou removido. */
function fileDiffLines(path: string, prev: Uint8Array | null, next: Uint8Array | null): { lines: string[] } {
  const header = [`--- ${prev ? `a/${path}` : "/dev/null"}`, `+++ ${next ? `b/${path}` : "/dev/null"}`];
  const big = Math.max(prev?.byteLength ?? 0, next?.byteLength ?? 0) > DIFF_MAX_FILE_BYTES;
  if (!isTextPath(path) || big) {
    const why = big ? `arquivo de texto grande demais para o diff (${Math.max(prev?.byteLength ?? 0, next?.byteLength ?? 0)} bytes)` : "arquivo binário";
    const what = !prev ? "adicionado" : !next ? "removido" : "alterado";
    return { lines: [...header, `(${why}: ${what}; tamanho ${prev?.byteLength ?? 0} -> ${next?.byteLength ?? 0} bytes)`] };
  }
  const a = prev ? comparable(path, prev) : "";
  const b = next ? comparable(path, next) : "";
  if (a === null || b === null) return { lines: [...header, "(conteúdo binário: não exibido)"] };
  const hunks = unifiedHunks(diffLines(toLines(a), toLines(b)));
  if (hunks.length === 0) return { lines: [...header, "(sem diferença de linhas: só espaços ou quebras de linha)"] };
  return { lines: [...header, ...hunks] };
}

/** Compara o pacote novo com o publicado (`prev` null = 1ª versão: tudo "added"). */
export function diffPackages(prev: PackageInput | null, next: PackageInput): PackageDiff {
  const prevBytes = new Map<string, Uint8Array>();
  if (prev) for (const e of reviewableEntries(prev)) prevBytes.set(e.path, prev.read(e.path) ?? new Uint8Array());
  const nextBytes = new Map<string, Uint8Array>();
  for (const e of reviewableEntries(next)) nextBytes.set(e.path, next.read(e.path) ?? new Uint8Array());

  const paths = [...new Set([...prevBytes.keys(), ...nextBytes.keys()])].sort();
  const files: SubmissionFileEntry[] = [];
  const todo: { path: string; prev: Uint8Array | null; next: Uint8Array | null }[] = [];
  for (const path of paths) {
    const p = prevBytes.get(path) ?? null;
    const n = nextBytes.get(path) ?? null;
    let diff: SubmissionFileEntry["diff"];
    if (!p) diff = "added";
    else if (!n) diff = "removed";
    else if (sameBytes(p, n) || (/\.(md|json|txt)$/.test(path) && comparableEqual(p, n))) diff = "same";
    else diff = "changed";
    files.push({ path, size: (n ?? p)!.byteLength, diff });
    if (diff !== "same") todo.push({ path, prev: p, next: n });
  }

  todo.sort((x, y) => rank(x.path) - rank(y.path) || (x.path < y.path ? -1 : 1));
  const changed: ChangedFile[] = [];
  let remaining = DIFF_MAX_LINES_TOTAL;
  let truncated = false;
  for (const t of todo) {
    if (remaining <= 0) {
      changed.push({ path: t.path, unified: `(omitido: o diff do pacote passou do teto de ${DIFF_MAX_LINES_TOTAL} linhas)`, truncated: true });
      truncated = true;
      continue;
    }
    const { lines } = fileDiffLines(t.path, t.prev, t.next);
    const budget = Math.min(DIFF_MAX_LINES_PER_FILE, remaining);
    if (lines.length > budget) {
      const omitted = lines.length - budget;
      changed.push({ path: t.path, unified: [...lines.slice(0, budget), `… diff truncado: mais ${omitted} linha(s) não exibida(s)`].join("\n"), truncated: true });
      remaining -= budget;
      truncated = true;
    } else {
      changed.push({ path: t.path, unified: lines.join("\n"), truncated: false });
      remaining -= lines.length;
    }
  }
  return { files, changed, truncated };
}

/** Texto igual a menos de CRLF/LF (o hash do pacote já trata os dois como o mesmo conteúdo). */
function comparableEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.includes(0) || b.includes(0)) return false;
  const dec = new TextDecoder("utf-8");
  return normalizeEol(dec.decode(a)) === normalizeEol(dec.decode(b));
}

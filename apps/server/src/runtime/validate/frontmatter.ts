// Front-matter dos arquivos de conhecimento (PACKAGE_SPEC.md 6.2): um bloco `---` no topo com
// `chave: valor`. Parser mínimo de propósito (sem dependência de YAML): aceita texto, aspas e lista `[a, b]`.

export type FrontMatter = Record<string, string | string[]>;

export type FrontMatterResult =
  | { kind: "none"; body: string }
  | { kind: "ok"; data: FrontMatter; body: string }
  | { kind: "invalid"; error: string; body: string };

export function parseFrontMatter(text: string): FrontMatterResult {
  const src = text.replace(/^﻿/, "");
  if (!/^---[ \t]*\r?\n/.test(src)) return { kind: "none", body: src };
  const lines = src.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (end === -1) return { kind: "invalid", error: "bloco '---' aberto e não fechado", body: src };
  const body = lines.slice(end + 1).join("\n");
  const data: FrontMatter = {};
  for (let i = 1; i < end; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) return { kind: "invalid", error: `linha ${i + 1} não é 'chave: valor': ${raw.trim().slice(0, 60)}`, body };
    const key = m[1]!;
    const value = m[2]!.trim();
    if (key in data) return { kind: "invalid", error: `chave repetida: ${key}`, body };
    if (value.startsWith("[")) {
      if (!value.endsWith("]")) return { kind: "invalid", error: `lista sem ']' em ${key}`, body };
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  return { kind: "ok", data, body };
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) return s.slice(1, -1);
  return s;
}

/** `AAAA-MM-DD` de uma data que existe (2026-02-30 não vale). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

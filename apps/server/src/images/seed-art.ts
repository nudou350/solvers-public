import sharp from "sharp";

// Imagens de galeria geradas a partir do que o próprio pacote declara (nome, etapas, antes/depois, conteúdo).
// Não inventam resultado nenhum: são cartões de apresentação para a vitrine até o criador enviar capturas reais.
// Uso: `cli:images seed` (demo) e `cli:images preview <pasta>` (só grava os PNGs, sem banco nem CDN).

export type ArtInput = {
  name: string;
  tagline: string;
  category: string;
  version: string;
  creatorName: string;
  steps: { title: string; gate: string[] }[];
  beforeAfter: { prompt: string; withoutSolver: string; withSolver: string }[];
  packageContents: string[];
};

export const ART_W = 1440;
export const ART_H = 900;
const FONT = "DejaVu Sans, Segoe UI, Arial, sans-serif";
/** Largura média de um caractere em relação ao corpo da fonte (DejaVu é larga: 0,6 deixa folga). */
const CHAR_W = 0.6;

const HUE: Record<string, [string, string]> = {
  Desenvolvimento: ["#6d5cff", "#2dd4bf"],
  Design: ["#ec4899", "#f59e0b"],
  "Dia a dia": ["#f97316", "#a855f7"],
  Negócios: ["#22c55e", "#0ea5e9"],
  Viagens: ["#0ea5e9", "#6366f1"],
  Conteúdo: ["#f43f5e", "#f59e0b"],
  Escrita: ["#f43f5e", "#f59e0b"],
};
const accentOf = (category: string): [string, string] => HUE[category] ?? ["#6d5cff", "#2dd4bf"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // Corta na última palavra inteira (se ela não for quase a frase toda) para não terminar no meio de uma palavra.
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–]+$/, "")}…`;
}

/** Quebra em linhas de até `maxChars`; a última linha leva "…" se ainda sobrar texto além de `maxLines`. */
export function wrap(text: string, maxChars: number, maxLines = 99): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && `${cur} ${w}`.length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxChars);
    return kept;
  }
  return lines;
}

const charsFor = (widthPx: number, size: number) => Math.max(8, Math.floor(widthPx / (size * CHAR_W)));

function text(x: number, y: number, size: number, lines: string[], opts: { fill?: string; weight?: number; lh?: number } = {}): string {
  const { fill = "#fff", weight = 400, lh = 1.3 } = opts;
  return lines
    .map((l, i) => `<text x="${x}" y="${Math.round(y + i * size * lh)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`)
    .join("");
}

function frame(input: ArtInput, label: string, body: string, footer = true): string {
  const [a, b] = accentOf(input.category);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${ART_W} ${ART_H}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15122a"/><stop offset="1" stop-color="#0d1a24"/></linearGradient>
<linearGradient id="ac" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="glow" cx="0.85" cy="0.1" r="0.7"><stop offset="0" stop-color="${a}" stop-opacity="0.28"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${ART_W}" height="${ART_H}" fill="url(#bg)"/><rect width="${ART_W}" height="${ART_H}" fill="url(#glow)"/>
<rect x="0" y="0" width="${ART_W}" height="8" fill="url(#ac)"/>
${text(80, 84, 26, [label.toUpperCase()], { fill: "#a9a4c9", weight: 700 })}
${footer ? text(80, ART_H - 44, 24, [`${input.name} · por ${input.creatorName}`], { fill: "#8d89aa" }) : ""}
${body}
</svg>`;
}

function coverSlide(i: ArtInput): string {
  const [a] = accentOf(i.category);
  const title = wrap(i.name, charsFor(1100, 84), 2);
  const sub = wrap(i.tagline, charsFor(1100, 38), 3);
  const titleBottom = 290 + (title.length - 1) * 84 * 1.15;
  const subBottom = titleBottom + 100 + (sub.length - 1) * 38 * 1.4;
  const highlights = i.packageContents.slice(0, 3);
  let hy = Math.max(subBottom + 90, 560);
  const marks = highlights
    .map((h) => {
      const t = text(146, hy, 28, [truncate(h, 62)], { fill: "#e6e3f7" });
      const m = `<circle cx="102" cy="${hy - 9}" r="15" fill="url(#ac)"/>${text(94, hy - 1, 20, ["✓"], { fill: "#0d1a24", weight: 700 })}`;
      hy += 66;
      return m + t;
    })
    .join("");
  return frame(
    i,
    "Especialista para a sua IA",
    `<rect x="80" y="130" rx="22" ry="22" width="${Math.min(520, 70 + i.category.length * 17)}" height="52" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-opacity="0.7"/>
${text(106, 165, 26, [i.category], { fill: "#fff", weight: 700 })}
${text(80, 290, 84, title, { weight: 700, lh: 1.15 })}
${text(80, titleBottom + 100, 38, sub, { fill: "#cfcbe8", lh: 1.4 })}
${marks}
${text(80, ART_H - 44, 26, [`Versão ${i.version}  ·  funciona no Claude ou no ChatGPT  ·  por ${i.creatorName}`], { fill: "#a9a4c9" })}`,
    false,
  );
}

function stepsSlide(i: ArtInput): string {
  const many = i.steps.length >= 3;
  const rows = i.steps.slice(0, 5).map((s) => ({ title: s.title, sub: many ? s.gate.slice(0, 1) : s.gate.slice(0, 4) }));
  let y = 160;
  const out: string[] = [text(80, y, 56, ["Como funciona"], { weight: 700 })];
  y += 100;
  rows.forEach((r, idx) => {
    const t = wrap(r.title, charsFor(1160, 34), 2);
    out.push(`<circle cx="104" cy="${y - 11}" r="26" fill="url(#ac)"/>${text(94, y, 28, [String(idx + 1)], { weight: 700, fill: "#0d1a24" })}`);
    out.push(text(160, y, 34, t, { weight: 700, lh: 1.2 }));
    y += (t.length - 1) * 41;
    for (const g of r.sub) {
      const gl = wrap(`✓ ${g}`, charsFor(1160, 26), rows.length >= 5 ? 1 : 2);
      y += 46;
      out.push(text(160, y, 26, gl, { fill: "#b9b5d6", lh: 1.25 }));
      y += (gl.length - 1) * 32;
    }
    y += rows.length >= 5 ? 64 : many ? 78 : 70;
  });
  return frame(i, "O método", out.join(""));
}

function beforeAfterSlide(i: ArtInput): string {
  const ex = i.beforeAfter[0]!;
  const prompt = wrap(`“${truncate(ex.prompt, 150)}”`, charsFor(1280, 28), 2);
  const colW = 600;
  const cols = [
    { x: 80, head: "Sem o Solver", color: "#fb7185", body: truncate(ex.withoutSolver, 300) },
    { x: 760, head: "Com o Solver", color: "#34d399", body: truncate(ex.withSolver, 380) },
  ];
  const out: string[] = [text(80, 150, 40, ["Um exemplo real do criador"], { weight: 700 }), text(80, 215, 28, prompt, { fill: "#cfcbe8", lh: 1.3 })];
  for (const c of cols) {
    out.push(`<rect x="${c.x}" y="300" rx="24" ry="24" width="${colW}" height="480" fill="#ffffff" fill-opacity="0.06" stroke="${c.color}" stroke-opacity="0.6"/>`);
    out.push(text(c.x + 32, 354, 28, [c.head], { fill: c.color, weight: 700 }));
    out.push(text(c.x + 32, 410, 25, wrap(c.body, charsFor(colW - 64, 25), 11), { fill: "#e6e3f7", lh: 1.35 }));
  }
  return frame(i, "Antes e depois", out.join(""));
}

function contentsSlide(i: ArtInput): string {
  let y = 160;
  const out: string[] = [text(80, y, 56, ["O que vem no pacote"], { weight: 700 })];
  y += 84;
  for (const item of i.packageContents.slice(0, 7)) {
    const lines = wrap(item, charsFor(1180, 30), 2);
    out.push(`<circle cx="102" cy="${y - 10}" r="16" fill="url(#ac)"/>${text(94, y - 2, 20, ["✓"], { fill: "#0d1a24", weight: 700 })}`);
    out.push(text(146, y, 30, lines, { lh: 1.25 }));
    y += (lines.length - 1) * 37 + 76;
  }
  return frame(i, "Conteúdo", out.join(""));
}

/** Os cartões de galeria de um especialista, na ordem em que devem aparecer (a capa primeiro). */
export function gallerySvgs(i: ArtInput): { name: string; svg: string }[] {
  const slides = [{ name: "capa", svg: coverSlide(i) }];
  if (i.steps.length > 0) slides.push({ name: "metodo", svg: stepsSlide(i) });
  if (i.beforeAfter.length > 0) slides.push({ name: "antes-depois", svg: beforeAfterSlide(i) });
  if (i.packageContents.length > 0) slides.push({ name: "pacote", svg: contentsSlide(i) });
  return slides;
}

export async function renderPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

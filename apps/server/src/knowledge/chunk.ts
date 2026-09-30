// Corte do conhecimento em trechos (INSTRUCTIONS.md 5.5): ~500 tokens (~2000 caracteres) com
// sobreposição de ~50 tokens (~200 caracteres). Puro (sem env/banco): o validador estima a quantidade
// de chunks com esta mesma função, e a ingestão grava o resultado.

export const CHUNK_CHARS = 2000;
export const OVERLAP_CHARS = 200;

/** Quebra primeiro por seções (##), depois por parágrafos, mantendo o título da seção em cada trecho. */
export function chunkMarkdown(md: string): string[] {
  const sections = md.split(/\n(?=#{1,3} )/g).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const section of sections) {
    if (section.length <= CHUNK_CHARS) {
      out.push(section);
      continue;
    }
    const heading = /^#{1,3} .+$/m.exec(section)?.[0] ?? "";
    const paras = section.split(/\n{2,}/);
    let cur = "";
    for (const p of paras) {
      if (cur && cur.length + p.length + 2 > CHUNK_CHARS) {
        out.push(cur.trim());
        const tail = cur.slice(-OVERLAP_CHARS);
        cur = `${heading && !tail.startsWith(heading) ? `${heading}\n\n` : ""}…${tail}\n\n${p}`;
      } else {
        cur = cur ? `${cur}\n\n${p}` : p;
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

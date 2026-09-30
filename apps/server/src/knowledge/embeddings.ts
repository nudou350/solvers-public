import { env } from "../env.js";

// Embeddings locais (INSTRUCTIONS.md 5.5) com transformers.js e multilingual-e5-small (384 dims).
// O e5 espera os prefixos "query: " e "passage: ". Se o modelo não carregar, a busca cai no
// full text do Postgres (plano B) e nada quebra.

type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let extractor: Promise<Extractor | null> | null = null;
let loaded = false;

/** true quando o modelo já está pronto em memória (não bloqueia). */
export function embeddingsLoaded(): boolean {
  return loaded;
}

/** Carrega o modelo em segundo plano no boot. */
export function warmEmbeddings() {
  extractor ??= load();
  void extractor.then((x) => (loaded = x != null));
}
export const EMBEDDING_DIMS = 384;

async function load(): Promise<Extractor | null> {
  if (env.SEARCH_MODE === "fts") return null;
  try {
    const { pipeline } = await import("@huggingface/transformers");
    const pipe = (await pipeline("feature-extraction", env.EMBEDDING_MODEL, { dtype: "q8" })) as unknown as Extractor;
    console.log(`[embeddings] modelo ${env.EMBEDDING_MODEL} carregado`);
    return pipe;
  } catch (e) {
    console.warn("[embeddings] indisponível, usando busca full text:", (e as Error).message);
    return null;
  }
}

export function embeddingsReady(): Promise<boolean> {
  extractor ??= load();
  return extractor.then((x) => x != null);
}

export async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][] | null> {
  extractor ??= load();
  const ex = await extractor;
  if (!ex || texts.length === 0) return ex ? [] : null;
  const out: number[][] = [];
  // Lotes pequenos para não estourar memória na VPS.
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map((t) => `${kind}: ${t.slice(0, 2000)}`);
    const res = await ex(batch, { pooling: "mean", normalize: true });
    out.push(...res.tolist());
  }
  return out;
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => x.toFixed(6)).join(",")}]`;
}

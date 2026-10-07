import { resolveCatalogLang, type CatalogLang } from "@solvers/shared";

// Idioma dos textos de catálogo de uma requisição (sem express/banco: testado em test/catalog-lang.test.ts).
// `?lang=pt|en` vence; sem ele vale o Accept-Language; sem nenhum dos dois, inglês (o do manifest).

type ReqLike = { query?: Record<string, unknown>; headers?: Record<string, string | string[] | undefined> };
/** Resposta do express: a resposta depende do Accept-Language, então avisa caches com `Vary`. */
type ResLike = { vary(field: string): unknown };

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export function catalogLangOf(req: ReqLike, res?: ResLike): CatalogLang {
  res?.vary("Accept-Language");
  const accept = first(req.headers?.["accept-language"]);
  return resolveCatalogLang(first(req.query?.lang), typeof accept === "string" ? accept : undefined);
}

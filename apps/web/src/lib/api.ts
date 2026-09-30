import { createApi, type SolversApi } from "@solvers/api-client";

// Mesma origem: caminhos relativos (/api/...). Em dev o next.config encaminha para a 3017;
// em produção, o nginx. O cookie de sessão (httpOnly) vai junto.

const unauthorized = new Set<() => void>();

/**
 * Avisa quando alguma chamada recebe 401 no meio da sessão (cookie expirado ou apagado). As rotas de
 * /api/auth/ ficam de fora: a própria sessão as usa para descobrir se está logada.
 */
export function onUnauthorized(fn: () => void): () => void {
  unauthorized.add(fn);
  return () => {
    unauthorized.delete(fn);
  };
}

const watchedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/auth/")) unauthorized.forEach((fn) => fn());
  }
  return res;
};

export const api: SolversApi = createApi({ baseUrl: "", fetch: watchedFetch });

/**
 * Para componentes de servidor (catálogo público): o fetch do servidor precisa de URL absoluta.
 * API_INTERNAL_URL (produção: http://127.0.0.1:3017); padrão: a API local.
 */
export function serverApi(): SolversApi {
  return createApi({ baseUrl: process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3017" });
}

export { ApiError } from "@solvers/api-client";
export type { SolversApi } from "@solvers/api-client";

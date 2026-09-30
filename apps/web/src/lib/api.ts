import { createApi, type SolversApi } from "@solvers/api-client";

// Mesma origem: caminhos relativos (/api/...). Em dev o next.config encaminha para a 3017;
// em produção, o nginx. O cookie de sessão (httpOnly) vai junto.
export const api: SolversApi = createApi({ baseUrl: "" });

/**
 * Para componentes de servidor (catálogo público): o fetch do servidor precisa de URL absoluta.
 * API_INTERNAL_URL (produção: http://127.0.0.1:3017); padrão: a API local.
 */
export function serverApi(): SolversApi {
  return createApi({ baseUrl: process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3017" });
}

export { ApiError } from "@solvers/api-client";
export type { SolversApi } from "@solvers/api-client";

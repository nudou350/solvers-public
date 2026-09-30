// Busca do especialista no servidor (componentes de servidor das rotas de checkout e instalação).
import type { AgentDetail } from "@solvers/api-client";
import { ApiError, serverApi } from "@/lib/api";

export type LoadedAgent = { detail: AgentDetail | null; error: "not_found" | "unavailable" | null };

export async function loadAgent(slug: string | null): Promise<LoadedAgent> {
  if (!slug) return { detail: null, error: "not_found" };
  try {
    return { detail: await serverApi().getAgent(slug), error: null };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { detail: null, error: "not_found" };
    return { detail: null, error: "unavailable" };
  }
}

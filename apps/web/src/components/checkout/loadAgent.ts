// Busca do especialista no servidor (componentes de servidor das rotas de checkout e instalação).
import type { AgentDetail } from "@solvers/api-client";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { ApiError, serverApi } from "@/lib/api";

export type LoadedAgent = { detail: AgentDetail | null; error: "not_found" | "unavailable" | null };

export async function loadAgent(slug: string | null): Promise<LoadedAgent> {
  if (!slug) return { detail: null, error: "not_found" };
  try {
    // Textos do Solver no idioma da página (nome, descrição, requisitos).
    const lang = (await getLocale()) as Locale;
    return { detail: await serverApi().getAgent(slug, lang), error: null };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { detail: null, error: "not_found" };
    return { detail: null, error: "unavailable" };
  }
}

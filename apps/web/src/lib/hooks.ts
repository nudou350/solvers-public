"use client";
// Hooks de apresentação compartilhados pelas telas.
import type { Agent } from "@solvers/api-client";
import { useEffect, useState } from "react";
import { useSession } from "./session";

/** Relógio que atualiza a cada `ms` (contagens regressivas). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Nome e categoria dos especialistas por id: getAgents() e, para os que não estão na vitrine
 * (ex: saíram da lista), getAgent(id).
 */
export function useAgentsIndex(ids: string[]): Map<string, Agent> {
  const { api } = useSession();
  const [index, setIndex] = useState<Map<string, Agent>>(new Map());
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    (async () => {
      const all = await api.getAgents({ limit: 100 }).catch(() => [] as Agent[]);
      const map = new Map(all.map((a) => [a.id, a]));
      const missing = key.split(",").filter((id) => !map.has(id));
      const extra = await Promise.all(missing.map((id) => api.getAgent(id).then((d) => d.agent).catch(() => null)));
      for (const a of extra) if (a) map.set(a.id, a);
      if (alive) setIndex(map);
    })();
    return () => {
      alive = false;
    };
  }, [api, key]);
  return index;
}

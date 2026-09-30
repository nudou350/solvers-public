"use client";
// Hooks de apresentação compartilhados pelas telas.
import type { Agent, SolversApi } from "@solvers/api-client";
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

export type MyAccess = Awaited<ReturnType<SolversApi["getMyAccess"]>>;

// Pedidos de acesso em andamento, por sessão (api) e especialista: a caixa de compra e o bloco do teste
// montam juntos e dividem a mesma chamada. Sai do mapa ao terminar, então a próxima visita busca de novo.
const accessInflight = new WeakMap<SolversApi, Map<string, Promise<MyAccess>>>();

function fetchAccess(api: SolversApi, slug: string): Promise<MyAccess> {
  let m = accessInflight.get(api);
  if (!m) accessInflight.set(api, (m = new Map()));
  let p = m.get(slug);
  if (!p) {
    const map = m;
    p = api.getMyAccess(slug).finally(() => map.delete(slug));
    m.set(slug, p);
  }
  return p;
}

export type MyTrials = Awaited<ReturnType<SolversApi["getMyTrials"]>>;

// Vários selos da mesma tela (cartões do catálogo) dividem a mesma chamada, como no acesso acima.
const trialsInflight = new WeakMap<SolversApi, Promise<MyTrials>>();

function fetchTrials(api: SolversApi): Promise<MyTrials> {
  let p = trialsInflight.get(api);
  if (!p) {
    p = api.getMyTrials().finally(() => trialsInflight.delete(api));
    trialsInflight.set(api, p);
  }
  return p;
}

/** Testes grátis em andamento do usuário logado, por especialista. null = sem sessão, carregando ou erro. */
export function useMyTrials(): Map<string, MyTrials[number]> | null {
  const { api, status } = useSession();
  const [trials, setTrials] = useState<Map<string, MyTrials[number]> | null>(null);
  useEffect(() => {
    setTrials(null);
    if (status !== "authed") return;
    let live = true;
    fetchTrials(api).then(
      (list) => live && setTrials(new Map(list.map((t) => [t.agentId, t]))),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, status]);
  return trials;
}

/** Licença e teste grátis do usuário logado neste especialista. null = sem sessão, carregando ou erro. */
export function useMyAccess(slug: string): MyAccess | null {
  const { api, status } = useSession();
  const [access, setAccess] = useState<MyAccess | null>(null);
  useEffect(() => {
    setAccess(null);
    if (status !== "authed") return;
    let live = true;
    fetchAccess(api, slug).then(
      (a) => live && setAccess(a),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, status, slug]);
  return access;
}

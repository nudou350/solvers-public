"use client";
// Sessão da vitrine: carteira (Privy ou dev), usuário logado (cookie httpOnly do servidor),
// instância da API e a config pública (em cache). Use `useSession()` nas telas logadas.
import type { PublicConfig } from "@solvers/api-client";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type SolversApi } from "./api";
import { createDevAdapter, loadDevWallet, PRIVY_APP_ID, type WalletAdapter, type WalletLike } from "./wallet";

const PrivyWallet = dynamic(() => import("./wallet/privy"), { ssr: false });

export type Me = { wallet: string; displayName: string | null; email: string | null };
export type SessionStatus = "loading" | "anon" | "authed";

export type Session = {
  api: SolversApi;
  /** Config pública (getConfig), em cache. null enquanto carrega. */
  config: PublicConfig | null;
  status: SessionStatus;
  /** Usuário logado (carteira da sessão do servidor + nome e e-mail do perfil). */
  me: Me | null;
  /** Carteira que pode assinar agora (a mesma da sessão). null se não logado ou se a carteira não estiver disponível. */
  wallet: WalletLike | null;
  walletKind: WalletAdapter["kind"];
  /** true enquanto o login está em andamento. */
  loggingIn: boolean;
  /** Abre o login (Privy) ou cria/usa a carteira de desenvolvimento e faz o SIWS. */
  login(): Promise<Me>;
  logout(): Promise<void>;
  /** Relê /api/auth/me e o perfil (ex: depois de mudar o nome). */
  refresh(): Promise<Me | null>;
  /** Carteira pronta para assinar: se preciso, faz o login antes. */
  requireWallet(): Promise<WalletLike>;
};

const Ctx = createContext<Session | null>(null);

let configPromise: Promise<PublicConfig> | null = null;
/** getConfig() com cache no módulo (uma chamada por carga de página). */
export function loadConfig(): Promise<PublicConfig> {
  configPromise ??= api.getConfig().catch((e: unknown) => {
    configPromise = null;
    throw e;
  });
  return configPromise;
}

async function fetchMe(): Promise<Me | null> {
  try {
    const { wallet } = await api.me();
    const profile = await api.getProfile().catch(() => null);
    return { wallet, displayName: profile?.displayName ?? null, email: profile?.email ?? null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Carteira de desenvolvimento (quando não há Privy): recarregada do localStorage.
  const [devWallet, setDevWallet] = useState<WalletLike | null>(null);
  const [privyAdapter, setPrivyAdapter] = useState<WalletAdapter | null>(null);
  const adapter: WalletAdapter = useMemo(
    () =>
      PRIVY_APP_ID
        ? (privyAdapter ?? { kind: "privy", ready: false, current: null, email: null, connect: () => Promise.reject(new Error("Carregando o login...")), disconnect: async () => {} })
        : createDevAdapter(devWallet, setDevWallet),
    [privyAdapter, devWallet],
  );
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  useEffect(() => {
    loadConfig().then(setConfig, () => setConfig(null));
    if (!PRIVY_APP_ID) loadDevWallet(false)?.then(setDevWallet, () => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await fetchMe();
      setMe(m);
      setStatus(m ? "authed" : "anon");
      return m;
    } catch {
      setStatus((s) => (s === "loading" ? "anon" : s));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inflight = useRef<Promise<Me> | null>(null);
  const login = useCallback(() => {
    inflight.current ??= (async () => {
      setLoggingIn(true);
      try {
        const w = await adapterRef.current.connect();
        await api.login(w);
        // Com o Privy, o e-mail verificado vai para o perfil (FRONT_PLAN, fase C).
        const email = adapterRef.current.email;
        if (email) await api.updateProfile({ email }).catch(() => {});
        const m = await fetchMe();
        if (!m) throw new Error("A sessão não foi criada. Tente de novo.");
        setMe(m);
        setStatus("authed");
        return m;
      } finally {
        setLoggingIn(false);
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    await adapterRef.current.disconnect().catch(() => {});
    setMe(null);
    setStatus("anon");
  }, []);

  const current = adapter.current;
  const wallet = me && current && current.address === me.wallet ? current : null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const requireWallet = useCallback(async () => {
    if (walletRef.current) return walletRef.current;
    await login();
    const w = await adapterRef.current.connect();
    return w;
  }, [login]);

  const value = useMemo<Session>(
    () => ({ api, config, status, me, wallet, walletKind: adapter.kind, loggingIn, login, logout, refresh, requireWallet }),
    [config, status, me, wallet, adapter.kind, loggingIn, login, logout, refresh, requireWallet],
  );

  return (
    <Ctx.Provider value={value}>
      {PRIVY_APP_ID ? <PrivyWallet appId={PRIVY_APP_ID} onAdapter={setPrivyAdapter} /> : null}
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession precisa estar dentro de <SessionProvider>");
  return s;
}

/** Cotação R$/USD da config (null enquanto carrega). */
export function useRate(): number | null {
  return useSession().config?.brlPerUsd ?? null;
}

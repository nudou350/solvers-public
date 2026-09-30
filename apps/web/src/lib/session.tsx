"use client";
// Sessão da vitrine: carteira (Privy ou dev), usuário logado (cookie httpOnly do servidor),
// instância da API e a config pública (em cache). Use `useSession()` nas telas logadas.
import type { PublicConfig } from "@solvers/api-client";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, onUnauthorized, type SolversApi } from "./api";
import { createDevAdapter, devWalletBlocked, forgetDevWallet, loadDevWallet, PRIVY_APP_ID, type WalletAdapter, type WalletLike } from "./wallet";

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
  /**
   * Só na carteira de desenvolvimento: sai, apaga a semente deste navegador e entra com uma carteira nova.
   * (Com o Privy, trocar de conta é o logout normal.)
   */
  switchDevWallet(): Promise<Me>;
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

// Indício de sessão. O cookie é httpOnly (o JS não o vê), então sem indício o /api/auth/me só responderia 401.
// - HINT (localStorage): esta vitrine abriu uma sessão e ainda não saiu dela.
// - CHECKED (sessionStorage): esta aba já perguntou ao servidor uma vez. Sem HINT, pergunta só uma vez por aba,
//   para ainda detectar uma sessão aberta fora da vitrine (ex: a página de autorização do conector).
const HINT = "solvers.session.v1";
const CHECKED = "solvers.sessionChecked.v1";

function shouldAskServer(): boolean {
  try {
    if (localStorage.getItem(HINT)) return true;
    if (sessionStorage.getItem(CHECKED)) return false;
    sessionStorage.setItem(CHECKED, "1");
    return true;
  } catch {
    return true;
  }
}

function setHint(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT, "1");
    else localStorage.removeItem(HINT);
  } catch {
    /* sem storage: pergunta sempre */
  }
}

async function fetchMe(): Promise<Me | null> {
  try {
    const { wallet } = await api.me();
    const profile = await api.getProfile().catch(() => null);
    setHint(true);
    return { wallet, displayName: profile?.displayName ?? null, email: profile?.email ?? null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setHint(false);
      return null;
    }
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
    loadConfig().then(
      (cfg) => {
        setConfig(cfg);
        // Só restaura a carteira de desenvolvimento depois de a config provar que a rede permite (na dúvida, não restaura).
        if (!PRIVY_APP_ID && !devWalletBlocked(cfg.cluster)) loadDevWallet(false)?.then(setDevWallet, () => {});
      },
      () => setConfig(null),
    );
  }, []);

  /** Relê a sessão. Sem `force`, pula a pergunta ao servidor quando não há indício de sessão (ver HINT). */
  const refresh = useCallback(async (force = true) => {
    if (!force && !shouldAskServer()) {
      setMe(null);
      setStatus("anon");
      return null;
    }
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
    void refresh(false);
  }, [refresh]);

  // 401 no meio da sessão (cookie expirou): relê a sessão; o status vira "anon" e as telas pedem o login.
  const statusRef = useRef(status);
  statusRef.current = status;
  const rechecking = useRef(false);
  useEffect(
    () =>
      onUnauthorized(() => {
        if (statusRef.current !== "authed" || rechecking.current) return;
        rechecking.current = true;
        void refresh().finally(() => {
          rechecking.current = false;
        });
      }),
    [refresh],
  );

  const inflight = useRef<Promise<Me> | null>(null);
  const login = useCallback(() => {
    inflight.current ??= (async () => {
      setLoggingIn(true);
      try {
        if (adapterRef.current.kind === "dev") {
          const cfg = await loadConfig().catch(() => null);
          if (!cfg) throw new Error("Não deu para confirmar a rede agora. Tente de novo em instantes.");
          const blocked = devWalletBlocked(cfg.cluster);
          if (blocked) throw new Error(blocked);
        }
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
    setHint(false);
    await api.logout().catch(() => {});
    await adapterRef.current.disconnect().catch(() => {});
    setMe(null);
    setStatus("anon");
  }, []);

  const switchDevWallet = useCallback(async () => {
    if (PRIVY_APP_ID) throw new Error("Com o login por e-mail, use Sair para trocar de conta.");
    setHint(false);
    await api.logout().catch(() => {});
    forgetDevWallet();
    setDevWallet(null);
    setMe(null);
    setStatus("anon");
    return login();
  }, [login]);

  const current = adapter.current;
  // A carteira de desenvolvimento só assina com a rede confirmada como de teste (mesma regra do login).
  const devBlocked = adapter.kind === "dev" && (!config || devWalletBlocked(config.cluster) !== null);
  const wallet = me && current && !devBlocked && current.address === me.wallet ? current : null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const requireWallet = useCallback(async () => {
    if (walletRef.current) return walletRef.current;
    await login();
    const w = await adapterRef.current.connect();
    return w;
  }, [login]);

  const value = useMemo<Session>(
    () => ({ api, config, status, me, wallet, walletKind: adapter.kind, loggingIn, login, logout, switchDevWallet, refresh, requireWallet }),
    [config, status, me, wallet, adapter.kind, loggingIn, login, logout, switchDevWallet, refresh, requireWallet],
  );

  return (
    <Ctx.Provider value={value}>
      {PRIVY_APP_ID ? <PrivyWallet appId={PRIVY_APP_ID} cluster={config?.cluster ?? null} onAdapter={setPrivyAdapter} /> : null}
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

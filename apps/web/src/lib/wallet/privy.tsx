"use client";
// Carteira via Privy (login por e-mail + carteira Solana embutida). Só é carregado quando
// NEXT_PUBLIC_PRIVY_APP_ID existe (next/dynamic em lib/session.tsx), para não pesar no bundle da dev.
// O PrivyProvider fica num ramo irmão da árvore do app: só esta ponte usa os hooks do Privy e
// entrega um WalletAdapter para a sessão por `onAdapter`.
import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignMessage,
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WalletAdapter, WalletLike } from "./types";

type Pending = { resolve: (w: WalletLike) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type SolanaChain = "solana:mainnet" | "solana:devnet" | "solana:testnet";

/** Tempo máximo do login (e-mail + código + criação da carteira) antes de desistir. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** Depois do login, espera a carteira embutida ser criada sozinha (createOnLogin) antes de pedir a criação. */
const CREATE_WALLET_AFTER_MS = 2500;

/** Rede do cluster da config, no formato do Privy (localnet: nenhuma, a transação já vem montada). */
export function privyChain(cluster: string | null | undefined): SolanaChain | undefined {
  if (cluster === "mainnet-beta" || cluster === "mainnet") return "solana:mainnet";
  if (cluster === "devnet") return "solana:devnet";
  if (cluster === "testnet") return "solana:testnet";
  return undefined;
}

function Bridge({ onAdapter, chain }: { onAdapter: (a: WalletAdapter) => void; chain: SolanaChain | undefined }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const { createWallet } = useCreateWallet();
  const pending = useRef<Pending[]>([]);
  // Pedido de login feito antes do SDK ficar pronto: o efeito abaixo abre o login quando `ready`.
  const wantLogin = useRef(false);
  // Muda a cada connect(), para o efeito de resolução rodar de novo.
  const [tick, setTick] = useState(0);

  const settle = (fn: (p: Pending) => void) => {
    const list = pending.current.splice(0);
    for (const p of list) {
      clearTimeout(p.timer);
      fn(p);
    }
  };

  const { login } = useLogin({
    onError: (err) => {
      wantLogin.current = false;
      settle((p) => p.reject(new Error(err === "exited_auth_flow" ? "Login cancelado" : `Falha no login: ${err}`)));
    },
  });

  // As funções dos hooks mudam de identidade entre renders: ficam em refs, para os efeitos e o adaptador
  // não dependerem delas (evita o laço onAdapter → setState → render → nova função → onAdapter...).
  const fns = useRef({ login, logout, signMessage, signTransaction, createWallet });
  fns.current = { login, logout, signMessage, signTransaction, createWallet };
  const chainRef = useRef(chain);
  chainRef.current = chain;

  // Prefere a carteira embutida do Privy; se o usuário também conectou outra, usa a primeira.
  const raw: ConnectedStandardSolanaWallet | undefined = useMemo(
    () => wallets.find((w) => w.standardWallet?.name?.toLowerCase().includes("privy")) ?? wallets[0],
    [wallets],
  );
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const address = raw?.address ?? null;

  const wallet: WalletLike | null = useMemo(() => {
    if (!address) return null;
    const current = () => {
      const w = rawRef.current;
      if (!w || w.address !== address) throw new Error("A carteira mudou. Entre de novo.");
      return w;
    };
    return {
      address,
      async signMessage(message) {
        const { signature } = await fns.current.signMessage({ message, wallet: current(), options: { uiOptions: { title: "Entrar no Solvers" } } });
        return signature;
      },
      async signTransaction(transaction) {
        const { signedTransaction } = await fns.current.signTransaction({ transaction, wallet: current(), chain: chainRef.current });
        return signedTransaction;
      },
    };
  }, [address]);

  // Resolve os logins pendentes: abre o login quando o SDK fica pronto, entrega a carteira quando ela aparece
  // e, se o usuário já está autenticado sem carteira Solana, pede a criação.
  useEffect(() => {
    if (!ready || !pending.current.length) return;
    if (!authenticated) {
      if (wantLogin.current) {
        wantLogin.current = false;
        fns.current.login({ loginMethods: ["email"] });
      }
      return;
    }
    if (wallet) {
      settle((p) => p.resolve(wallet));
      return;
    }
    if (!walletsReady) return;
    const t = setTimeout(() => {
      if (rawRef.current || !pending.current.length) return;
      fns.current.createWallet().catch((e: unknown) => {
        if (!rawRef.current) settle((p) => p.reject(new Error(`Não deu para criar a sua carteira: ${(e as Error).message}`)));
      });
    }, CREATE_WALLET_AFTER_MS);
    return () => clearTimeout(t);
  }, [ready, walletsReady, authenticated, wallet, tick]);

  // Desmontou (ex: troca de página inteira): ninguém fica esperando para sempre.
  useEffect(() => () => settle((p) => p.reject(new Error("Login interrompido"))), []);

  const email = user?.email?.address ?? null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const state = useRef({ ready, authenticated });
  state.current = { ready, authenticated };

  useEffect(() => {
    onAdapter({
      kind: "privy",
      ready: ready && walletsReady,
      current: authenticated ? wallet : null,
      email,
      connect() {
        if (state.current.authenticated && walletRef.current) return Promise.resolve(walletRef.current);
        return new Promise<WalletLike>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.current = pending.current.filter((p) => p.timer !== timer);
            wantLogin.current = false;
            reject(new Error("O login demorou demais. Tente de novo."));
          }, LOGIN_TIMEOUT_MS);
          pending.current.push({ resolve, reject, timer });
          if (!state.current.authenticated) {
            if (state.current.ready) fns.current.login({ loginMethods: ["email"] });
            else wantLogin.current = true;
          }
          setTick((n) => n + 1);
        });
      },
      async disconnect() {
        await fns.current.logout();
      },
    });
  }, [onAdapter, ready, walletsReady, authenticated, wallet, email]);

  return null;
}

export default function PrivyWallet({ appId, cluster, onAdapter }: { appId: string; cluster: string | null; onAdapter: (a: WalletAdapter) => void }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { walletChainType: "solana-only", theme: "light", accentColor: "#4A3CB0" },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
          // O servidor monta a transação e paga a taxa; o usuário já confirmou a compra na tela.
          showWalletUIs: false,
        },
      }}
    >
      <Bridge onAdapter={onAdapter} chain={privyChain(cluster)} />
    </PrivyProvider>
  );
}

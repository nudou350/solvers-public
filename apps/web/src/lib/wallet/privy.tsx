"use client";
// Carteira via Privy (login por e-mail + carteira Solana embutida). Só é carregado quando
// NEXT_PUBLIC_PRIVY_APP_ID existe (next/dynamic em providers.tsx), para não pesar no bundle da dev.
// O PrivyProvider fica num ramo irmão da árvore do app: só esta ponte usa os hooks do Privy e
// entrega um WalletAdapter para a sessão por `onAdapter`.
import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { useEffect, useMemo, useRef } from "react";
import type { WalletAdapter, WalletLike } from "./types";

type Pending = { resolve: (w: WalletLike) => void; reject: (e: Error) => void };

function Bridge({ onAdapter }: { onAdapter: (a: WalletAdapter) => void }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const pending = useRef<Pending[]>([]);

  const { login } = useLogin({
    onError: (err) => {
      const list = pending.current.splice(0);
      list.forEach((p) => p.reject(new Error(err === "exited_auth_flow" ? "Login cancelado" : `Falha no login: ${err}`)));
    },
  });

  // Prefere a carteira embutida do Privy; se o usuário também conectou outra, usa a primeira.
  const raw: ConnectedStandardSolanaWallet | undefined = useMemo(
    () => wallets.find((w) => w.standardWallet?.name?.toLowerCase().includes("privy")) ?? wallets[0],
    [wallets],
  );

  const wallet: WalletLike | null = useMemo(() => {
    if (!raw) return null;
    return {
      address: raw.address,
      async signMessage(message) {
        const { signature } = await signMessage({ message, wallet: raw, options: { uiOptions: { title: "Entrar no Solvers" } } });
        return signature;
      },
      async signTransaction(transaction) {
        const { signedTransaction } = await signTransaction({ transaction, wallet: raw });
        return signedTransaction;
      },
    };
  }, [raw, signMessage, signTransaction]);

  // Resolve os logins pendentes quando a carteira embutida aparece (ela é criada logo depois do login).
  useEffect(() => {
    if (authenticated && wallet && pending.current.length) {
      pending.current.splice(0).forEach((p) => p.resolve(wallet));
    }
  }, [authenticated, wallet]);

  const email = user?.email?.address ?? null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  useEffect(() => {
    onAdapter({
      kind: "privy",
      ready: ready && walletsReady,
      current: authenticated ? wallet : null,
      email,
      connect() {
        if (authenticated && walletRef.current) return Promise.resolve(walletRef.current);
        return new Promise<WalletLike>((resolve, reject) => {
          pending.current.push({ resolve, reject });
          if (!authenticated) login({ loginMethods: ["email"] });
        });
      },
      async disconnect() {
        await logout();
      },
    });
  }, [onAdapter, ready, walletsReady, authenticated, wallet, email, login, logout]);

  return null;
}

export default function PrivyWallet({ appId, onAdapter }: { appId: string; onAdapter: (a: WalletAdapter) => void }) {
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
      <Bridge onAdapter={onAdapter} />
    </PrivyProvider>
  );
}

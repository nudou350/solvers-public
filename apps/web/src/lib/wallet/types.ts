import type { WalletLike } from "@solvers/api-client";

export type { WalletLike };

export type WalletKind = "privy" | "dev";

/**
 * Fonte da carteira (Privy ou carteira de desenvolvimento). A sessão pede `connect()` no login
 * e usa a WalletLike devolvida para o SIWS e para assinar as transações montadas pelo servidor.
 */
export type WalletAdapter = {
  kind: WalletKind;
  /** false enquanto o SDK carrega. */
  ready: boolean;
  /** Carteira já conectada (sem abrir nada), ou null. */
  current: WalletLike | null;
  /** E-mail verificado pelo provedor (Privy), quando houver. */
  email: string | null;
  /** Abre o login do provedor, se preciso, e devolve a carteira pronta para assinar. */
  connect(): Promise<WalletLike>;
  disconnect(): Promise<void>;
};

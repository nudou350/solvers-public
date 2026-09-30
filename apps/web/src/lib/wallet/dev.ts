"use client";
// Carteira de desenvolvimento (localnet/devnet), usada quando não há NEXT_PUBLIC_PRIVY_APP_ID.
// Par ed25519 gerado no navegador (WebCrypto), com a semente de 32 bytes guardada no localStorage.
// Assina a mensagem SIWS e acrescenta a assinatura do usuário à transação que o servidor montou
// (já assinada pelo fee payer), como scripts/src/e2e-api.ts (signAsWallet).
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Decoder,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
} from "@solana/kit";
import type { WalletAdapter, WalletLike } from "./types";

const STORAGE_KEY = "solvers.devWallet.v1";

function loadSeed(): Uint8Array | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return null;
    const bytes = Uint8Array.from(getBase58Encoder().encode(s));
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function saveSeed(seed: Uint8Array) {
  try {
    localStorage.setItem(STORAGE_KEY, getBase58Decoder().decode(seed));
  } catch {
    /* sem localStorage: a carteira vale só nesta aba */
  }
}

export async function devWalletFromSeed(seed: Uint8Array): Promise<WalletLike> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  return {
    address: signer.address,
    async signMessage(message) {
      return new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
    },
    async signTransaction(txBytes) {
      const tx = getTransactionDecoder().decode(txBytes);
      const signed = await partiallySignTransaction([signer.keyPair], tx);
      return new Uint8Array(getTransactionEncoder().encode(signed));
    },
  };
}

let cached: Promise<WalletLike> | null = null;

/** Carrega (ou cria, se `create`) a carteira de desenvolvimento deste navegador. */
export function loadDevWallet(create: boolean): Promise<WalletLike> | null {
  if (cached) return cached;
  let seed = loadSeed();
  if (!seed) {
    if (!create) return null;
    seed = crypto.getRandomValues(new Uint8Array(32));
    saveSeed(seed);
  }
  cached = devWalletFromSeed(seed).catch((e: unknown) => {
    cached = null;
    throw new Error(`Este navegador não suporta chaves Ed25519 (WebCrypto): ${(e as Error).message}`);
  });
  return cached;
}

/** Esquece a carteira de desenvolvimento (o próximo login cria outra). */
export function forgetDevWallet() {
  cached = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignora */
  }
}

export function createDevAdapter(current: WalletLike | null, onChange: (w: WalletLike | null) => void): WalletAdapter {
  return {
    kind: "dev",
    ready: true,
    current,
    email: null,
    async connect() {
      const w = await loadDevWallet(true)!;
      onChange(w);
      return w;
    },
    // Sair não apaga a chave: o mesmo navegador volta para a mesma carteira (e as mesmas licenças).
    async disconnect() {
      onChange(null);
    },
  };
}

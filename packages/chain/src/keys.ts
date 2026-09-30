import { readFileSync, existsSync } from "node:fs";
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";

/**
 * Carrega um keypair a partir de:
 * - array JSON no formato da Solana CLI ("[12,34,...]")
 * - base58 da chave secreta de 64 bytes
 * - caminho para um arquivo .json da Solana CLI
 */
export async function loadSigner(value: string): Promise<KeyPairSigner> {
  const v = value.trim();
  let bytes: Uint8Array;
  if (v.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(v) as number[]);
  } else if (existsSync(v)) {
    bytes = Uint8Array.from(JSON.parse(readFileSync(v, "utf8")) as number[]);
  } else {
    bytes = Uint8Array.from(getBase58Encoder().encode(v));
  }
  if (bytes.length !== 64) throw new Error("keypair deve ter 64 bytes");
  return createKeyPairSignerFromBytes(bytes);
}

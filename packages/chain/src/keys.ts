import { readFileSync, existsSync } from "node:fs";
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";

/**
 * Erro de leitura de chave. A mensagem é FIXA: nunca carrega trecho do conteúdo (um JSON.parse malformado
 * citaria parte do arquivo, ou seja, da chave privada).
 */
export class KeyError extends Error {
  constructor(message = "chave inválida (formato, tamanho ou conteúdo incorreto)") {
    super(message);
  }
}

function check64(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 64) throw new KeyError();
  return bytes;
}

/** Texto no formato da Solana CLI (`[12,34,...]`, 64 bytes). Qualquer falha vira `KeyError` sem trecho do texto. */
export function parseKeyJson(text: string): Uint8Array {
  let arr: unknown;
  try {
    arr = JSON.parse(text);
  } catch {
    throw new KeyError();
  }
  if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new KeyError();
  return check64(Uint8Array.from(arr as number[]));
}

/** Chave secreta de 64 bytes em base58. Falha vira `KeyError` sem trecho do texto. */
export function parseKeyBase58(text: string): Uint8Array {
  try {
    return check64(Uint8Array.from(getBase58Encoder().encode(text.trim())));
  } catch {
    throw new KeyError();
  }
}

/**
 * Carrega um keypair a partir de:
 * - array JSON no formato da Solana CLI ("[12,34,...]")
 * - base58 da chave secreta de 64 bytes
 * - caminho para um arquivo .json da Solana CLI
 * Qualquer erro de leitura/decodificação é um `KeyError` de mensagem fixa (sem conteúdo da chave).
 */
export async function loadSigner(value: string): Promise<KeyPairSigner> {
  const v = value.trim();
  let bytes: Uint8Array;
  if (v.startsWith("[")) {
    bytes = parseKeyJson(v);
  } else if (existsSync(v)) {
    let text: string;
    try {
      text = readFileSync(v, "utf8");
    } catch {
      throw new KeyError("não consegui ler o arquivo de chave");
    }
    bytes = parseKeyJson(text);
  } else {
    bytes = parseKeyBase58(v);
  }
  try {
    return await createKeyPairSignerFromBytes(bytes);
  } catch {
    throw new KeyError();
  }
}

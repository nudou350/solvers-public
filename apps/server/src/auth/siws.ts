import nacl from "tweetnacl";
import { and, eq, gt, lt } from "drizzle-orm";
import { getBase58Encoder } from "@solana/kit";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { badRequest, unauthorized } from "../lib/http.js";
import { randomToken } from "../lib/crypto.js";

// Sign In With Solana (INSTRUCTIONS.md 5.1). A vitrine pede o nonce, a carteira assina a
// mensagem (signIn ou signMessage) e o servidor confere assinatura, domínio, nonce e validade.

const NONCE_TTL_MS = 5 * 60 * 1000;
export const MEMORY_KEY_MESSAGE = "Solvers memory key v1";

export function allowedDomains(): string[] {
  const hosts = new Set<string>();
  if (env.SIWS_DOMAIN) env.SIWS_DOMAIN.split(",").forEach((d) => hosts.add(d.trim()));
  hosts.add(new URL(env.PUBLIC_WEB_URL).host);
  hosts.add(new URL(env.PUBLIC_API_URL).host);
  return [...hosts];
}

export function chainId(): string {
  return env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet" : env.SOLANA_CLUSTER;
}

export function buildSiwsMessage(p: {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  statement?: string;
  uri?: string;
}) {
  return [
    `${p.domain} wants you to sign in with your Solana account:`,
    p.wallet,
    "",
    p.statement ?? "Entrar no Solvers. Isto não autoriza pagamentos nem custa nada.",
    "",
    `URI: ${p.uri ?? `https://${p.domain}`}`,
    "Version: 1",
    `Chain ID: ${chainId()}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expirationTime}`,
  ].join("\n");
}

export async function createNonce(wallet: string, purpose = "login") {
  assertWallet(wallet);
  await db.delete(schema.authNonces).where(lt(schema.authNonces.expiresAt, new Date()));
  const nonce = randomToken(12).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16).padEnd(8, "0");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await db.insert(schema.authNonces).values({ nonce, wallet, purpose, expiresAt });
  const domain = allowedDomains()[0]!;
  const message = buildSiwsMessage({
    domain,
    wallet,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: expiresAt.toISOString(),
    uri: env.PUBLIC_WEB_URL,
  });
  return { nonce, message, domain, issuedAt: now.toISOString(), expirationTime: expiresAt.toISOString() };
}

export function assertWallet(wallet: string): Uint8Array {
  try {
    const bytes = Uint8Array.from(getBase58Encoder().encode(wallet));
    if (bytes.length !== 32) throw new Error();
    return bytes;
  } catch {
    throw badRequest("Carteira inválida");
  }
}

/** Aceita assinatura em base58, base64, hex ou array de bytes (cada carteira devolve de um jeito). */
export function decodeSignature(sig: string | number[]): Uint8Array {
  if (Array.isArray(sig)) return Uint8Array.from(sig);
  const tries: Array<() => Uint8Array> = [
    () => (/^[0-9a-f]{128}$/i.test(sig) ? Uint8Array.from(Buffer.from(sig, "hex")) : new Uint8Array()),
    () => Uint8Array.from(getBase58Encoder().encode(sig)),
    () => Uint8Array.from(Buffer.from(sig, "base64")),
  ];
  for (const t of tries) {
    try {
      const b = t();
      if (b.length === 64) return b;
    } catch {
      /* tenta o próximo formato */
    }
  }
  throw badRequest("Assinatura em formato inválido");
}

export function verifySignature(wallet: string, message: string | Uint8Array, signature: string | number[]): boolean {
  const pk = assertWallet(wallet);
  const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
  return nacl.sign.detached.verify(msg, decodeSignature(signature), pk);
}

function field(message: string, name: string): string | undefined {
  const m = new RegExp(`^${name}: (.+)$`, "m").exec(message);
  return m?.[1]?.trim();
}

/** Valida a mensagem SIWS assinada e consome o nonce. Retorna a carteira autenticada. */
export async function verifySiws(
  input: { wallet: string; message: string; signature: string | number[] },
  purpose = "login",
): Promise<string> {
  const { wallet, message, signature } = input;
  const lines = message.split("\n");
  const domain = /^(.+) wants you to sign in with your Solana account:$/.exec(lines[0] ?? "")?.[1];
  if (!domain || !allowedDomains().includes(domain)) throw unauthorized("Domínio da mensagem não confere");
  if ((lines[1] ?? "").trim() !== wallet) throw unauthorized("Carteira da mensagem não confere");
  const nonce = field(message, "Nonce");
  if (!nonce) throw unauthorized("Mensagem sem nonce");
  const exp = field(message, "Expiration Time");
  if (exp && new Date(exp).getTime() < Date.now()) throw unauthorized("Mensagem expirada");
  const issued = field(message, "Issued At");
  if (issued && Date.now() - new Date(issued).getTime() > NONCE_TTL_MS + 60_000) {
    throw unauthorized("Mensagem antiga demais");
  }

  if (!verifySignature(wallet, message, signature)) throw unauthorized("Assinatura inválida");

  const consumed = await db
    .delete(schema.authNonces)
    .where(
      and(
        eq(schema.authNonces.nonce, nonce),
        eq(schema.authNonces.wallet, wallet),
        eq(schema.authNonces.purpose, purpose),
        gt(schema.authNonces.expiresAt, new Date()),
      ),
    )
    .returning();
  if (consumed.length === 0) throw unauthorized("Nonce inválido ou já usado");
  return wallet;
}

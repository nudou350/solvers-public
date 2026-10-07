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
    p.statement ?? "Sign in to Solvers. This does not authorize any payments and costs nothing.",
    "",
    `URI: ${p.uri ?? `https://${p.domain}`}`,
    "Version: 1",
    `Chain ID: ${chainId()}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expirationTime}`,
  ].join("\n");
}

export async function createNonce(wallet: string, purpose = "login", statement?: string) {
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
    statement,
  });
  return { nonce, message, domain, issuedAt: now.toISOString(), expirationTime: expiresAt.toISOString() };
}

export function assertWallet(wallet: string): Uint8Array {
  try {
    const bytes = Uint8Array.from(getBase58Encoder().encode(wallet));
    if (bytes.length !== 32) throw new Error();
    return bytes;
  } catch {
    throw badRequest("Invalid wallet");
  }
}

/** Candidatos de 64 bytes para a assinatura: base58, base64/base64url, hex ou array de bytes. */
function signatureCandidates(sig: string | number[]): Uint8Array[] {
  if (Array.isArray(sig)) {
    if (sig.length !== 64 || sig.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw badRequest("Signature has an invalid format");
    return [Uint8Array.from(sig)];
  }
  const out: Uint8Array[] = [];
  const add = (f: () => Uint8Array) => {
    try {
      const b = f();
      if (b.length === 64) out.push(b);
    } catch {
      /* formato não se aplica */
    }
  };
  if (/^[0-9a-f]{128}$/i.test(sig)) add(() => Uint8Array.from(Buffer.from(sig, "hex")));
  add(() => Uint8Array.from(getBase58Encoder().encode(sig)));
  add(() => Uint8Array.from(Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64")));
  if (out.length === 0) throw badRequest("Signature has an invalid format");
  return out;
}

/** Decodifica a assinatura escolhendo o formato que de fato verifica para a carteira e mensagem. */
export function decodeVerifiedSignature(wallet: string, message: string | Uint8Array, sig: string | number[]): Uint8Array | null {
  const pk = assertWallet(wallet);
  const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
  return signatureCandidates(sig).find((c) => nacl.sign.detached.verify(msg, c, pk)) ?? null;
}

export function verifySignature(wallet: string, message: string | Uint8Array, signature: string | number[]): boolean {
  return decodeVerifiedSignature(wallet, message, signature) != null;
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
  if (!domain || !allowedDomains().includes(domain)) throw unauthorized("Message domain does not match");
  if ((lines[1] ?? "").trim() !== wallet) throw unauthorized("Message wallet does not match");
  const nonce = field(message, "Nonce");
  if (!nonce) throw unauthorized("Message has no nonce");
  const chain = field(message, "Chain ID");
  if (chain && chain !== chainId() && chain !== `solana:${chainId()}`) throw unauthorized("Message network does not match");
  const issued = Date.parse(field(message, "Issued At") ?? "");
  if (!Number.isFinite(issued)) throw unauthorized("Message has no issue date");
  if (Date.now() - issued > NONCE_TTL_MS + 60_000 || issued - Date.now() > 60_000) throw unauthorized("Message is outside its validity window");
  const expRaw = field(message, "Expiration Time");
  if (expRaw !== undefined) {
    const exp = Date.parse(expRaw);
    if (!Number.isFinite(exp) || exp < Date.now()) throw unauthorized("Message expired");
  }

  if (!verifySignature(wallet, message, signature)) throw unauthorized("Invalid signature");

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
  if (consumed.length === 0) throw unauthorized("Invalid or already used nonce");
  return wallet;
}

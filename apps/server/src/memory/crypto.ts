import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema, type Db } from "../db/index.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";
import { randomId } from "../lib/crypto.js";
import { EMPTY_MEMORY, MemoryRuleError, applyForget, applySave, readPayload, type MemoryNote, type MemoryPayload, type SaveOp } from "./rules.js";

// Memórias criptografadas (INSTRUCTIONS.md 5.6). Modelo honesto do MVP: cifradas em repouso,
// abertas só durante uma sessão autorizada pela carteira, nunca gravadas abertas.
//
// 1. A carteira assina a mensagem fixa MEMORY_KEY_MESSAGE (ed25519 é determinístico).
// 2. memoryKey = HKDF-SHA256(assinatura, salt = carteira, info = "solvers-memory"), 32 bytes.
// 3. A memoryKey só fica guardada cifrada com a SERVER_KEK, ligada ao token, até ele expirar.
// 4. Cada memória é AES-256-GCM com iv aleatório.

const KEK = Buffer.from(env.SERVER_KEK, "base64");
if (KEK.length !== 32) throw new Error("SERVER_KEK precisa ter 32 bytes em base64");

export function deriveMemoryKey(signature: Uint8Array, wallet: string): Buffer {
  return Buffer.from(hkdfSync("sha256", signature, Buffer.from(wallet), Buffer.from("solvers-memory"), 32));
}

/** AES-256-GCM. `aad` amarra o texto cifrado ao seu dono (carteira|solver): linhas não podem ser trocadas. */
function seal(key: Buffer, plaintext: Buffer, aad?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad?: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Cifra a memoryKey com a KEK do servidor: iv(12) | tag(16) | ct(32). */
export function wrapKey(memoryKey: Buffer): Buffer {
  const { iv, tag, ciphertext } = seal(KEK, memoryKey);
  return Buffer.concat([iv, tag, ciphertext]);
}

export function unwrapKey(wrapped: Buffer): Buffer {
  return open(KEK, wrapped.subarray(0, 12), wrapped.subarray(12, 28), wrapped.subarray(28));
}

/** Conexão normal ou transação aberta (db.transaction): quem chama decide o escopo atômico. */
export type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function storeMemoryKey(tokenId: string, wallet: string, wrapped: Buffer, expiresAt: Date, exec: DbExecutor = db) {
  await exec.delete(schema.memoryKeys).where(lt(schema.memoryKeys.expiresAt, new Date()));
  await exec
    .insert(schema.memoryKeys)
    .values({ tokenId, wallet, wrappedKey: wrapped, expiresAt })
    .onConflictDoUpdate({ target: schema.memoryKeys.tokenId, set: { wrappedKey: wrapped, expiresAt, wallet } });
}

export async function memoryKeyFor(tokenId: string | undefined, wallet: string): Promise<Buffer | null> {
  if (!tokenId) return null;
  const [row] = await db
    .select()
    .from(schema.memoryKeys)
    .where(and(eq(schema.memoryKeys.tokenId, tokenId), eq(schema.memoryKeys.wallet, wallet), gt(schema.memoryKeys.expiresAt, new Date())));
  return row ? unwrapKey(row.wrappedKey) : null;
}

const aadOf = (wallet: string, agentId: string) => `${wallet}|${agentId}`;

function sealPayload(key: Buffer, wallet: string, agentId: string, payload: MemoryPayload) {
  return seal(key, Buffer.from(JSON.stringify(payload)), aadOf(wallet, agentId));
}

/**
 * Ler, mesclar e gravar a memória de um especialista sem perder dados em chamadas paralelas
 * (PACKAGE_SPEC.md 11.2). `SELECT … FOR UPDATE` não trava uma linha que ainda não existe, então a primeira
 * gravação cria a linha com `INSERT … ON CONFLICT DO NOTHING` e só depois a trava; a mesclagem roda com a
 * linha travada. Se `mutate` lançar (limite estourado), a transação desfaz tudo, inclusive a linha criada.
 * `create: false` (forget): não cria a linha; sem memória, devolve null.
 */
export async function updateMemory<T>(
  wallet: string,
  agentId: string,
  key: Buffer,
  mutate: (cur: MemoryPayload) => { next: MemoryPayload; result: T },
  opts: { create?: boolean } = {},
): Promise<T | null> {
  const create = opts.create ?? true;
  return db.transaction(async (tx) => {
    if (create) {
      const empty = sealPayload(key, wallet, agentId, EMPTY_MEMORY);
      await tx
        .insert(schema.memories)
        .values({ id: `mem_${randomId(10)}`, wallet, agentId, ciphertext: empty.ciphertext, iv: empty.iv, tag: empty.tag, updatedAt: new Date() })
        .onConflictDoNothing({ target: [schema.memories.wallet, schema.memories.agentId] });
    }
    const [row] = await tx
      .select()
      .from(schema.memories)
      .where(and(eq(schema.memories.wallet, wallet), eq(schema.memories.agentId, agentId)))
      .for("update");
    if (!row) return null;
    let cur: MemoryPayload;
    try {
      cur = readPayload(JSON.parse(open(key, row.iv, row.tag, row.ciphertext, aadOf(wallet, agentId)).toString("utf8")));
    } catch {
      // Não abre com esta chave: regravar apagaria a memória existente.
      throw new HttpError(409, "I couldn't open the memory already stored for this connection. Ask the user to reconnect Solvers and confirm the memory signature.", "memory_key_mismatch");
    }
    let applied: { next: MemoryPayload; result: T };
    try {
      applied = mutate(cur);
    } catch (e) {
      if (e instanceof MemoryRuleError) throw new HttpError(400, e.message, "memory_limit");
      throw e;
    }
    const s = sealPayload(key, wallet, agentId, applied.next);
    await tx
      .update(schema.memories)
      .set({ ciphertext: s.ciphertext, iv: s.iv, tag: s.tag, updatedAt: new Date() })
      .where(eq(schema.memories.id, row.id));
    return applied.result;
  });
}

/** save_memory: `summary` (substitui o resumo), `note` (acrescenta) ou `profile` (substitui o perfil). */
export async function saveMemory(wallet: string, agentId: string, key: Buffer, op: SaveOp) {
  return updateMemory(wallet, agentId, key, (cur) => {
    const r = applySave(cur, op, new Date(), () => randomId(2));
    return { next: r.next, result: { note: r.created ?? null, duplicate: r.duplicate === true } };
  });
}

/** forget_memory: remove uma nota. null: o especialista não tem memória; found false: a nota não existe. */
export async function forgetNote(wallet: string, agentId: string, key: Buffer, noteId: string) {
  return updateMemory(wallet, agentId, key, (cur) => {
    const r = applyForget(cur, noteId);
    return { next: r.next, result: r.found };
  }, { create: false });
}

export type OpenMemory = { id: string; agentId: string; summary: string; profile: MemoryPayload["profile"]; notes: MemoryNote[]; updatedAt: Date };

export async function readMemories(wallet: string, key: Buffer, agentId?: string): Promise<OpenMemory[]> {
  const rows = await db
    .select()
    .from(schema.memories)
    .where(agentId ? and(eq(schema.memories.wallet, wallet), eq(schema.memories.agentId, agentId)) : eq(schema.memories.wallet, wallet));
  const out: OpenMemory[] = [];
  for (const r of rows) {
    try {
      const payload = readPayload(JSON.parse(open(key, r.iv, r.tag, r.ciphertext, aadOf(r.wallet, r.agentId)).toString("utf8")));
      out.push({ id: r.id, agentId: r.agentId, summary: payload.summary, profile: payload.profile, notes: payload.notes, updatedAt: r.updatedAt });
    } catch {
      // Chave diferente (outra carteira/assinatura): não dá para abrir. Nunca devolve bytes crus.
    }
  }
  return out;
}

export async function deleteMemory(wallet: string, id: string) {
  const r = await db
    .delete(schema.memories)
    .where(and(eq(schema.memories.wallet, wallet), eq(schema.memories.id, id)))
    .returning();
  return r.length > 0;
}

/** "Apagar tudo": remove as memórias e as chaves de sessão, inutilizando qualquer acesso. */
export async function deleteAllMemories(wallet: string) {
  await db.delete(schema.memories).where(eq(schema.memories.wallet, wallet));
  await db.delete(schema.memoryKeys).where(eq(schema.memoryKeys.wallet, wallet));
}

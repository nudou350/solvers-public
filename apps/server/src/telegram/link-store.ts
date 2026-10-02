import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateLinkCode, hashLinkCode, linkExpiry, normalizeLinkCode, planIssue } from "./link-rules.js";

// Banco da vinculação do Telegram (regras em link-rules.ts). Dois passos: o site emite o código (issueLinkCode) e o bot o
// resgata (redeemLinkCode). O código nunca é guardado, só o hash.

export type IssueResult = { status: "ok"; code: string; expiresAt: Date } | { status: "no_profile" } | { status: "limited"; retryAfterSec: number };

/** Emite um código novo para o criador (o anterior deixa de valer). Até 5 por hora; só quem já tem perfil de criador. */
export async function issueLinkCode(wallet: string, now: Date = new Date(), bytes?: Uint8Array): Promise<IssueResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-link:${wallet}`}, 0))`);
    const [c] = await tx.select().from(schema.creators).where(eq(schema.creators.wallet, wallet));
    if (!c) return { status: "no_profile" } as const;
    const plan = planIssue({ windowStart: c.telegramLinkWindowStart, count: c.telegramLinkCount }, now);
    if (!plan.ok) return { status: "limited", retryAfterSec: plan.retryAfterSec } as const;
    const code = generateLinkCode(bytes);
    const expiresAt = linkExpiry(now);
    await tx
      .update(schema.creators)
      .set({ telegramLinkHash: hashLinkCode(code), telegramLinkExpiresAt: expiresAt, telegramLinkWindowStart: plan.windowStart, telegramLinkCount: plan.count })
      .where(eq(schema.creators.id, c.id));
    return { status: "ok", code, expiresAt } as const;
  });
}

export type RedeemResult = { status: "linked"; name: string } | { status: "invalid" } | { status: "chat_taken" };

/**
 * Resgata o código enviado ao bot: grava `telegram_chat_id` do criador dono do código e apaga o código (uso único). Um chat só
 * pode ficar em UM criador (`chat_taken`). Código fora do formato, desconhecido, vencido ou já usado dá sempre `invalid`.
 */
export async function redeemLinkCode(chatId: string, raw: string, now: Date = new Date()): Promise<RedeemResult> {
  const code = normalizeLinkCode(raw);
  if (!code) return { status: "invalid" };
  const hash = hashLinkCode(code);
  return db.transaction(async (tx) => {
    // Trava por chat: dois códigos de criadores diferentes vindos do mesmo chat não passam os dois.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-chat:${chatId}`}, 0))`);
    const [c] = await tx
      .select({ id: schema.creators.id, name: schema.creators.name })
      .from(schema.creators)
      .where(and(eq(schema.creators.telegramLinkHash, hash), gt(schema.creators.telegramLinkExpiresAt, now)));
    if (!c) return { status: "invalid" } as const;
    const [other] = await tx
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(and(eq(schema.creators.telegramChatId, chatId), ne(schema.creators.id, c.id)))
      .limit(1);
    if (other) return { status: "chat_taken" } as const;
    // O UPDATE reconfere o hash e a validade: o mesmo código resgatado em dois chats ao mesmo tempo só vale uma vez.
    const done = await tx
      .update(schema.creators)
      .set({ telegramChatId: chatId, telegramLinkHash: null, telegramLinkExpiresAt: null })
      .where(and(eq(schema.creators.id, c.id), eq(schema.creators.telegramLinkHash, hash), gt(schema.creators.telegramLinkExpiresAt, now)))
      .returning({ id: schema.creators.id });
    return done.length === 1 ? ({ status: "linked", name: c.name } as const) : ({ status: "invalid" } as const);
  });
}

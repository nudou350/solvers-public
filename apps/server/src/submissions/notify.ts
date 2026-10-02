import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { sendTelegram } from "../notify/telegram.js";

// Avisos da revisão pelo Telegram (PACKAGE_SPEC.md 14.5): o admin é avisado de nova submissão e de mudança de estado; o
// criador, quando tem Telegram vinculado, das decisões. Melhor esforço: falha de aviso nunca derruba o fluxo.

const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

export async function notifyAdmin(text: string): Promise<void> {
  try {
    await sendTelegram(env.TELEGRAM_ADMIN_CHAT_ID, text);
  } catch (e) {
    console.warn("[submissions] aviso ao admin falhou:", (e as Error).message);
  }
}

export async function notifyCreatorWallet(wallet: string, text: string): Promise<void> {
  try {
    const [c] = await db.select({ chat: schema.creators.telegramChatId }).from(schema.creators).where(eq(schema.creators.wallet, wallet));
    if (c?.chat) await sendTelegram(c.chat, text);
  } catch (e) {
    console.warn("[submissions] aviso ao criador falhou:", (e as Error).message);
  }
}

type Subject = { id: string; slug: string; version: string; creatorWallet: string; name?: string | null };

const label = (s: Subject) => `${s.name ?? (s.slug || "(sem nome)")} ${s.version ? `v${s.version}` : ""}`.trim();

/** Texto de cada mudança de estado para o admin. */
export function adminMessage(event: "submitted" | "pending_review" | "rejected_validation" | "creator_signed" | "resubmitted", s: Subject, extra?: string): string {
  const head = `Solvers: submissão ${label(s)} (${short(s.creatorWallet)}) `;
  switch (event) {
    case "submitted":
      return `${head}chegou e vai ser validada.`;
    case "resubmitted":
      return `${head}foi reenviada com mudanças.`;
    case "pending_review":
      return `${head}passou na validação e espera revisão. ${extra ?? ""}`.trim();
    case "rejected_validation":
      return `${head}foi reprovada pelo validador. ${extra ?? ""}`.trim();
    case "creator_signed":
      return `${head}foi assinada pelo criador. ${extra ?? ""}`.trim();
  }
}

export function creatorMessage(event: "pending_review" | "rejected_validation" | "changes_requested" | "rejected" | "approved", s: Subject, notes?: string): string {
  const what = label(s);
  switch (event) {
    case "pending_review":
      return `Solvers: seu pacote ${what} passou na validação e entrou na fila de revisão (meta: 5 dias úteis).`;
    case "rejected_validation":
      return `Solvers: seu pacote ${what} não passou na validação. Abra o envio no site para ver os erros e corrigir.`;
    case "changes_requested":
      return `Solvers: o revisor pediu mudanças em ${what}.${notes ? `\n\n${notes.slice(0, 600)}` : ""}`;
    case "rejected":
      return `Solvers: ${what} não foi aprovado.${notes ? `\n\n${notes.slice(0, 600)}` : ""}`;
    case "approved":
      return `Solvers: ${what} foi aprovado na revisão. Falta você assinar o registro no site para publicar.`;
  }
}

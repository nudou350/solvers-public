import { and, count, eq, gt, ne, or, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { sha256Hex } from "../lib/crypto.js";
import { QUOTA_WINDOW_MS, quotaExceeded, quotaText } from "./search-rules.js";

// Cota diária de search_knowledge por carteira + especialista (PACKAGE_SPEC.md 6.5, item 2). Conta as
// linhas de `usage_events` que o conector já grava a cada chamada (sem tabela nova). As respostas de
// "limite atingido" não entram na conta: senão cada tentativa prolongaria o bloqueio.

/** Consultas da carteira a este especialista nas últimas 24 horas (sem as respostas de limite atingido). */
export async function searchesInWindow(wallet: string, agentId: string, quota = env.SEARCH_DAILY_QUOTA, now = new Date()): Promise<number> {
  const blocked = sha256Hex(quotaText(quota));
  const [row] = await db
    .select({ n: count() })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.wallet, wallet),
        eq(schema.usageEvents.agentId, agentId),
        eq(schema.usageEvents.tool, "search_knowledge"),
        gt(schema.usageEvents.createdAt, new Date(now.getTime() - QUOTA_WINDOW_MS)),
        or(isNull(schema.usageEvents.responseHash), ne(schema.usageEvents.responseHash, blocked)),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Texto de "limite diário atingido" se a carteira já passou da cota; null se pode consultar (ou a cota está desligada). */
export async function searchQuotaBlock(wallet: string, agentId: string, quota = env.SEARCH_DAILY_QUOTA): Promise<string | null> {
  if (quota <= 0) return null;
  return quotaExceeded(await searchesInWindow(wallet, agentId, quota), quota) ? quotaText(quota) : null;
}

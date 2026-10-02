import type { TelegramApi, TgUpdate } from "./api.js";
import { createFailureLimiter, parseCommand, replyText, type LinkOutcome } from "./link-rules.js";
import type { RedeemResult } from "./link-store.js";

// Laço do bot (long polling de getUpdates) que trata `/vincular <código>` e `/start <código>` (deep link do site). Roda só
// no processo solvers-worker, o ÚNICO que faz polling (dois pollers com o mesmo token se derrubam com 409). Nada aqui lê
// env nem banco: o Telegram e o resgate do código entram por `PollDeps`, e o teste usa os de mentira.

export type PollDeps = {
  api: TelegramApi;
  redeem: (chatId: string, code: string, now: Date) => Promise<RedeemResult>;
  now?: () => Date;
  /** @usuário do bot, para ignorar `/vincular@outrobot` em grupos. */
  botUsername?: string | null;
  limiter?: ReturnType<typeof createFailureLimiter>;
  log?: (msg: string) => void;
};

const toOutcome = (r: RedeemResult): LinkOutcome => (r.status === "linked" ? { kind: "linked", name: r.name } : r.status === "chat_taken" ? { kind: "chat_taken" } : { kind: "invalid" });

/** Trata uma atualização. Só chats privados com texto contam; o resto é ignorado em silêncio. */
export async function processUpdate(update: TgUpdate, deps: PollDeps): Promise<"ignored" | "replied"> {
  const m = update.message;
  if (!m || m.chat.type !== "private" || typeof m.text !== "string") return "ignored";
  const chatId = String(m.chat.id);
  const now = (deps.now ?? (() => new Date()))();
  const limiter = deps.limiter ?? defaultLimiter;
  const cmd = parseCommand(m.text, deps.botUsername);

  let outcome: LinkOutcome;
  if (cmd.kind === "other" || (cmd.arg === "" && cmd.command === "start")) outcome = { kind: "help" };
  else if (cmd.arg === "") outcome = { kind: "usage" };
  else if (limiter.blocked(chatId, now.getTime())) outcome = { kind: "throttled" };
  else {
    const result = await deps.redeem(chatId, cmd.arg, now);
    outcome = toOutcome(result);
    if (result.status === "linked") limiter.clear(chatId);
    else if (result.status === "invalid") limiter.fail(chatId, now.getTime());
  }
  await deps.api.sendMessage(chatId, replyText(outcome));
  return "replied";
}

const defaultLimiter = createFailureLimiter();

export type PollOptions = { timeoutSec?: number; backoffMinMs?: number; backoffMaxMs?: number };

const sleep = (ms: number, stopped: () => boolean) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    const tick = setInterval(() => stopped() && done(), 250);
    function done() {
      clearTimeout(t);
      clearInterval(tick);
      resolve();
    }
  });

/**
 * Laço do bot: getUpdates com long polling (~25 s), offset só em memória (uma atualização repetida depois de um reinício só
 * gera uma resposta a mais, sem efeito: o código é de uso único), backoff exponencial em erro e parada limpa (SIGTERM).
 * Sem cliente (TELEGRAM_BOT_TOKEN ausente) o laço fica desligado.
 */
export async function runTelegramPolling(stopped: () => boolean, deps: Omit<PollDeps, "api"> & { api: TelegramApi | null }, opts: PollOptions = {}): Promise<void> {
  const log = deps.log ?? ((m: string) => console.log(`[telegram] ${m}`));
  const { api } = deps;
  if (!api) {
    log("TELEGRAM_BOT_TOKEN não configurado: o bot de vinculação fica desligado");
    return;
  }
  const full: PollDeps = { ...deps, api, log };
  const timeoutSec = opts.timeoutSec ?? 25;
  const backoffMin = opts.backoffMinMs ?? 1000;
  const backoffMax = opts.backoffMaxMs ?? 60_000;
  let backoff = backoffMin;
  let offset = 0;
  let webhookCleared = false;
  log("ouvindo o bot (getUpdates)");

  while (!stopped()) {
    const ac = new AbortController();
    const watch = setInterval(() => stopped() && ac.abort(), 250);
    let updates: TgUpdate[];
    try {
      updates = await api.getUpdates({ offset, timeoutSec, signal: ac.signal });
      backoff = backoffMin;
    } catch (e) {
      if (stopped()) break;
      const err = e as Error & { status?: number };
      if (err.status === 409 && /webhook/i.test(err.message) && !webhookCleared) {
        // O bot tinha webhook ativo (getUpdates e webhook não convivem): remove uma vez e segue.
        webhookCleared = true;
        log("webhook ativo no bot: chamando deleteWebhook (uma vez)");
        await api.deleteWebhook().catch((d: Error) => log(`deleteWebhook falhou: ${d.message}`));
        continue;
      }
      log(`getUpdates falhou (${err.message}); nova tentativa em ${Math.round(backoff / 1000)}s`);
      await sleep(backoff, stopped);
      backoff = Math.min(backoff * 2, backoffMax);
      continue;
    } finally {
      clearInterval(watch);
    }
    for (const u of updates) {
      // O offset avança mesmo se o tratamento falhar: uma mensagem ruim não pode travar o laço.
      offset = Math.max(offset, u.update_id + 1);
      try {
        await processUpdate(u, full);
      } catch (e) {
        log(`falha ao tratar a atualização ${u.update_id}: ${(e as Error).message}`);
      }
    }
  }
}

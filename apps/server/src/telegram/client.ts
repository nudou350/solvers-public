import { env } from "../env.js";
import { createTelegramApi, type TelegramApi } from "./api.js";

// O bot do Solvers para este processo: `null` quando TELEGRAM_BOT_TOKEN não está configurado. O @usuário do bot vem de
// `getMe` e fica em cache (a rota de vínculo e o GET /creator/me não chamam o Telegram a cada pedido).

let real: TelegramApi | null = null;
let override: TelegramApi | null | undefined;

export function telegramApi(): TelegramApi | null {
  if (override !== undefined) return override;
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  real ??= createTelegramApi(env.TELEGRAM_BOT_TOKEN);
  return real;
}

/** Só para teste: troca (ou, com `undefined`, restaura) o cliente do Telegram e zera o cache do @usuário. */
export function setTelegramApiForTests(api: TelegramApi | null | undefined): void {
  override = api;
  cache = null;
}

const OK_TTL_MS = 60 * 60_000;
const FAIL_TTL_MS = 30_000;
let cache: { api: TelegramApi; username: string | null; at: number } | null = null;

/** @usuário do bot (sem o @), ou null se o bot não está configurado ou o Telegram não respondeu (falha dura 30 s no cache). */
export async function botUsername(api: TelegramApi | null = telegramApi(), now: () => number = Date.now): Promise<string | null> {
  if (!api) return null;
  if (cache && cache.api === api && now() - cache.at < (cache.username ? OK_TTL_MS : FAIL_TTL_MS)) return cache.username;
  let username: string | null = null;
  try {
    username = (await api.getMe()).username;
  } catch (e) {
    console.warn("[telegram] getMe falhou:", (e as Error).message);
  }
  cache = { api, username, at: now() };
  return username;
}

// Cliente mínimo da Bot API do Telegram (só o que a vinculação usa). O token fica no escopo da função: nunca vai para log,
// mensagem de erro nem resposta. Atrás da interface `TelegramApi` para o teste trocar por um de mentira (sem rede).

export type TgMessage = { message_id: number; text?: string; chat: { id: number; type: string } };
export type TgUpdate = { update_id: number; message?: TgMessage };

export interface TelegramApi {
  getMe(): Promise<{ username: string | null }>;
  /** Long polling: devolve [] quando passa `timeoutSec` sem mensagens. `signal` aborta a espera (parada do processo). */
  getUpdates(p: { offset: number; timeoutSec: number; signal?: AbortSignal }): Promise<TgUpdate[]>;
  sendMessage(chatId: string | number, text: string): Promise<void>;
  deleteWebhook(): Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(
    /** Status HTTP (0 = falha de rede ou abortada). */
    public status: number,
    message: string,
    public aborted = false,
  ) {
    super(message);
  }
}

type Envelope<T> = { ok: boolean; result?: T; description?: string };

export function createTelegramApi(token: string, f: typeof fetch = fetch): TelegramApi {
  const scrub = (s: string) => s.split(token).join("***");

  async function call<T>(method: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await f(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      const err = e as Error;
      throw new TelegramApiError(0, scrub(`${method}: ${err.name === "AbortError" || err.name === "TimeoutError" ? "interrompido" : err.message}`), signal?.aborted === true);
    }
    const json = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (!res.ok || !json.ok) throw new TelegramApiError(res.status, scrub(`${method}: ${json.description ?? res.statusText}`));
    return json.result as T;
  }

  return {
    async getMe() {
      const me = await call<{ username?: string }>("getMe", {}, 8000);
      return { username: me.username ?? null };
    },
    getUpdates: ({ offset, timeoutSec, signal }) =>
      call<TgUpdate[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] }, (timeoutSec + 10) * 1000, signal),
    async sendMessage(chatId, text) {
      await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, 8000);
    },
    async deleteWebhook() {
      await call("deleteWebhook", { drop_pending_updates: false }, 8000);
    },
  };
}

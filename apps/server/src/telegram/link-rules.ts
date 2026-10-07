import { createHash, randomBytes } from "node:crypto";

// Regras puras da vinculação do Telegram do criador (PACKAGE_SPEC.md 14.1): código curto, hash, validade, limite por hora,
// leitura do comando do bot e escolha da resposta. Sem banco, rede nem env: testadas em test/telegram-link-rules.test.ts.

/** Sem 0/O/1/I: o código é digitado ou colado a partir do site. 32 símbolos, então `byte % 32` não tem viés. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_PREFIX = "LINK-";
export const LINK_CHARS = 8;
export const LINK_TTL_MS = 15 * 60_000;
export const LINK_MAX_PER_WINDOW = 5;
export const LINK_WINDOW_MS = 60 * 60_000;
/** Tentativas erradas por chat (por hora) antes de o bot parar de conferir códigos. */
export const CHAT_MAX_FAILURES = 10;

/** `LINK-` + 8 caracteres (40 bits), válido por 15 min, uso único e guardado só como hash: força bruta não compensa. */
export function generateLinkCode(bytes: Uint8Array = randomBytes(LINK_CHARS)): string {
  return LINK_PREFIX + Array.from(bytes.slice(0, LINK_CHARS), (b) => ALPHABET[b % ALPHABET.length]!).join("");
}

/**
 * O que a pessoa colou vira o código canônico (`LINK-XXXXXXXX`), ou null se não tem o formato. Aceita sem o prefixo, em
 * minúsculas, com espaço ou hífen no meio.
 */
export function normalizeLinkCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s\-_]/g, "");
  const body = s.length === LINK_PREFIX.length - 1 + LINK_CHARS && s.startsWith("LINK") ? s.slice(4) : s;
  if (body.length !== LINK_CHARS) return null;
  for (const ch of body) if (!ALPHABET.includes(ch)) return null;
  return LINK_PREFIX + body;
}

/** Hash do código canônico (o banco nunca guarda o código). */
export const hashLinkCode = (code: string): string => createHash("sha256").update(`telegram-link:${code}`).digest("hex");

export const linkExpiry = (now: Date): Date => new Date(now.getTime() + LINK_TTL_MS);

/** O código ainda vale (existe e não venceu)? */
export const linkIsLive = (expiresAt: Date | null | undefined, now: Date): boolean => expiresAt != null && expiresAt.getTime() > now.getTime();

export type IssueWindow = { windowStart: Date | null; count: number };
export type IssuePlan = { ok: true; windowStart: Date; count: number } | { ok: false; retryAfterSec: number };

/** No máximo 5 códigos por hora por criador: janela de 1 h que começa no primeiro código e zera quando acaba. */
export function planIssue(state: IssueWindow, now: Date): IssuePlan {
  const start = state.windowStart;
  if (!start || now.getTime() - start.getTime() >= LINK_WINDOW_MS || state.count < 0) return { ok: true, windowStart: now, count: 1 };
  if (state.count >= LINK_MAX_PER_WINDOW) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((start.getTime() + LINK_WINDOW_MS - now.getTime()) / 1000)) };
  return { ok: true, windowStart: start, count: state.count + 1 };
}

export const deepLinkOf = (botUsername: string, code: string): string => `https://t.me/${botUsername}?start=${code}`;

// ---------------------------------------------------------------------------------------------------------------
// Comandos do bot

export type Command = { kind: "link"; command: "start" | "vincular"; arg: string } | { kind: "other" };

/**
 * `/vincular CODIGO`, `/start CODIGO` (deep link) e as formas `/vincular@meubot CODIGO`. Em grupo, o comando para outro bot
 * (`@outrobot`) não é nosso. Qualquer outro texto vira `other` (o bot responde com a ajuda).
 */
export function parseCommand(text: string, botUsername?: string | null): Command {
  const m = /^\/(start|vincular)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return { kind: "other" };
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return { kind: "other" };
  // Só a primeira palavra conta: "/vincular LINK-ABCD2345 obrigado" ainda vincula.
  const arg = (m[3] ?? "").trim().split(/\s+/)[0] ?? "";
  return { kind: "link", command: m[1]!.toLowerCase() as "start" | "vincular", arg };
}

/** Limite de tentativas erradas por chat (em memória, só no processo do bot). */
export function createFailureLimiter(max = CHAT_MAX_FAILURES, windowMs = LINK_WINDOW_MS) {
  const hits = new Map<string, number[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  return {
    blocked: (key: string, now: number): boolean => recent(key, now).length >= max,
    fail(key: string, now: number): void {
      const list = recent(key, now);
      list.push(now);
      hits.set(key, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    },
    clear: (key: string): void => void hits.delete(key),
  };
}

export type LinkOutcome =
  | { kind: "linked"; name: string }
  | { kind: "invalid" } // código errado, vencido ou já usado: não diz qual
  | { kind: "chat_taken" }
  | { kind: "throttled" }
  | { kind: "usage" }
  | { kind: "help" };

/** Resposta do bot em texto simples (sem formatação, para não depender de escape do Telegram). */
export function replyText(o: LinkOutcome): string {
  switch (o.kind) {
    case "linked":
      return `Done! Your Telegram is now linked to Solvers as ${o.name}.`;
    case "invalid":
      return "That code isn't valid: it may be wrong, expired or already used. Generate a new one on the site, under Creator > Publish, and send it here.";
    case "chat_taken":
      return "This Telegram account is already linked to another Solvers creator. Use another Telegram account or contact the team.";
    case "throttled":
      return "Too many attempts with a wrong code. Wait an hour and generate a new code on the site.";
    case "usage":
      return "Send the command with the code shown on the site, like this: /vincular LINK-ABCD2345";
    case "help":
      return "To link your Telegram, generate a code on the Solvers site (Creator > Publish) and send it here: /vincular YOUR-CODE";
  }
}

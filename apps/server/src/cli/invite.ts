import { desc, eq, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/index.js";
import { generateInviteCode, normalizeInviteCode } from "../submissions/rules.js";

// Convites de criador e vínculo do Telegram (PACKAGE_SPEC.md 14.1, D14). Rode no servidor (ou com o túnel do banco).
// Com pnpm NÃO use o `--` extra: o pnpm o repassa ao script e o comando quebra. Na pasta apps/server:
//
//   pnpm cli:invite create [--email fulano@x.com] [--note "quem é"] [--count 3]   # gera código(s); você envia por e-mail
//   pnpm cli:invite list                                                          # todos, com quem usou
//   pnpm cli:invite revoke <código>                                               # apaga um convite ainda não usado
//   pnpm cli:invite set-chat <carteira> <chatId>                                  # atalho do admin: vincula o Telegram do criador
//
// Na raiz do repositório: `pnpm --filter @solvers/server cli:invite create ...` (mesma forma, sem `--`).
// O criador normalmente vincula sozinho pelo site (POST /creator/telegram-link + /vincular no bot); `set-chat` é o atalho.

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function create() {
  const count = Math.max(1, Math.min(50, Number(opt("--count") ?? 1) || 1));
  for (let i = 0; i < count; i++) {
    const code = generateInviteCode();
    await db.insert(schema.creatorInvites).values({ code, email: opt("--email") ?? null, note: opt("--note") ?? null });
    console.log(code);
  }
}

async function list() {
  const rows = await db.select().from(schema.creatorInvites).orderBy(desc(schema.creatorInvites.createdAt));
  if (rows.length === 0) return console.log("nenhum convite");
  for (const r of rows) {
    const state = r.usedAt ? `usado por ${r.wallet} em ${r.usedAt.toISOString()}` : "livre";
    console.log(`${r.code}  ${state}${r.email ? `  <${r.email}>` : ""}${r.note ? `  (${r.note})` : ""}`);
  }
}

async function revoke() {
  const code = normalizeInviteCode(rest[0] ?? "");
  if (!code) throw new Error("uso: revoke <código>");
  const gone = await db.delete(schema.creatorInvites).where(sql`${schema.creatorInvites.code} = ${code} and ${schema.creatorInvites.usedAt} is null`).returning({ code: schema.creatorInvites.code });
  if (gone.length === 0) {
    const [row] = await db.select().from(schema.creatorInvites).where(eq(schema.creatorInvites.code, code));
    throw new Error(row ? "esse convite já foi usado e não pode ser revogado" : "convite não encontrado");
  }
  console.log(`convite ${code} revogado`);
}

async function setChat() {
  const [wallet, chatId] = rest;
  if (!wallet || !chatId) throw new Error("uso: set-chat <carteira> <chatId>");
  const upd = await db.update(schema.creators).set({ telegramChatId: chatId }).where(eq(schema.creators.wallet, wallet)).returning({ id: schema.creators.id, name: schema.creators.name });
  if (upd.length === 0) throw new Error("nenhum criador com essa carteira (o criador precisa ter cadastrado o perfil no site)");
  console.log(`Telegram vinculado a ${upd[0]!.name} (${upd[0]!.id}); contato verificado.`);
}

try {
  if (cmd === "create") await create();
  else if (cmd === "list") await list();
  else if (cmd === "revoke") await revoke();
  else if (cmd === "set-chat") await setChat();
  else {
    console.error("uso: cli:invite create|list|revoke|set-chat (veja o cabeçalho de src/cli/invite.ts)");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`erro: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

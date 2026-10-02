import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { CreatorProfileInput, type CreatorMe, type SubmissionView } from "@solvers/shared";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { randomId } from "../lib/crypto.js";
import { h, HttpError, notFound, parse } from "../lib/http.js";
import { manifestJsonSchema } from "../runtime/validate/json-schema.js";
import { adminRouter } from "../submissions/admin-routes.js";
import { isNewAgent, listColumns, newAgentSet } from "../submissions/lookup.js";
import { SUBMISSION_ID_RE } from "../submissions/paths.js";
import { creatorNotReady, isAdminWallet, normalizeInviteCode, toSubmissionView } from "../submissions/rules.js";

// Dono: agente B1 (envio de pacotes). Rotas do criador e da revisão no site (PACKAGE_SPEC.md 14.4), montadas sob /api:
//   GET /creator/me, POST /creator/profile, GET /creator/submissions[/:id]
//   GET /admin/submissions[/:id[/file|/knowledge-search]], POST /admin/submissions/:id/(approve|request-changes|reject)  (admin-routes.ts)
//   GET /spec/manifest.schema.json
// O upload (POST /creator/submissions, corpo cru em streaming) fica em submissions/upload.ts e é montado em app.ts antes do express.json.
export const creatorRouter: Router = Router();

type CreatorRow = typeof schema.creators.$inferSelect;

function meOf(wallet: string, c: CreatorRow | undefined): CreatorMe {
  return {
    wallet,
    hasProfile: !!c,
    invited: c?.invited ?? false,
    termsAccepted: c?.termsAcceptedAt != null,
    name: c?.name ?? null,
    bio: c?.bio ?? null,
    // Contato de escalonamento verificado = Telegram vinculado (por ora pelo admin: cli:invite set-chat).
    contactVerified: c?.telegramChatId != null,
    canSubmit: creatorNotReady(c) === null,
    isAdmin: isAdminWallet(wallet, env.ADMIN_WALLETS),
  };
}

async function creatorOf(wallet: string): Promise<CreatorRow | undefined> {
  const [c] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, wallet));
  return c;
}

creatorRouter.get(
  "/creator/me",
  requireAuth,
  h(async (req): Promise<CreatorMe> => {
    const wallet = requireWallet(req);
    return meOf(wallet, await creatorOf(wallet));
  }),
);

/**
 * Cadastro/atualização do perfil. O 1º cadastro exige um convite válido e ainda não usado: a carteira vira a dona do convite
 * e `creators.invited` passa a true, tudo numa transação (dois cadastros com o mesmo código não passam os dois).
 */
creatorRouter.post(
  "/creator/profile",
  requireAuth,
  h(async (req): Promise<CreatorMe> => {
    const wallet = requireWallet(req);
    const body = parse(CreatorProfileInput, req.body);
    await db.transaction(async (tx) => {
      // Trava por carteira: dois envios do mesmo formulário viram um cadastro só.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`creator-profile:${wallet}`}, 0))`);
      const [existing] = await tx.select().from(schema.creators).where(eq(schema.creators.wallet, wallet));
      if (existing?.invited) {
        await tx
          .update(schema.creators)
          .set({ name: body.name, bio: body.bio, termsAcceptedAt: existing.termsAcceptedAt ?? new Date() })
          .where(eq(schema.creators.id, existing.id));
        return;
      }
      if (!body.inviteCode) throw new HttpError(400, "Informe o código de convite para criar seu perfil de criador.", "invite_required");
      const code = normalizeInviteCode(body.inviteCode);
      const claimed = await tx
        .update(schema.creatorInvites)
        .set({ wallet, usedAt: new Date() })
        .where(sql`${schema.creatorInvites.code} = ${code} and ${schema.creatorInvites.usedAt} is null`)
        .returning({ code: schema.creatorInvites.code });
      if (claimed.length === 0) {
        const [known] = await tx.select({ code: schema.creatorInvites.code }).from(schema.creatorInvites).where(eq(schema.creatorInvites.code, code));
        if (known) throw new HttpError(409, "Este convite já foi usado.", "invite_used");
        throw new HttpError(400, "Convite inválido. Confira o código que você recebeu.", "invite_invalid");
      }
      const now = new Date();
      if (existing) {
        await tx.update(schema.creators).set({ name: body.name, bio: body.bio, invited: true, termsAcceptedAt: now }).where(eq(schema.creators.id, existing.id));
      } else {
        await tx.insert(schema.creators).values({ id: `cr_${randomId(8)}`, wallet, name: body.name, bio: body.bio, invited: true, termsAcceptedAt: now });
      }
    });
    return meOf(wallet, await creatorOf(wallet));
  }),
);

creatorRouter.get(
  "/creator/submissions",
  requireAuth,
  h(async (req): Promise<SubmissionView[]> => {
    const wallet = requireWallet(req);
    // Colunas leves: nada do manifesto inteiro (só o nome, truncado no banco), de `scans` ou de `approved`.
    const rows = await db
      .select({ ...listColumns, validation: schema.packageSubmissions.validation })
      .from(schema.packageSubmissions)
      .where(eq(schema.packageSubmissions.creatorWallet, wallet))
      .orderBy(desc(schema.packageSubmissions.createdAt))
      .limit(100);
    const fresh = await newAgentSet([...new Set(rows.map((r) => r.agentId))]);
    return rows.map((r) => toSubmissionView({ ...r, manifest: r.name ? { name: r.name } : null }, fresh.has(r.agentId)));
  }),
);

creatorRouter.get(
  "/creator/submissions/:id",
  requireAuth,
  h(async (req): Promise<SubmissionView> => {
    const wallet = requireWallet(req);
    const id = String(req.params.id);
    if (!SUBMISSION_ID_RE.test(id)) throw notFound("Envio não encontrado.");
    const [row] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
    // Envio de outro criador responde 404, não 403: não confirma que o id existe.
    if (!row || row.creatorWallet !== wallet) throw notFound("Envio não encontrado.");
    return toSubmissionView(row, await isNewAgent(row.agentId));
  }),
);

/** Schema do manifesto v1 (o mesmo do `cli:schema`): público, só para autocompletar; quem decide é o validador. */
creatorRouter.get("/spec/manifest.schema.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(manifestJsonSchema());
});

creatorRouter.use(adminRouter);

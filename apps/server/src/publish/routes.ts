import { Router } from "express";
import { z } from "zod";
import { PublicationConfirmInput, PublicationTxInput, type TxResponse } from "@solvers/shared";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { h, notFound, parse } from "../lib/http.js";
import { requireAdminWallet } from "./admin.js";
import { publishChain } from "./chain-port.js";
import { finalizePublication } from "./finalize.js";
import { registerPublishListeners } from "./reconcile.js";
import { buildPublicationTx, confirmPublication, publicationPlan, publicationResult } from "./tx.js";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

// Dono: agente B2 (publicação on-chain). Rotas de transação co-assinada pelo criador e a conclusão do admin
// (PACKAGE_SPEC.md 14.4 e 15). Montado sob /api em modules.ts:
//   POST /tx/register-agent | /tx/update-version | /tx/update-pricing   { submissionId } -> TxResponse (o criador co-assina e usa /tx/submit)
//   GET  /tx/publication/:submissionId                                   -> PublicationPlan (o que falta)
//   POST /tx/publication/confirm                                         { submissionId, signature, kind? } -> PublicationResult
//   POST /admin/submissions/:id/finish                                   (admin) -> PublicationResult
export const publishRouter: Router = Router();

// Os eventos da cadeia (register/versão/preço/aprovação) destravam a submissão por qualquer caminho de indexação.
registerPublishListeners();

for (const kind of ["register-agent", "update-version", "update-pricing"] as const) {
  publishRouter.post(
    `/tx/${kind}`,
    requireAuth,
    h(async (req): Promise<TxResponse> => {
      const wallet = requireWallet(req);
      const { submissionId } = parse(PublicationTxInput, req.body);
      return buildPublicationTx(kind, wallet, submissionId, publishChain());
    }),
  );
}

publishRouter.get(
  "/tx/publication/:submissionId",
  requireAuth,
  h(async (req) => publicationPlan(String(req.params.submissionId), requireWallet(req), publishChain())),
);

publishRouter.post(
  "/tx/publication/confirm",
  requireAuth,
  h(async (req) => confirmPublication(parse(PublicationConfirmInput, req.body), requireWallet(req), publishChain())),
);

/** Conclui a publicação quando o evento de aprovação on-chain não chegou sozinho (ou depois de `publish_failed`). Idempotente. */
publishRouter.post(
  "/admin/submissions/:id/finish",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    requireAdminWallet(wallet);
    const id = String(parse(z.object({ id: z.string().min(1).max(64) }), req.params).id);
    const [sub] = await db.select({ id: schema.packageSubmissions.id }).from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
    if (!sub) throw notFound("Submission not found");
    const result = await finalizePublication(id, { actor: wallet });
    return publicationResult(id, result, publishChain());
  }),
);

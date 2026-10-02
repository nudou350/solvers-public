import { Router } from "express";

// Dono: agente B1 (envio de pacotes). Rotas do criador e da revisão no site (PACKAGE_SPEC.md 14.4):
//   /creator/me, /creator/profile, /creator/submissions[/:id], /admin/submissions[...], /spec/manifest.schema.json
export const creatorRouter: Router = Router();

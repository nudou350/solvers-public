import { Router } from "express";

// Dono: agente B2 (publicação on-chain). Rotas de transação co-assinada pelo criador e a conclusão do admin (PACKAGE_SPEC.md 14.4, 15):
//   POST /tx/register-agent | /tx/update-version | /tx/update-pricing, POST /admin/submissions/:id/finish
export const publishRouter: Router = Router();

import type { Mount } from "./app.js";
import { env } from "./env.js";
import { jobs } from "./jobs.js";
import { creatorRouter } from "./creator/routes.js";
import { mountMcp } from "./mcp/routes.js";
import { publishRouter } from "./publish/routes.js";
import { mountOAuth } from "./oauth/routes.js";
import { escrowRouter } from "./store/escrow.js";
import { helpRouter } from "./store/help.js";
import { imagesRouter } from "./store/images.js";
import { meRouter } from "./store/me.js";
import { resaleRouter } from "./store/resale.js";
import { mountPreview } from "./verifier/preview.js";
import { x402Router } from "./x402/routes.js";

// Ponto único onde os módulos se registram no app (rotas extras e jobs periódicos).

export const mounts: Mount[] = [
  mountOAuth,
  mountMcp,
  mountPreview,
  (app) => {
    app.use("/api", escrowRouter);
    app.use("/api", imagesRouter);
    app.use("/api", helpRouter);
    app.use("/api", resaleRouter);
    app.use("/api", meRouter);
    app.use("/api", creatorRouter);
    app.use("/api", publishRouter);
    // Compra por x402 (agentes de IA): só existe com X402_ENABLED; desligada, a rota responde 404 (rollback = desligar a flag).
    if (env.X402_ENABLED) app.use("/api", x402Router);
  },
];

export function startJobs() {
  for (const j of jobs) j.start();
}

export function stopJobs() {
  for (const j of jobs) j.stop();
}

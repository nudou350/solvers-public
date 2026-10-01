import type { Mount } from "./app.js";
import { jobs } from "./jobs.js";
import { mountMcp } from "./mcp/routes.js";
import { mountOAuth } from "./oauth/routes.js";
import { escrowRouter } from "./store/escrow.js";
import { helpRouter } from "./store/help.js";
import { imagesRouter } from "./store/images.js";
import { meRouter } from "./store/me.js";
import { resaleRouter } from "./store/resale.js";
import { mountPreview } from "./verifier/preview.js";

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
  },
];

export function startJobs() {
  for (const j of jobs) j.start();
}

export function stopJobs() {
  for (const j of jobs) j.stop();
}

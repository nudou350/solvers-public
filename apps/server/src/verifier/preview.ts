import type { Express } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { milestoneDir, readDeliverable } from "./deliverables.js";

// Prévia da entrega com marca d'água (INSTRUCTIONS.md 5.7). O link é secreto (token no query) e
// mostra o HTML estático do componente, renderizado DENTRO do sandbox do verificador. Nenhum
// código-fonte sai daqui: o download só existe depois da aprovação.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FRAME_CSS = `body{font-family:system-ui,sans-serif;margin:16px;color:#1b1b1f}
input,button,select,textarea{font:inherit;padding:8px 10px;margin:4px 0;border:1px solid #c9c9c3;border-radius:8px}
button{background:#1b1b1f;color:#fff;border:0;cursor:default}
label{display:block;margin-top:8px;font-weight:600}
[role=alert]{color:#b42318}`;

export function mountPreview(app: Express) {
  app.get("/preview/:escrow/:idx", async (req, res) => {
    const idx = Number(req.params.idx);
    const token = typeof req.query.t === "string" ? req.query.t : "";
    if (!Number.isInteger(idx) || idx < 0 || idx > 4 || !token) {
      res.status(404).type("text").send("Preview not found");
      return;
    }
    const [m] = await db
      .select()
      .from(schema.milestones)
      .where(and(eq(schema.milestones.escrowId, String(req.params.escrow)), eq(schema.milestones.idx, idx)));
    // Só enquanto a etapa está aprovada nos testes ou aprovada pelo comprador (não após disputa/reembolso).
    if (!m?.previewUrl || !m.previewUrl.endsWith(`t=${token}`) || !["passed", "approved"].includes(m.status)) {
      res.status(404).type("text").send("Preview not found");
      return;
    }
    const previewFile = join(milestoneDir(m.escrowId, idx), "preview.html");
    const html = existsSync(previewFile) ? readFileSync(previewFile, "utf8") : null;
    const fileNames = m.deliverablePath ? Object.keys(readDeliverable(m.deliverablePath)) : [];
    const report = (m.verifierReport ?? {}) as {
      numPassed?: number;
      numTests?: number;
      mode?: string;
      acceptance?: { numTests: number; numPassed: number } | null;
      selfWrittenTestsOnly?: boolean;
    };
    const frame = html
      ? `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`
      : null;
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:; frame-ancestors 'self'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    const acceptanceLine = report.acceptance
      ? `${report.acceptance.numPassed}/${report.acceptance.numTests} agreed acceptance tests`
      : "tests written in the delivery itself (no acceptance test suite)";
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Delivery preview</title>
<style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f6f6f3;color:#1b1b1f}
header{padding:16px 20px;border-bottom:1px solid #e5e5df;background:#fff}
.band{background:repeating-linear-gradient(-45deg,#6b4ce6 0 14px,#5a3fd0 14px 28px);color:#fff;text-align:center;font-weight:700;letter-spacing:.2em;padding:6px}
main{max-width:900px;margin:20px auto;padding:0 16px}
.frame{position:relative;border:1px solid #e5e5df;border-radius:12px;overflow:hidden;background:#fff}
.frame iframe{width:100%;height:420px;border:0}
.wm{position:absolute;inset:0;pointer-events:none;display:grid;place-items:center;font-size:48px;font-weight:800;color:rgba(107,76,230,.12);transform:rotate(-20deg)}
.ok{color:#067647;font-weight:600}
ul{padding-left:18px}
</style></head><body>
<div class="band">PREVIEW · SOLVERS</div>
<header><strong>Step ${idx + 1}: ${esc(m.title)}</strong><br>
<span class="ok">${
      report.mode === "manual"
        ? "Manual review: read the delivery and approve or dispute it before the deadline"
        : `✔ ${report.numPassed ?? 0}/${report.numTests ?? 0} tests passed · ${esc(acceptanceLine)}${report.mode === "simulated" ? " (simulated check)" : ""}`
    }</span></header>
<main>
${frame ? `<div class="frame"><iframe sandbox srcdoc="${esc(frame)}" title="Delivered component (static preview)"></iframe><div class="wm">PREVIEW</div></div>` : "<p>Visual preview is not available for this delivery.</p>"}
<h3>Delivered files</h3>
<ul>${fileNames.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
${report.mode === "manual" ? "" : "<p>The full code becomes available to download after you approve the step (or when the automatic approval deadline ends).</p>"}
<h3>Agreed criteria</h3><p>${esc(m.criteria)}</p>
</main></body></html>`);
  });
}

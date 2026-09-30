import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { readDeliverable } from "./deliverables.js";

// Prévia da entrega com marca d'água (INSTRUCTIONS.md 5.7). O link é secreto (token no query) e
// mostra o componente renderizado num iframe isolado + o relatório dos testes. O código-fonte
// completo só é liberado para download depois da aprovação.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function componentEntry(files: Record<string, string>): [string, string] | null {
  const entry = Object.entries(files).find(([n, c]) => /\.(tsx|jsx)$/.test(n) && !/\.test\./.test(n) && /export\s+(default\s+)?function|export\s+const/.test(c));
  return entry ?? null;
}

/** HTML isolado que transpila o componente no navegador (Babel standalone) e o renderiza. */
function sandboxDoc(name: string, code: string): string {
  const exportName = /export\s+default\s+function\s+(\w+)/.exec(code)?.[1] ?? /export\s+(?:function|const)\s+(\w+)/.exec(code)?.[1] ?? "Component";
  const src = code
    .replace(/^import[^;]+;?$/gm, "")
    .replace(/export\s+default\s+/g, "")
    .replace(/export\s+(function|const)/g, "$1");
  const payload = JSON.stringify({ src, exportName, name }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<style>body{font-family:system-ui,sans-serif;margin:16px}</style></head><body><div id="root"></div>
<script>
const P = ${payload};
try {
  const { useState, useEffect, useRef, useId, useMemo, useCallback, useReducer, forwardRef } = React;
  const out = Babel.transform(P.src + "\\nwindow.__C = " + P.exportName + ";", { presets: [["typescript", { isTSX: true, allExtensions: true }], "react"], filename: P.name }).code;
  new Function("React", "useState", "useEffect", "useRef", "useId", "useMemo", "useCallback", "useReducer", "forwardRef", out)(React, useState, useEffect, useRef, useId, useMemo, useCallback, useReducer, forwardRef);
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(window.__C, { onSubmit: () => {} }));
} catch (e) { document.body.textContent = "Não foi possível renderizar a prévia: " + e.message; }
</script></body></html>`;
}

export function mountPreview(app: Express) {
  app.get("/preview/:escrow/:idx", async (req, res) => {
    const idx = Number(req.params.idx);
    const [m] = await db
      .select()
      .from(schema.milestones)
      .where(and(eq(schema.milestones.escrowId, String(req.params.escrow)), eq(schema.milestones.idx, idx)));
    const token = typeof req.query.t === "string" ? req.query.t : "";
    if (!m?.previewUrl || !token || !m.previewUrl.endsWith(`t=${token}`) || !m.deliverablePath) {
      res.status(404).type("text").send("Prévia não encontrada");
      return;
    }
    const files = readDeliverable(m.deliverablePath);
    const entry = componentEntry(files);
    const report = (m.verifierReport ?? {}) as { numPassed?: number; numTests?: number; mode?: string };
    const sandbox = entry ? sandboxDoc(entry[0], entry[1]) : null;
    // O iframe srcdoc herda esta política: libera só React/Babel do unpkg. Ele roda com sandbox
    // sem allow-same-origin (origem opaca), então não enxerga cookies nem a API.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src https://unpkg.com 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:",
    );
    res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prévia da entrega</title>
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
<div class="band">PRÉVIA · SOLVERS</div>
<header><strong>Etapa ${idx + 1}: ${esc(m.title)}</strong><br><span class="ok">✔ ${report.numPassed ?? 0}/${report.numTests ?? 0} testes aprovados${report.mode === "simulated" ? " (verificação simulada)" : ""}</span></header>
<main>
${sandbox ? `<div class="frame"><iframe sandbox="allow-scripts" srcdoc="${esc(sandbox)}" title="Componente entregue"></iframe><div class="wm">PRÉVIA</div></div>` : "<p>Esta entrega não tem componente visual para pré-visualizar.</p>"}
<h3>Arquivos entregues</h3>
<ul>${Object.keys(files).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<p>O código completo fica disponível para download depois que você aprovar a etapa (ou quando o prazo de aprovação automática terminar).</p>
<h3>Critérios combinados</h3><p>${esc(m.criteria)}</p>
</main></body></html>`);
  });
}

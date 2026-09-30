import { z } from "zod";
import { badRequest } from "../lib/http.js";
import { runTests } from "../verifier/sandbox.js";
import type { SolverPackage } from "./packages.js";

// Ferramentas de servidor declaradas no manifesto (run_tool). O valor do solver fica aqui:
// a IA do usuário não tem acesso a estas execuções sem a licença.

type Runner = (input: unknown) => Promise<unknown>;

const FilesInput = z.object({ files: z.record(z.string()) });

/** Razão de contraste WCAG 2.x entre duas cores hex. */
export function contrastRatio(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (!/^[0-9a-f]{6}$/i.test(full)) throw badRequest(`Cor inválida: ${hex}`);
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return Math.round(((a! + 0.05) / (b! + 0.05)) * 100) / 100;
}

/** Checagens estáticas de acessibilidade em JSX/HTML (rápidas, sem navegador). */
export function a11yCheck(files: Record<string, string>) {
  const issues: { file: string; rule: string; message: string; snippet: string }[] = [];
  const push = (file: string, rule: string, message: string, snippet: string) =>
    issues.push({ file, rule, message, snippet: snippet.slice(0, 120) });
  for (const [file, src] of Object.entries(files)) {
    for (const m of src.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) push(file, "img-alt", "Imagem sem atributo alt", m[0]);
    for (const m of src.matchAll(/<button\b[^>]*>\s*<\/button>/g)) {
      if (!/aria-label(ledby)?=/.test(m[0])) push(file, "button-name", "Botão sem texto acessível", m[0]);
    }
    for (const m of src.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0];
      if (/type=["'](hidden|submit|button)["']/.test(tag)) continue;
      const id = /\bid=["{]?["']?([\w-]+)/.exec(tag)?.[1];
      const labelled = /aria-label(ledby)?=/.test(tag) || (id && new RegExp(`htmlFor=["{]?["']?${id}`).test(src));
      if (!labelled) push(file, "label", "Campo sem rótulo associado (label htmlFor ou aria-label)", tag);
    }
    for (const m of src.matchAll(/<div\b[^>]*onClick=[^>]*>/g)) {
      if (!/role=/.test(m[0]) || !/tabIndex=/.test(m[0])) push(file, "interactive-div", "div clicável sem role e tabIndex; prefira <button>", m[0]);
    }
    for (const m of src.matchAll(/tabIndex=\{?["']?([1-9]\d*)/g)) push(file, "tabindex", "tabIndex positivo quebra a ordem de foco", m[0]);
    for (const m of src.matchAll(/outline:\s*["']?none/g)) push(file, "focus-visible", "Remoção de outline sem alternativa de foco visível", m[0]);
  }
  return { passed: issues.length === 0, issues, checked: Object.keys(files).length };
}

const RUNNERS: Record<string, Runner> = {
  "docker:solvers-react-test": async (input) => (await runTests(FilesInput.parse(input).files)).report,
  "node:a11y": async (input) => a11yCheck(FilesInput.parse(input).files),
  "node:contrast": async (input) => {
    const { pairs } = z
      .object({ pairs: z.array(z.object({ fg: z.string(), bg: z.string(), large: z.boolean().optional() })).min(1).max(50) })
      .parse(input);
    return pairs.map((p) => {
      const ratio = contrastRatio(p.fg, p.bg);
      const min = p.large ? 3 : 4.5;
      return { ...p, ratio, aa: ratio >= min, aaa: ratio >= (p.large ? 4.5 : 7) };
    });
  },
  "node:budget": async (input) => {
    const { total, days, travelers, style } = z
      .object({
        total: z.number().positive(),
        days: z.number().int().positive(),
        travelers: z.number().int().positive().default(1),
        style: z.enum(["economico", "moderado", "conforto"]).default("moderado"),
      })
      .parse(input);
    const splits = {
      economico: { transporte: 0.35, hospedagem: 0.25, alimentacao: 0.2, passeios: 0.1, reserva: 0.1 },
      moderado: { transporte: 0.3, hospedagem: 0.3, alimentacao: 0.18, passeios: 0.12, reserva: 0.1 },
      conforto: { transporte: 0.28, hospedagem: 0.35, alimentacao: 0.17, passeios: 0.12, reserva: 0.08 },
    }[style];
    const round = (n: number) => Math.round(n * 100) / 100;
    const categories = Object.fromEntries(Object.entries(splits).map(([k, v]) => [k, round(total * v)]));
    const perDayLocal = round((total * (splits.alimentacao + splits.passeios)) / days / travelers);
    return { total, days, travelers, style, categories, perPersonPerDayLocal: perDayLocal };
  },
};

export async function runServerTool(pkg: SolverPackage, toolName: string, input: unknown) {
  const tool = pkg.manifest.tools.find((t) => t.name === toolName);
  if (!tool) {
    const names = pkg.manifest.tools.map((t) => t.name).join(", ") || "nenhuma";
    throw badRequest(`Ferramenta "${toolName}" não existe neste solver. Disponíveis: ${names}`);
  }
  const runner = RUNNERS[tool.runner];
  if (!runner) throw badRequest(`Executor ${tool.runner} indisponível neste servidor`);
  try {
    return await runner(input);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw badRequest(`Entrada inválida para ${toolName}: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    throw e;
  }
}

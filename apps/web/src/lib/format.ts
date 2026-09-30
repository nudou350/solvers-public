// Formatação e helpers de apresentação, portados de design/solver-lib.js.
// A cotação vem de getConfig().brlPerUsd: passe `rate` (ou use o hook useRate() da sessão).
import type { IconName } from "@/components/ui/icons";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fixed(n: number, d: number): string {
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Reais a partir de USDC: "R$ 129,90". */
export const brl = (usdc: number, rate: number) => `R$ ${fixed(usdc * rate, 2)}`;
/** Reais arredondados, sem centavos: "R$ 130" (cartões). */
export const brl0 = (usdc: number, rate: number) => `R$ ${fixed(Math.round(usdc * rate), 0)}`;
/** Valor já em reais (ex: AgentDetail.priceBrl). */
export const brlValue = (reais: number, digits = 2) => `R$ ${fixed(reais, digits)}`;
/** "25 USDC" / "12,50 USDC". */
export const usdc = (n: number) => `${fixed(n, n % 1 ? 2 : 0)} USDC`;
export const int = (n: number) => Number(n).toLocaleString("pt-BR");
export const dec1 = (n: number) => fixed(n, 1);
/** Variação com sinal: "+3,2%", "−1,0%". */
export const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 1)}%`;

export function initials(name: string): string {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Carteira encurtada: "AbCd…WxYz". */
export const short = (w?: string | null) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "");

// Datas sempre no fuso de Brasília: o servidor (SSR) e o navegador formatam igual, sem erro de hidratação.
const DATE_PARTS = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "numeric", year: "numeric" });

/** "30 set 2026" (fuso de Brasília). */
export function date(iso: string): string {
  const p: Record<string, string> = {};
  for (const x of DATE_PARTS.formatToParts(new Date(iso))) p[x.type] = x.value;
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1] ?? ""} ${p.year}`;
}

/**
 * "há 3 dias", "ontem", "há 2 h", "agora há pouco". Depende do relógio: num componente renderizado no servidor,
 * use <Ago iso /> (components/ui/Ago), que tolera a diferença de alguns segundos na hidratação.
 */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const d = Math.floor(s / 86400);
  if (d >= 60) return `há ${Math.floor(d / 30)} meses`;
  if (d >= 2) return `há ${d} dias`;
  if (d === 1) return "ontem";
  const h = Math.floor(s / 3600);
  if (h >= 1) return `há ${h} h`;
  return "agora há pouco";
}

export type Countdown = { text: string; clock: string; h: number; m: number; s: number; urgent: boolean; done: boolean };

/** Contagem regressiva até `iso` (ex: autoReleaseAt). */
export function countdown(iso: string, now = Date.now()): Countdown {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { text: "Liberação automática em andamento", clock: "00:00:00", h: 0, m: 0, s: 0, urgent: true, done: true };
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return { text: `${h} h ${pad(m)} min`, clock: `${pad(h)}:${pad(m)}:${pad(s)}`, h, m, s, urgent: h < 24, done: false };
}

/** Nota 0..5 → porcentagem para a barra de estrelas. */
export const starPct = (r: number) => Math.round((r / 5) * 100);

export type RepTone = "ok" | "brand" | "soft" | "warn";
export type RepLevel = { key: "ref" | "trust" | "grow" | "new" | "low"; label: string; tone: RepTone };

/** Nível de reputação (0..100) com o texto e o tom do design. */
export function repLevel(score: number): RepLevel {
  if (score >= 95) return { key: "ref", label: "Referência", tone: "ok" };
  if (score >= 90) return { key: "trust", label: "Confiável", tone: "ok" };
  if (score >= 80) return { key: "grow", label: "Em crescimento", tone: "brand" };
  if (score >= 60) return { key: "new", label: "Começando", tone: "soft" };
  return { key: "low", label: "Em observação", tone: "warn" };
}

/** Classe do selo .rep (o tom "ok" é o padrão, sem classe extra). */
export const repCls = (score: number) => {
  const t = repLevel(score).tone;
  return t === "ok" ? "rep" : `rep ${t}`;
};

/** Faixas de reputação, iguais às de repLevel (tabela "Níveis de reputação"). */
export const REP_LEVELS: { key: RepLevel["key"]; name: string; range: string; cls: string }[] = [
  { key: "low", name: "Em observação", range: "abaixo de 60", cls: "warn" },
  { key: "new", name: "Começando", range: "60 a 79", cls: "soft" },
  { key: "grow", name: "Em crescimento", range: "80 a 89", cls: "brand" },
  { key: "trust", name: "Confiável", range: "90 a 94", cls: "" },
  { key: "ref", name: "Referência", range: "95 a 100", cls: "" },
];

/** Nível de garantia do comprador (getMyGuarantee().level). */
export const GUARANTEE_LEVEL_LABEL: Record<"none" | "limited" | "full", string> = { full: "Completo", limited: "Limitado", none: "Sem garantia" };

/** Duração legível: "2 minutos", "48 horas", "3 dias" (dias só a partir de 2, quando exatos). */
export function durationText(secs: number): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (secs >= 172800 && secs % 86400 === 0) return plural(secs / 86400, "dia", "dias");
  if (secs >= 3600) return plural(Math.round(secs / 3600), "hora", "horas");
  return plural(Math.max(1, Math.round(secs / 60)), "minuto", "minutos");
}

/** Converte o texto de um campo numérico ("12,5") em número (NaN se vazio/inválido). */
export function parseNum(v: string): number {
  const t = v.trim().replace(",", ".");
  return t === "" ? Number.NaN : Number(t);
}

/** Tendência de 7 dias → classe do design (.trend.up/.down/.flat). */
export const trendCls = (t: number) => (t > 0.5 ? "up" : t < -0.5 ? "down" : "flat");

// Categorias: a API só traz o nome. Cor (hue) e ícone ficam aqui, com fallback estável para as novas.
const CATEGORY_STYLE: Record<string, { hue: number; icon: IconName; label?: string }> = {
  Desenvolvimento: { hue: 250, icon: "code" },
  "Front-end": { hue: 250, icon: "code" },
  "Back-end": { hue: 215, icon: "server" },
  Design: { hue: 300, icon: "pen" },
  Jurídico: { hue: 60, icon: "scale", label: "Contratos simples" },
  Viagens: { hue: 195, icon: "plane" },
  "Dia a dia": { hue: 25, icon: "list-check" },
  Finanças: { hue: 150, icon: "coin" },
  Escrita: { hue: 345, icon: "mail" },
  Carreira: { hue: 95, icon: "briefcase" },
  Estudos: { hue: 275, icon: "grad" },
  Dados: { hue: 175, icon: "database" },
  Negócios: { hue: 120, icon: "chart" },
};

function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Matiz (0..360) da categoria, para o .tile (style={{"--h": hue}}). */
export const hue = (category: string) => CATEGORY_STYLE[category]?.hue ?? hashHue(category);
/** Ícone da categoria (fallback: "spark"). */
export const categoryIcon = (category: string): IconName => CATEGORY_STYLE[category]?.icon ?? "spark";
/** Nome de exibição da categoria. */
export const categoryLabel = (category: string) => CATEGORY_STYLE[category]?.label ?? category;

/** Caminho SVG de uma linha (sparkline) dentro de w x h. */
export function spark(series: number[], w: number, h: number): string {
  if (series.length < 2) return `M0 ${h / 2} L${w} ${h / 2}`;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pad = 3;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Salva um texto como arquivo (Blob) no navegador. */
export function saveTextFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split("/").pop() || "arquivo.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Formatação e helpers de apresentação, portados de design/solver-lib.js.
// A cotação vem de getConfig().brlPerUsd: passe `rate` (ou use o hook useRate() da sessão).
//
// i18n: use useFormat() (componente cliente ou de servidor síncrono) ou await getFormat() de lib/format-server (componente
// de servidor async). Devolvem os mesmos formatadores no idioma da página, com os textos em messages/<locale>/format.json.
import { useLocale, useTranslations } from "next-intl";
import type { IconName } from "@/components/ui/icons";
import { INTL_LOCALE, type Locale } from "@/i18n/routing";

export function initials(name: string): string {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Carteira encurtada: "AbCd…WxYz". */
export const short = (w?: string | null) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "");

export type Countdown = { text: string; clock: string; h: number; m: number; s: number; urgent: boolean; done: boolean };

/** Nota 0..5 → porcentagem para a barra de estrelas. */
export const starPct = (r: number) => Math.round((r / 5) * 100);

export type RepTone = "ok" | "brand" | "soft" | "warn";
export type RepLevel = { key: "ref" | "trust" | "grow" | "new" | "low"; label: string; tone: RepTone };

/** Classe do selo .rep (o tom "ok" é o padrão, sem classe extra). */
export const repCls = (score: number) => {
  const t = LEVEL_TONE[levelKey(score)];
  return t === "ok" ? "rep" : `rep ${t}`;
};

/** Faixas de reputação, da pior para a melhor (a tabela "Níveis de reputação"); textos em format.json. */
const REP_LEVELS: { key: RepLevel["key"]; cls: string }[] = [
  { key: "low", cls: "warn" },
  { key: "new", cls: "soft" },
  { key: "grow", cls: "brand" },
  { key: "trust", cls: "" },
  { key: "ref", cls: "" },
];

/** Converte o texto de um campo numérico ("12,5") em número (NaN se vazio/inválido). */
export function parseNum(v: string): number {
  const t = v.trim().replace(",", ".");
  return t === "" ? Number.NaN : Number(t);
}

/** Tendência de 7 dias → classe do design (.trend.up/.down/.flat). */
export const trendCls = (t: number) => (t > 0.5 ? "up" : t < -0.5 ? "down" : "flat");

// Categorias: a API só traz o nome. Cor (hue) e ícone ficam aqui, com fallback estável para as novas.
const CATEGORY_STYLE: Record<string, { hue: number; icon: IconName }> = {
  Desenvolvimento: { hue: 250, icon: "code" },
  "Front-end": { hue: 250, icon: "code" },
  "Back-end": { hue: 215, icon: "server" },
  Design: { hue: 300, icon: "pen" },
  Jurídico: { hue: 60, icon: "scale" },
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

// ---------------------------------------------------------------------------------------------------------------
// Formatadores por idioma.

export type T = ((key: string, values?: Record<string, string | number>) => string) & { has?: (key: string) => boolean };

// Fuso fixo por idioma: o servidor (SSR) e o navegador formatam igual, sem erro de hidratação.
const TIME_ZONE: Record<Locale, string> = { en: "UTC", pt: "America/Sao_Paulo" };

const LEVEL_TONE: Record<RepLevel["key"], RepTone> = { ref: "ok", trust: "ok", grow: "brand", new: "soft", low: "warn" };
const levelKey = (score: number): RepLevel["key"] =>
  score >= 95 ? "ref" : score >= 90 ? "trust" : score >= 80 ? "grow" : score >= 60 ? "new" : "low";
/** "Jurídico" -> "juridico", "Dia a dia" -> "dia_a_dia" (chave em format.json -> categories). */
const categoryKey = (c: string) =>
  c.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();

export function makeFormat(locale: Locale, t: T) {
  const intl = INTL_LOCALE[locale];
  const num = (n: number, min: number, max = min) =>
    Number(n).toLocaleString(intl, { minimumFractionDigits: min, maximumFractionDigits: max });
  const datePart = new Intl.DateTimeFormat(intl, { timeZone: TIME_ZONE[locale], day: "numeric", month: "short", year: "numeric" });
  const dateTimePart = new Intl.DateTimeFormat(intl, { timeZone: TIME_ZONE[locale], dateStyle: "short", timeStyle: "short" });
  const timePart = new Intl.DateTimeFormat(intl, { timeZone: TIME_ZONE[locale], hour: "2-digit", minute: "2-digit" });

  return {
    locale,
    /** Número com casas fixas no idioma (1,234.50 / 1.234,50). */
    num,
    /** Preço "local" a partir de USDC. pt: reais pela cotação ("R$ 129,90"); en: dólar 1:1 com o USDC ("$24.99"). */
    brl: (usdcAmount: number, rate: number) => (locale === "pt" ? `R$ ${num(usdcAmount * rate, 2)}` : `$${num(usdcAmount, 2)}`),
    /** Igual a brl, arredondado sem centavos (cartões). */
    brl0: (usdcAmount: number, rate: number) =>
      locale === "pt" ? `R$ ${num(Math.round(usdcAmount * rate), 0)}` : `$${num(Math.round(usdcAmount), 0)}`,
    /** Valor já em reais (ex: AgentDetail.priceBrl). Só faz sentido em pt; no en prefira usdc(). */
    brlValue: (reais: number, digits = 2) => `R$ ${num(reais, digits)}`,
    /** "25 USDC" / "12.50 USDC". */
    usdc: (n: number) => `${num(n, n % 1 ? 2 : 0)} USDC`,
    /** Valor cripto, arredondado para CIMA na casa mostrada (a tela nunca promete pagar menos que a cotação). */
    cryptoAmount: (n: number, symbol: string) => {
      const d = symbol === "USDC" ? 2 : n >= 1 ? 4 : n >= 0.01 ? 5 : 6;
      return `${num(Math.ceil(n * 10 ** d - 1e-9) / 10 ** d, d)} ${symbol}`;
    },
    /** Pontos-base em porcentagem: 500 -> "5%", 750 -> "7.5%". */
    bpsPct: (bps: number) => `${num(bps / 100, 0, 2)}%`,
    int: (n: number) => Number(n).toLocaleString(intl),
    dec1: (n: number) => num(n, 1),
    /** Variação com sinal: "+3.2%", "−1.0%". */
    pct: (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n), 1)}%`,
    /** "Sep 30, 2026" / "30 de set. de 2026". */
    date: (iso: string) => datePart.format(new Date(iso)),
    /** Data e hora curtas (tooltips, históricos). */
    dateTime: (iso: string | number | Date) => dateTimePart.format(new Date(iso)),
    /** "14:05" / "02:05 PM". */
    time: (iso: string | number | Date) => timePart.format(new Date(iso)),
    /** "3 days ago", "yesterday"... Depende do relógio: em componente de servidor, use <Ago iso />. */
    ago: (iso: string, now = Date.now()) => {
      const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
      const d = Math.floor(s / 86400);
      if (d >= 60) return t("ago.months", { n: Math.floor(d / 30) });
      if (d >= 2) return t("ago.days", { n: d });
      if (d === 1) return t("ago.yesterday");
      const h = Math.floor(s / 3600);
      if (h >= 1) return t("ago.hours", { n: h });
      return t("ago.justNow");
    },
    /** Contagem regressiva até `iso` (ex: autoReleaseAt). */
    countdown: (iso: string, now = Date.now()): Countdown => {
      const ms = new Date(iso).getTime() - now;
      if (ms <= 0) return { text: t("countdown.releasing"), clock: "00:00:00", h: 0, m: 0, s: 0, urgent: true, done: true };
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const sec = Math.floor((ms % 60000) / 1000);
      const pad = (x: number) => (x < 10 ? `0${x}` : `${x}`);
      return { text: t("countdown.text", { h, m: pad(m) }), clock: `${pad(h)}:${pad(m)}:${pad(sec)}`, h, m, s: sec, urgent: h < 24, done: false };
    },
    /** Nível de reputação (0..100) com o texto e o tom do design. */
    repLevel: (score: number): RepLevel => {
      const key = levelKey(score);
      return { key, label: t(`rep.${key}`), tone: LEVEL_TONE[key] };
    },
    /** Faixas de reputação (tabela "Níveis de reputação"). */
    repLevels: () => REP_LEVELS.map((l) => ({ ...l, name: t(`rep.${l.key}`), range: t(`repRange.${l.key}`) })),
    /** Nível de garantia do comprador (getMyGuarantee().level). */
    guaranteeLevel: (level: "none" | "limited" | "full") => t(`guaranteeLevel.${level}`),
    /** Duração legível: "2 minutes", "48 hours", "3 days" (dias só a partir de 2, quando exatos). */
    durationText: (secs: number) => {
      if (secs >= 172800 && secs % 86400 === 0) return t("duration.days", { n: secs / 86400 });
      if (secs >= 3600) return t("duration.hours", { n: Math.round(secs / 3600) });
      return t("duration.minutes", { n: Math.max(1, Math.round(secs / 60)) });
    },
    /** Tamanho de arquivo: "1.5 MB", "300 KB". */
    fileSize: (bytes: number) =>
      bytes >= 1024 * 1024 ? `${num(bytes / (1024 * 1024), 0, 1)} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(intl)} KB`,
    /**
     * Nome de exibição da categoria. A API traz o nome em português ("Desenvolvimento"); a tradução fica em
     * format.json -> categories.<chave sem acento>; sem tradução, mostra o nome como veio.
     */
    categoryLabel: (category: string) => {
      const key = `categories.${categoryKey(category)}`;
      return t.has?.(key) ? t(key) : category;
    },
    /** Nome do conector sem o "(opcional)"/"(optional)" que alguns manifests trazem no rótulo. */
    connectorName: (label: string) => label.replace(/\s*\((opcional|optional)\)\s*$/i, "").trim() || label,
  };
}

export type Format = ReturnType<typeof makeFormat>;

/** Formatadores no idioma da página (componente cliente ou componente de servidor síncrono). */
export function useFormat(): Format {
  const locale = useLocale() as Locale;
  const t = useTranslations("format");
  return makeFormat(locale, t as unknown as T);
}

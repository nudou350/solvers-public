import { z } from "zod";
import type { Requirement } from "./schemas.js";

// Textos de catálogo por idioma (PACKAGE_SPEC.md, "Localization"). O pacote é em inglês (manifest.json) e pode trazer
// `locales/pt.json` com os textos da vitrine em português. Só texto de catálogo: etapas, conhecimento e ferramentas
// continuam em um idioma só. Sem env/banco: a mesma regra serve ao servidor e ao front.

/** Idiomas servidos pelo catálogo. O padrão (en) vem do manifest; os demais são sobreposições. */
export const CATALOG_LANGS = ["en", "pt"] as const;
export type CatalogLang = (typeof CATALOG_LANGS)[number];
export const DEFAULT_CATALOG_LANG: CatalogLang = "en";

/** Idiomas que um pacote pode traduzir com `locales/<lang>.json` (por ora só pt). */
export const PACKAGE_LOCALE_LANGS = ["pt"] as const;
export type PackageLocaleLang = (typeof PACKAGE_LOCALE_LANGS)[number];

/** Caminho de cada arquivo de tradução dentro do pacote. */
export const localeFilePath = (lang: PackageLocaleLang): string => `locales/${lang}.json`;

/** Requisito traduzido: casa com o do manifest pela `key` (só o texto muda; tipo, opcional e howTo vêm do manifest). */
export const LocaleRequirement = z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(200) }).strict();

/** Conteúdo de `locales/<lang>.json`. Estrito: campo desconhecido é erro (evita tradução que nunca aparece). */
export const PackageLocale = z
  .object({
    name: z.string().trim().min(1).max(80),
    tagline: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(3000),
    packageContents: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
    requirements: z.array(LocaleRequirement).max(10).default([]),
    /** Pedidos típicos no idioma: viram vetores extras da busca (quem busca em português acha o Solver). */
    searchPhrases: z.array(z.string().min(3).max(120)).max(20).optional(),
    /** Bio do criador no idioma (a vitrine mostra no perfil dele). */
    creatorBio: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type PackageLocale = z.infer<typeof PackageLocale>;

/** Traduções guardadas na linha do agente (`agents.translations`). Ausente = só o inglês do manifest. */
export const AgentTranslations = z.object({ pt: PackageLocale.optional() }).strict();
export type AgentTranslations = z.infer<typeof AgentTranslations>;

/** Interpreta o texto de um idioma ("pt", "pt-BR", "pt_br", "EN-us"): devolve o idioma servido ou undefined. */
export function parseCatalogLang(value: unknown): CatalogLang | undefined {
  if (typeof value !== "string") return undefined;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return (CATALOG_LANGS as readonly string[]).includes(primary) ? (primary as CatalogLang) : undefined;
}

/** Cabeçalho Accept-Language: o primeiro idioma servido na ordem de preferência (q), senão o padrão. */
export function langFromAcceptLanguage(header: string | undefined | null): CatalogLang {
  if (!header) return DEFAULT_CATALOG_LANG;
  const items = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((i) => i.tag !== "" && i.tag !== "*" && i.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const i of items) {
    const lang = parseCatalogLang(i.tag);
    if (lang) return lang;
  }
  return DEFAULT_CATALOG_LANG;
}

/** `?lang=` vence; valor ausente ou desconhecido cai no Accept-Language; sem nenhum dos dois, inglês. */
export function resolveCatalogLang(queryLang: unknown, acceptLanguage?: string | null): CatalogLang {
  return parseCatalogLang(queryLang) ?? langFromAcceptLanguage(acceptLanguage);
}

/** Campos de catálogo que a tradução sobrepõe. */
export type CatalogTexts = {
  name: string;
  tagline: string;
  description: string;
  packageContents: string[];
  requirements: Requirement[];
};

/**
 * Sobrepõe a tradução ao texto do manifest (inglês). Regras: inglês, ou sem tradução do idioma, devolve o próprio `base`;
 * nome, tagline e descrição trocam quando a tradução tem texto; `packageContents` troca a lista inteira; cada requisito
 * troca só o `label` e só quando a `key` existe na tradução (os demais ficam em inglês); o resto do objeto não muda.
 */
export function overlayCatalogTexts<T extends CatalogTexts>(base: T, translations: AgentTranslations | null | undefined, lang: CatalogLang): T {
  if (lang !== "pt") return base;
  const t = translations?.pt;
  if (!t) return base;
  const labels = new Map((t.requirements ?? []).map((r) => [r.key, r.label]));
  return {
    ...base,
    name: t.name || base.name,
    tagline: t.tagline || base.tagline,
    description: t.description || base.description,
    packageContents: t.packageContents.length > 0 ? [...t.packageContents] : base.packageContents,
    requirements: base.requirements.map((r) => {
      const label = r.key ? labels.get(r.key) : undefined;
      return label ? { ...r, label } : r;
    }),
  };
}

/** Bio do criador no idioma pedido (a primeira tradução que tiver `creatorBio`); sem ela, a bio original. */
export function creatorBioFor(bio: string, translationsOfCreatorAgents: (AgentTranslations | null | undefined)[], lang: CatalogLang): string {
  if (lang !== "pt") return bio;
  for (const t of translationsOfCreatorAgents) if (t?.pt?.creatorBio) return t.pt.creatorBio;
  return bio;
}

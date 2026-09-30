// Guias curtos de instalação de requisitos, devolvidos pelo preflight_check.
// Os menus das IAs mudam com frequência: os textos evitam caminhos exatos e sempre apontam a ajuda oficial.

/** Chave comum para comparar rótulos, chaves e nomes de ferramenta: minúsculas, sem acento, não-alfanumérico vira "_". */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Conectores do catálogo do wizard: nome para exibir e outros nomes que as IAs usam nas ferramentas. */
const CATALOG: Record<string, { name: string; aliases?: string[] }> = {
  figma: { name: "Figma" },
  github: { name: "GitHub" },
  google_drive: { name: "Google Drive" },
  google_agenda: { name: "Google Agenda", aliases: ["google_calendar"] },
  google_planilhas: { name: "Google Planilhas", aliases: ["google_sheets"] },
  gmail: { name: "Gmail" },
  notion: { name: "Notion" },
  slack: { name: "Slack" },
};

/** Nomes alternativos que também contam como "conectado" (além da própria chave). */
export function keyAliases(key: string): string[] {
  return CATALOG[normalizeKey(key)]?.aliases ?? [];
}

function catalogGuide(name: string): { claude: string; chatgpt: string; help: string } {
  return {
    claude: `• Claude: abra Configurações > Conectores, procure por ${name} e autorize com a sua conta.`,
    chatgpt: `• ChatGPT: abra Configurações > Apps e conectores (ou Conectores), escolha ${name} e autorize.`,
    help: `• Depois, volte a esta conversa e confirme que o ${name} aparece nas ferramentas.\nSe o menu estiver diferente, consulte a central de ajuda da sua IA sobre conectores.`,
  };
}

export const INSTALL_GUIDES: Record<string, string> = Object.fromEntries(
  Object.entries(CATALOG).map(([key, { name }]) => {
    const g = catalogGuide(name);
    return [key, [`Como conectar o ${name}:`, g.claude, g.chatgpt, g.help].join("\n")];
  }),
);

type GuideRequirement = { label: string; key?: string; howTo?: string; helpUrl?: string };

/** Como o comprador conecta: instrução do criador, depois o guia do catálogo, depois o texto genérico. */
export function installGuide(req: GuideRequirement): string {
  const help = req.helpUrl ? `\nAjuda oficial: ${req.helpUrl}` : "";
  const howTo = req.howTo?.trim();
  if (howTo) return `${howTo}${help}`;
  const guide = INSTALL_GUIDES[normalizeKey(req.key ?? req.label)];
  if (guide) return `${guide}${help}`;
  return `Peça ao usuário para adicionar o conector ${req.label} nas configurações da IA.${help}`;
}

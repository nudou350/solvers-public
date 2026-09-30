// Guias curtos de instalação de requisitos, devolvidos pelo preflight_check.
// Os menus mudam com frequência: os textos evitam caminhos exatos e sempre apontam a ajuda oficial.

export const INSTALL_GUIDES: Record<string, string> = {
  figma: [
    "Como conectar o Figma:",
    "• Claude: abra Configurações > Conectores, procure por Figma e clique em Conectar; faça login na sua conta Figma e autorize.",
    "• ChatGPT: abra Configurações > Apps e conectores (ou Conectores), escolha Figma e autorize.",
    "• Depois, volte a esta conversa e confirme que o Figma aparece nas ferramentas.",
    "Se o menu estiver diferente, consulte a central de ajuda do seu assistente sobre conectores.",
  ].join("\n"),
  github: [
    "Como conectar o GitHub:",
    "• Claude ou ChatGPT: em Configurações > Conectores, escolha GitHub e autorize os repositórios necessários.",
  ].join("\n"),
};

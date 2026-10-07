# Plano de migração: inglês por padrão, português como segunda língua

Status: proposta (06/10/2026). Prazo da fase 1: hackathon Crypto World's Fair, 12/10 (inglês obrigatório).

## 0. Decisões

| # | Decisão | Escolha |
|---|---|---|
| D1 | Idiomas | `en` (padrão) e `pt` (pt-BR). Nada de `en-US`/`pt-BR` na URL. |
| D2 | URL | Inglês sem prefixo (`/solvers`), português com prefixo (`/pt/solvers`). |
| D3 | Nomes das rotas | Em inglês nos dois idiomas (`/pt/solvers`, não `/pt/especialistas`). Rotas antigas em PT fazem 301 para as novas. |
| D4 | Escolha do idioma | 1ª visita: `Accept-Language` (pt → `/pt`, resto → inglês). Depois: cookie `NEXT_LOCALE`, trocado pelo seletor no header. |
| D5 | Biblioteca no site | `next-intl` (App Router, segmento `[locale]`, `proxy.ts` do Next 16). Conferir peer deps com `next@16.3` na instalação; se não fechar, dicionário próprio no padrão do guia `node_modules/next/dist/docs/01-app/02-guides/internationalization.md`. |
| D6 | Servidor e MCP | Textos em inglês. O MCP manda o modelo responder no idioma do usuário; a API devolve `code` e o site traduz. |
| D7 | Pacotes de Solver | Conteúdo principal em inglês, com textos de vitrine e templates em PT como tradução. **Ver risco R1 (nota on-chain).** |
| D8 | Interno | Telegram do admin, CLIs, logs, comentários de código e docs operacionais (`docs/`) continuam em PT. |

## 1. Inventário (o que existe hoje)

- **Site** (`apps/web`): 20 páginas, ~100 `.tsx`, texto PT direto no JSX, `<html lang="pt-BR">`, sem `proxy.ts`. Rotas: `especialistas`, `biblioteca`, `biblioteca/memorias`, `checkout/concluido`, `conectar`, `criador` (+ `envios`, `publicar`, `saque-privado`), `criadores/[id]`, `garantias`, `instalar`, `perfil`, `revenda`, `admin/revisoes`, `dev/kit`.
- **MCP** (`apps/server/src/mcp`): `tools.ts`, `agent-text.ts`, `guides.ts`, `preflight.ts`, `routes.ts` (~1000 linhas), instruções do servidor em PT.
- **API**: as respostas de erro já têm `code` (ex.: `{ error: "Rota não encontrada", code: "not_found" }`); ~17 mensagens soltas em PT.
- **Pacotes**: 9 em `agents/` (8 v1 + `_exemplos`), ~30 a 70 arquivos cada, tudo em PT (manifest, steps, knowledge, templates, evals).
- **Banco**: `agents.tagline`, `description`, vetores de busca (`searchPhrases`, e5 multilíngue).
- **Docs públicos**: `README.md`, `PACKAGE_SPEC.md`, `docs/criador-solvers.md`, `docs/guia-conceitos.md`.

## 2. Riscos

- **R1. Traduzir pacote zera a nota on-chain.** `packageHash(dir)` lê todos os arquivos do pacote. Qualquer arquivo traduzido muda o hash, e `cli:publish` chama `update_version`, que zera a nota on-chain (regra do CLAUDE.md). Opções:
  - **(a) Aceitar o zeramento na devnet.** As notas atuais são "teste interno da equipe". Reavaliar com `npm run eval` depois.
  - **(b) Traduções fora do hash.** `locales/<lang>.json` e `templates/<lang>/` ficam fora do `packageHash`. A tradução vira só uma mudança de vitrine, sem `update_version`. Precisa mexer no loader, no validador e no PACKAGE_SPEC.
  - **Recomendado:** (a) agora para o conteúdo principal (os pacotes viram EN, tudo de uma vez) e (b) para as traduções PT dali em diante. Assim, corrigir o texto em PT nunca mais zera nota.
- **R2. Links antigos.** Links já divulgados (`/especialistas/<slug>`, `/instalar`) e URLs de retorno do Mercado Pago e do Privy. Mitigação: 301 em `next.config` e conferir as URLs de retorno no `.env`.
- **R3. Deploy.** Push na `master` faz deploy automático. Tudo vai numa branch `feat/i18n`, e o merge só sai depois de checar a regra do upgrade da devnet (`docs/devnet-upgrade.md`).
- **R4. Migrações.** Só acrescentam colunas. A versão no ar continua lendo `tagline`/`description`.
- **R5. Busca.** Os vetores são multilíngues: uma busca em PT acha um pacote EN. Mesmo assim, as frases em EN entram no índice (`cli:reindex`) para não perder relevância.

## 3. Fase 1: até 12/10 (~2,5 dias)

Ordem pensada para o que o jurado vê primeiro.

### 1.1 MCP em inglês (~1,5 h)
1. Traduzir descrições das 15 ferramentas, as instruções do servidor, `agent-text.ts`, `guides.ts` e `preflight.ts`.
2. Incluir nas instruções: "Always reply in the user's language."
3. `evalLabel`: "internal team test" (nunca "verified").
4. Rodar `scripts` `e2e-mcp` e os testes do servidor.

### 1.2 Esqueleto de i18n no site (~3 h)
1. Instalar `next-intl` e criar `src/i18n/` (routing, request, `messages/en.json`, `messages/pt.json`).
2. Mover `src/app/*` para `src/app/[locale]/*` e criar `proxy.ts` (negociação + cookie). `lang` dinâmico no `<html>`.
3. Renomear rotas (D3):

| Antiga | Nova |
|---|---|
| `/especialistas/[slug]` | `/solvers/[slug]` |
| `/biblioteca`, `/biblioteca/memorias` | `/library`, `/library/memories` |
| `/criador`, `/criador/envios[/id]`, `/criador/publicar`, `/criador/saque-privado` | `/creator`, `/creator/submissions[/id]`, `/creator/publish`, `/creator/private-withdraw` |
| `/criadores/[id]` | `/creators/[id]` |
| `/garantias` | `/guarantees` |
| `/revenda` | `/resale` |
| `/instalar` | `/install` |
| `/conectar` | `/connect` |
| `/perfil` | `/profile` |
| `/checkout/concluido` | `/checkout/done` |
| `/admin/revisoes[/id]` | `/admin/reviews[/id]` |

4. 301 de cada rota antiga (com e sem `/pt`) e atualização dos links internos, do `api-client` e das URLs de retorno (Pix, Privy, OAuth do MCP).
5. Seletor EN | PT no header.

### 1.3 Extrair textos do site (~6 h; dá para dividir entre 3 subagentes por pasta)
1. Por pasta de `components/` (`catalog`, `checkout`, `account`, `connect`, `layout`, `ui` primeiro; `creator`, `resale`, `admin` depois).
2. Chaves por tela (`catalog.card.buy`), PT copiado do texto atual e EN escrito do zero (não traduzido palavra por palavra).
3. Datas, moeda e números com `useFormatter` (sem `toLocaleString("pt-BR")` fixo).
4. Erros da API: `errors.<code>` no site e fallback para a mensagem do servidor.
5. Checagem: script que falha se uma chave existe em um idioma e não no outro (vai para `pnpm test`).

### 1.4 Vitrine e pacotes em EN (~5 h)
1. Migração aditiva: `agents.translations jsonb` (`{ pt: { name, tagline, description, packageContents } }`).
2. Traduzir os 8 pacotes v1 para EN: manifest, steps, knowledge, templates, evals (opção R1-a).
3. PT da vitrine em `locales/pt.json` fora do hash (R1-b) e templates PT em `templates/pt/`.
4. A API do catálogo aceita `?lang=` (ou `Accept-Language`) e devolve o texto do idioma, com fallback para EN.
5. `cli:publish` na devnet + `cli:reindex` + `npm run eval` para refazer as notas.

### 1.5 Servidor e docs públicos (~2 h)
1. As ~17 mensagens de erro soltas passam para EN (o `code` não muda).
2. `README.md` em EN; o atual vira `README.pt-BR.md`. `PACKAGE_SPEC.md` e `docs/criador-solvers.md` em EN, com cópia `.pt-BR.md`.
3. Checkout: no EN, USDC/SODAX primeiro e Pix depois; no PT, a ordem atual.

### 1.6 Verificação (~2 h)
1. `pnpm typecheck && pnpm test && pnpm build`.
2. Navegação manual EN e PT nas 20 páginas (Chrome), incluindo a compra de ponta a ponta com Pix simulado e o fluxo do criador.
3. Claude e ChatGPT: conector em inglês, conversa em PT responde em PT.
4. Revisor independente (subagente) para o diff inteiro antes do merge.

## 4. Fase 2: depois do hackathon

1. PACKAGE_SPEC v1.1: `language` no manifest, `locales/` e `templates/<lang>/` documentados; validador do worker aceita e confere chaves.
2. Fluxo do criador: o envio pode trazer o PT, o EN ou os dois; a revisão mostra o diff por idioma.
3. Memória do usuário: guardar o idioma preferido (o MCP já recebe a conversa no idioma do usuário).
4. `docs/teste-manual`: cenários EN.
5. SEO: `hreflang`, `sitemap` por idioma, `metadata` traduzida.

## 5. Critério de pronto (fase 1)

- Abrir `/` num navegador em inglês mostra o site todo em EN; em PT, redireciona para `/pt`.
- Nenhum texto PT aparece no EN (checagem de chaves + varredura manual).
- Links antigos em PT respondem com 301.
- O conector MCP lista ferramentas em EN e responde em PT para quem escreve em PT.
- Os 8 pacotes estão em EN na vitrine EN e em PT na vitrine PT, com notas reavaliadas.

# apps/web: especificação (Fase C)

Vitrine do Solvers em Next.js, fiel ao design do Claude Design e ligada à API real.

## Referências
- `design/screens/<tela>.html`: template completo de cada tela. Tem o `<style>` (sistema visual `.sv`, com tema claro e escuro), a marcação com bindings `{{...}}` e, no fim, o `<script type="text/x-dc">` com a lógica da tela.
  - Há versões `-celular` (390px) para o responsivo, e `home-escuro` para o tema escuro.
- `design/mock-data.js`: dados de exemplo (`window.SOLVER`).
- `design/solver-lib.js`: helpers (`brl`, `ago`, `countdown`, `repLevel`, `card`...). Reaproveite a lógica de formatação, não os dados.
- `FRONT_PLAN.md`: decisões de produto. `NEXT_STEPS.md` §9: a tabela tela × API.
- API: `packages/api-client` (`createApi`), com tipos em `packages/shared`. O servidor fica em `apps/server` (porta 3017).

## Stack
- Next.js 16 (App Router), React 19, TypeScript estrito, sem Tailwind: CSS puro portado do design.
  - Tokens e classes compartilhadas em `src/styles/`; o estilo específico de cada tela em CSS Modules ou num arquivo da rota.
- Fonte Figtree via `next/font/google`. Ícones: os `<symbol>` SVG do design, num componente `<Icon name>`.
- Pacote `@solvers/web`, em `apps/web`. `transpilePackages: ["@solvers/api-client", "@solvers/shared"]`.
- **Mesma origem:** o front chama `/api/...` com caminhos relativos. Em dev, `next.config` faz rewrites de `/api`, `/mcp`, `/oauth`, `/preview`, `/.well-known` e `/health` para `http://localhost:3017`. Em produção quem encaminha é o nginx. O cookie de sessão é httpOnly e do mesmo site.
- Portas: dev na **3000** (o `PUBLIC_WEB_URL` do servidor local), produção na **4017** (PM2 `solvers-web`).

## Rotas (o servidor já gera links para as marcadas com ★)
| Rota | Tela(s) do design |
|---|---|
| `/` | home |
| `/especialistas/[slug]` ★ | especialista |
| `/checkout?agent=<slug>&type=permanent\|credits\|guarantee` ★ | checkout-licenca, checkout-com-garantia |
| `/checkout/concluido?agent=<slug>&sig=<assinatura>` | compra-concluida |
| `/instalar?agent=<slug>` ★ | instalacao-guiada |
| `/biblioteca` e `/biblioteca/memorias` | minha-biblioteca, minhas-memorias |
| `/garantias` | garantias-em-andamento |
| `/revenda` | mercado-de-revenda: **"em breve"** com a proposta e a lista de interesse. Sem anúncios simulados. |
| `/criador` e `/criador/publicar` | painel-do-criador, publicar-especialista (formulário **mockado**, sem API: fase D) |
| `/perfil` | perfil-e-reputacao |
| `/criadores/[id]` | perfil-de-criador |

## Regras de produto que mudam o design
- Aluguel foi **removido** (botão "Alugar" e textos). Revenda é "em breve": nada de "Revender" na biblioteca, só um aviso discreto.
- Pix aparece como **"em breve"** no checkout até a fase B. O método ativo é "Saldo em USDC". Na devnet, mostrar o botão "Receber USDC de teste" (`faucet()`) quando `getConfig().faucetEnabled`.
- A garantia usa as etapas do criador: `getAgent().guarantee`, só leitura. O comprador escreve título e descrição. O limite vem de `getMyGuarantee()`.
- A contestação exige escolher um dos critérios **e** escrever o motivo (5 a 2000 caracteres). Não existe "Outro critério".
- Status das etapas: `pending` = aguardando; `submitted` = em verificação; `passed` = em análise (contagem regressiva até `autoReleaseAt`); `approved`; `disputed`; `refunded`. Etapas com `verify: "manual"` são de revisão pelo comprador.
- "Testar grátis" leva a `/instalar?agent=<slug>` (o teste acontece pelo conector). Mostre `trialUsesLeft` quando logado.
- A instalação usa um endereço único, `getConfig().connectorUrl`. "Testar conexão" usa `getConnector().authorizedClients`.
- Memórias: `getMemories()` pode responder 409 `memory_key_required`. Nesse caso, mostre o estado "Desbloquear memórias" → `unlockMemories(wallet)` e tente de novo.
- Reais: `getConfig().brlPerUsd`. O preço principal aparece em R$, e o USDC fica como informação secundária, como no design.
- Níveis de reputação e textos: helpers `repLevel` do design. Os limites de garantia vêm da config e da API, nunca de números fixos.

## Login e carteira (base)
- `src/lib/wallet/`: interface `WalletLike` do api-client (`address`, `signMessage`, `signTransaction`).
  - **Privy** quando `NEXT_PUBLIC_PRIVY_APP_ID` existe: login por e-mail e carteira Solana embutida.
  - Sem o App ID, **carteira de desenvolvimento**: par ed25519 gerado no navegador e guardado em `localStorage`. Assina a mensagem SIWS e a transação que o servidor montou, a qual já vem assinada pelo fee payer (só acrescenta a assinatura do usuário). Só para localnet e devnet.
- `SessionProvider` (contexto): `wallet`, `me`, `login()`, `logout()`, e `api` (instância de `createApi()`).
  - Depois do login com Privy, chama `updateProfile({ email })`.
- Helper de transação `runTx(built)`: assina e envia com `signAndSubmit`. Trata `ApiError` com mensagens em português (`insufficient_funds` oferece o faucet; `guarantee_limit`; `rate_limited`).

## Convenções
- Componentes de servidor para os dados públicos (catálogo) quando fizer sentido. Telas logadas são componentes de cliente com `useSession()`.
- Estados de carregamento, vazio e erro em toda tela (o design tem vários estados vazios; use os textos dele).
- Acessibilidade: rótulos, foco visível, `aria-live` nos avisos, contraste do design.
- Sem dados fixos do mock nas telas finais. O `mock-data.js` é só referência.
- Os textos em português vêm do design. Ajuste só onde a regra de produto mudou.

## Divisão do trabalho (evita conflito de arquivos)
- **Base (agente 1)** cria e é dono de: `apps/web/*` (config, package.json), `src/app/layout.tsx`, `src/styles/*`, `src/components/ui/*` (Icon, Button, Card, Stars, Price, Tabs, Empty, Spinner, Toast), `src/components/layout/*` (Header, Footer, ThemeToggle), `src/lib/*` (api, session, wallet, format, tx).
  - Deixa um `src/app/page.tsx` provisório e um `/dev/kit` mostrando os componentes.
- **Telas (agentes 2 a 5)** só criam arquivos dentro das pastas das rotas e em `src/components/<area>/`, onde área é `catalog`, `checkout`, `account` ou `creator`.
  - Se precisarem de algo novo em `ui/` ou `lib/`, criam na própria área e registram no resumo final, para a revisão promover.

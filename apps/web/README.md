# @solvers/web

Vitrine do Solvers em Next.js 16 (App Router, React 19, CSS puro do design). Fala com a API de `apps/server` pela mesma origem (`/api/...`).

## Como rodar

```bash
# 1. API na 3017 (outro terminal): apps/server, `pnpm dev`
# 2. Vitrine em dev na 3000 (o next.config encaminha /api, /mcp, /oauth, /preview, /.well-known e /health para a 3017)
pnpm --filter @solvers/web dev

# Produção (porta 4017, PM2 solvers-web). Em produção quem encaminha /api para a 3017 é o nginx.
pnpm --filter @solvers/web build
PORT=4017 API_INTERNAL_URL=http://127.0.0.1:3017 node apps/web/start.mjs
```

Tipos: `pnpm --filter @solvers/web typecheck`.

## Variáveis

As `NEXT_PUBLIC_*` entram no bundle na hora do build: mudou, rode o build de novo.

| Variável | Onde | Para que serve |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | build | Login por e-mail com carteira Solana embutida (Privy). Sem ela, a vitrine usa a carteira de desenvolvimento. Local: `apps/web/.env.local` (não versionado). |
| `NEXT_PUBLIC_ALLOW_DEV_WALLET` | build | `1` libera a carteira de desenvolvimento num build de produção sem Privy (ex: demo na devnet até o App ID existir). No `next dev` ela sempre vale. Nunca vale na mainnet. |
| `NEXT_PUBLIC_SHOW_DEV_KIT` | build | `1` mostra `/dev/kit` (componentes e sessão) em produção. Em dev ele sempre aparece. |
| `API_INTERNAL_URL` | execução | URL da API para os componentes de servidor (catálogo). Padrão: `http://127.0.0.1:3017`. |
| `API_DEV_URL` | dev | Destino dos rewrites do `next dev`. Padrão: `http://localhost:3017`. |
| `PORT` / `HOSTNAME` | execução | Do `start.mjs`. Padrão: `4017` / `127.0.0.1`. |

## Login e carteira

- **Privy** (com `NEXT_PUBLIC_PRIVY_APP_ID`): login por e-mail; a carteira Solana embutida é criada no primeiro login. O e-mail vai para o perfil (`updateProfile`).
- **Carteira de desenvolvimento** (sem Privy): par ed25519 gerado no navegador, com a semente no `localStorage` (`solvers.devWallet.v1`). Assina o SIWS e a transação que o servidor montou (o servidor paga a taxa). Só em localnet/devnet.
  - Sair não apaga a semente: o mesmo navegador volta para a mesma carteira. Para começar do zero, use **"Usar outra carteira de teste"** no menu da conta (ou em "Trocar conta" no checkout).
  - Para testar com a carteira de dev mesmo tendo o `.env.local` do Privy: `NEXT_PUBLIC_PRIVY_APP_ID= pnpm dev` (em `apps/web`).
- A sessão é o cookie httpOnly do servidor. Como o JS não vê o cookie, a vitrine guarda um indício (`solvers.session.v1`) depois do login e só pergunta `/api/auth/me` quando há indício, ou uma vez por aba (para achar uma sessão aberta fora da vitrine). Um 401 no meio da sessão relê a sessão e as telas pedem o login de novo.

## Rotas

| Rota | Tela |
|---|---|
| `/` | Home: busca por necessidade, categorias, mais bem avaliados, em alta e novidades |
| `/especialistas/[slug]` | Especialista: notas, garantia, antes e depois, requisitos, versões, avaliações e detalhes técnicos |
| `/criadores/[id]` | Perfil público do criador |
| `/checkout?agent=<slug>&type=permanent\|guarantee` | Checkout (saldo em USDC ou Pix; garantia com título e descrição) |
| `/checkout/concluido?agent=<slug>&sig=...` | Compra concluída (confere a compra na conta) |
| `/instalar?agent=<slug>` | Instalação guiada do conector (o "Testar grátis" leva para cá) |
| `/biblioteca`, `/biblioteca/memorias` | Licenças, uso e memórias |
| `/garantias` | Tarefas com garantia: etapas, prévia, aprovar e contestar |
| `/perfil` | Perfil, reputação e histórico |
| `/criador`, `/criador/publicar` | Painel do criador; formulário de publicação mockado (Fase D) |
| `/revenda` | Mercado de revenda de licenças (anúncios reais; "em breve" com `resaleEnabled` desligada). Regras em `docs/resale.md` |
| `/dev/kit` | Kit de componentes (só em dev ou com `NEXT_PUBLIC_SHOW_DEV_KIT=1`) |

## Onde fica cada coisa

- `src/lib/`: `api` (cliente e `serverApi`), `session` (login, carteira, config), `wallet/` (Privy e carteira de dev), `tx` (assinar e enviar, erros em português), `format` (moeda, datas no fuso de Brasília, reputação), `explorer` (links do explorador e nome da rede), `hooks` (`useNow`, `useAgentsIndex`), `style` (`gap`).
- `src/components/ui/`: peças do design (Button, Card, Chip/RepBadge, Tabs, Empty, Toast, AuthGate, TechCard, Ago...). `layout/`: cabeçalho, rodapé, tema e troca de conta.
- `src/components/<área>/`: `catalog`, `checkout`, `account` e `creator`.
- Especificação: `design/WEB_SPEC.md`. Screenshots do roteiro da demo: `design/screenshots/`.

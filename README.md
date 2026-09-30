# Solvers

Marketplace de especialistas de IA ("solvers") que se conectam ao Claude e ao ChatGPT por um único
conector MCP. A compra gera uma licença (NFT Metaplex Core) na carteira Solana do usuário; avaliações,
créditos, garantias (escrow) e reputação ficam on-chain. Especificação completa: [INSTRUCTIONS.md](INSTRUCTIONS.md).

```
apps/server            Node 22 + Express: API da loja, conector MCP, OAuth, indexador, jobs
programs/solvers       Programa Anchor 1.2 (licenças, créditos, avaliações, escrow)
packages/shared        Contrato de dados (zod) usado por servidor e vitrine
packages/solvers-client  Cliente TS gerado com Codama a partir do IDL
packages/chain         Transações com a plataforma como fee payer, eventos, Metaplex Core
packages/api-client    Cliente tipado da API para a vitrine (troca os mocks sem mudar telas)
agents/                Pacotes dos 8 solvers (3 completos + 5 de catálogo)
scripts/               bootstrap da rede, e2e (compra, API, conector, fluxo completo)
infra/                 PM2, nginx e scripts de deploy no padrão da VPS
```

## Decisões que diferem do INSTRUCTIONS.md

| Tema | Decisão | Motivo |
|---|---|---|
| Infra | PM2 + nginx + PG16 (5433) com pgvector na VPS, não docker-compose/Caddy | Respeitar a VPS compartilhada (VPS_GUIDE.md) |
| Domínio | Um domínio só (`solvers.wondervelop.com`): vitrine em `/`, servidor em `/api`, `/mcp`, `/oauth`, `/.well-known` | Sem CORS; cookie de sessão do mesmo site |
| Taxas | A plataforma é fee payer de toda transação (usuário não precisa de SOL) | Público leigo / login por e-mail |
| Preço mínimo | Toda compra (licença, pacote de créditos, garantia) >= `min_price` (5 USDC) | Cobrir o rent pago pela plataforma |
| USDC | Mint de teste próprio + faucet na API (devnet) | Faucet da Circle é limitado; demo não depende dele |
| Avaliação | Uma licença prova uma única avaliação (PDA `license_review`), preço fixado na compra (`expected_price`) | Correções da revisão de segurança |
| Garantia | Prazo de liberação automática por etapa (`passed_at + review_window`) | Várias etapas com prazos independentes |
| Teste grátis | 3 usos por carteira por solver, controlado off-chain | Não existia no programa |
| Revenda | Tela alimentada por dados simulados (P2) | Fora do escopo P0/P1 |
| SBPF | Build com `--arch v1` | Devnet/mainnet ainda aceitam deploy v0-v2; o validador de teste 3.x não roda v3 |

## Rodando localmente

Pré-requisitos: Node 22+, pnpm 10, WSL com Solana CLI + Anchor 1.2 (para o programa), Postgres 16 com pgvector.

```bash
pnpm install
pnpm --filter @solvers/shared --filter @solvers/client --filter @solvers/chain build

# programa (no WSL)
bash scripts/chain/build-program.sh        # anchor build --arch v1 + copia o IDL
bash scripts/chain/test-program.sh         # 13 testes LiteSVM
bash scripts/chain/local-validator.sh      # validador local com o programa e o Metaplex Core

# rede + servidor
cd scripts && npx tsx src/bootstrap-chain.ts          # mint de USDC de teste + Config
cd apps/server && cp ../../infra/.env.example .env     # ajuste para localnet
pnpm --filter @solvers/server cli:publish             # publica os 8 solvers
pnpm --filter @solvers/server cli:seed                # compras, avaliações, usos, garantias
pnpm --filter @solvers/server dev

# testes ponta a ponta (servidor rodando)
cd scripts && npx tsx src/e2e-purchase.ts && npx tsx src/e2e-api.ts && npx tsx src/e2e-mcp.ts && npx tsx src/e2e-full.ts
```

Chaves de desenvolvimento ficam fora do repositório (`~/solvers-keys` no WSL, `apps/server/.keys`).

## Conector

URL: `https://solvers.wondervelop.com/mcp`. O Claude/ChatGPT descobre o OAuth pelo 401 do `/mcp`, registra-se
sozinho (DCR), abre `/oauth/authorize` (página "Conectar sua carteira"), recebe o token (PKCE) e passa a usar
as 12 ferramentas: `list_my_solvers`, `find_solver`, `get_purchase_link`, `activate_solver`, `preflight_check`,
`next_step`, `search_knowledge`, `run_tool`, `get_memory`, `save_memory`, `submit_deliverable`, `escalate_to_creator`.

## Deploy

Veja [NEXT_STEPS.md](NEXT_STEPS.md) para o que falta do seu lado (SOL de devnet, DNS, Helius, Telegram).
Depois: `bash infra/deploy.sh` (envia o commit atual, compila, migra e recarrega o PM2).

# Solvers

English | [Português](README.pt-BR.md)

A marketplace of AI specialists ("solvers") that plug into Claude and ChatGPT through a single MCP connector.
Buying a solver mints a license (a Metaplex Core NFT) into the buyer's Solana wallet; reviews, credits,
guarantees (escrow) and reputation all live on-chain. Full specification: [INSTRUCTIONS.md](INSTRUCTIONS.md) (in Portuguese).

```
apps/server              Node 22 + Express: store API, MCP connector, OAuth, indexer, jobs
programs/solvers         Anchor 1.2 program (licenses, credits, reviews, escrow)
packages/shared          Data contract (zod) shared by the server and the storefront
packages/solvers-client  TS client generated with Codama from the IDL
packages/chain           Transactions with the platform as fee payer, events, Metaplex Core
packages/api-client      Typed API client for the storefront (swaps out the mocks without changing screens)
agents/                  Solver packages (6 published; backend-node and planilhas-dados are kept off the storefront)
scripts/                 Network bootstrap, e2e (purchase, API, connector, full flow)
infra/                   PM2, nginx and deploy scripts following the VPS conventions
```

Solver packages are English-primary, with optional Portuguese (pt-BR) translations in `locales/pt.json`.
The package format is documented in [PACKAGE_SPEC.md](PACKAGE_SPEC.md), the creator workflow in
[docs/creator-guide.md](docs/creator-guide.md), and a plain-language tour of the whole system in
[docs/concepts-guide.md](docs/concepts-guide.md).

## Decisions that differ from INSTRUCTIONS.md

| Topic | Decision | Reason |
|---|---|---|
| Infra | PM2 + nginx + PG16 (port 5433) with pgvector on the VPS, not docker-compose/Caddy | Respect the shared VPS (VPS_GUIDE.md) |
| Domain | A single domain (`solvers.wondervelop.com`): storefront at `/`, server at `/api`, `/mcp`, `/oauth`, `/.well-known` | No CORS; same-site session cookie |
| Fees | The platform is the fee payer of every transaction (users need no SOL) | Non-technical audience / email login |
| Minimum price | Every purchase (license, credit pack, guarantee) must be >= `min_price` (5 USDC) | Cover the rent paid by the platform |
| USDC | Self-minted test mint + faucet in the API (devnet) | Circle's faucet is rate-limited; the demo does not depend on it |
| Reviews | One license proves a single review (`license_review` PDA), price locked at purchase (`expected_price`) | Fixes from the security review |
| Guarantee | Automatic release deadline per milestone (`passed_at + review_window`) | Several milestones with independent deadlines |
| Free trial | 3 uses per wallet per solver, tracked off-chain | Did not exist in the program |
| Resale | A license can be resold through the marketplace, non-custodial, with a royalty to the creator (`docs/resale.md`, in Portuguese) | Devnet; mainnet depends on the terms with the lawyer |
| Limited licenses | The creator can cap the number of licenses of a solver (default: unlimited). The current cap is enforced by the program and verifiable on the blockchain; the creator can only raise it, never lower it, and reselling, transferring or burning a license does not free a slot (`docs/licencas-limitadas.md`, in Portuguese) | Devnet, in the same upgrade as resale |
| SBPF | Build with `--arch v1` | Devnet/mainnet still accept v0-v2 deploys; the 3.x test validator does not run v3 |

## Running locally

Prerequisites: Node 22+, pnpm 10, WSL with the Solana CLI + Anchor 1.2 (for the program), Postgres 16 with pgvector.

```bash
pnpm install
pnpm --filter @solvers/shared --filter @solvers/client --filter @solvers/chain build

# program (in WSL)
bash scripts/chain/build-program.sh        # anchor build --arch v1 + copies the IDL
bash scripts/chain/test-program.sh         # 13 LiteSVM tests
bash scripts/chain/local-validator.sh      # local validator with the program and Metaplex Core

# network + server
cd scripts && npx tsx src/bootstrap-chain.ts          # test USDC mint + Config
cd apps/server && cp ../../infra/.env.example .env     # adjust for localnet
pnpm --filter @solvers/server cli:publish             # publishes every package (or only the slugs you pass)
pnpm --filter @solvers/server cli:seed                # purchases, reviews, usage, guarantees
pnpm --filter @solvers/server dev

# end-to-end tests (server running)
cd scripts && npx tsx src/e2e-purchase.ts && npx tsx src/e2e-api.ts && npx tsx src/e2e-mcp.ts && npx tsx src/e2e-full.ts
```

Solver evals: the answers live in `agents/<slug>/evals/outputs/` (generated blind, with the solver active), and
`cd scripts && npm run eval [slug]` applies the checks in `evals/cases/` and writes `evals/report.json`, whose score the publish step records on-chain.
These scores are labeled "internal team test" in the product, never "verified".

Development keys live outside the repository (`~/solvers-keys` in WSL, `apps/server/.keys`).

## Connector

URL: `https://solvers.wondervelop.com/mcp`. Claude/ChatGPT discovers OAuth from the 401 on `/mcp`, registers itself
(DCR), opens `/oauth/authorize` (the "Connect your wallet" page), receives the token (PKCE) and starts using
the 15 tools: `list_my_solvers`, `find_solver`, `get_purchase_link`, `activate_solver`, `preflight_check`,
`next_step`, `search_knowledge`, `run_tool`, `get_memory`, `save_memory`, `forget_memory`, `submit_deliverable`,
`escalate_to_creator`, `list_open_guarantees`, `get_template`.

## Deploy

See [NEXT_STEPS.md](NEXT_STEPS.md) (in Portuguese) for what is still missing on your side (devnet SOL, DNS, Helius, Telegram).
Then: `bash infra/deploy.sh` (ships the current commit, builds, migrates and reloads PM2).

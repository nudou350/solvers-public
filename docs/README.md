# Documentation index

Start with the two English guides; the rest are design notes and runbooks written during development (in Portuguese, marked PT).

## Guides

| Doc | What it covers |
|---|---|
| [concepts-guide.md](concepts-guide.md) | Plain-language tour of the whole system: wallets, licenses, escrow, the MCP connector ([PT](guia-conceitos.md)) |
| [creator-guide.md](creator-guide.md) | How creators build, upload and publish a solver, and how admins review it ([PT](criador-solvers.md)) |
| [../PACKAGE_SPEC.md](../PACKAGE_SPEC.md) | The solver package format: manifest, steps, knowledge base, templates, evals ([PT](../PACKAGE_SPEC.pt-BR.md)) |

## Design notes (PT)

| Doc | What it covers |
|---|---|
| [resale.md](resale.md) | Non-custodial license resale with a creator royalty |
| [licencas-limitadas.md](licencas-limitadas.md) | Per-solver license cap enforced by the program (`supply_cap` PDA, can only be raised) |
| [x402-agentes.md](x402-agentes.md) | AI agents buying licenses on their own through x402 payments |
| [agentes-login.md](agentes-login.md) | Agent login to the MCP connector with Sign-In With Solana (no browser) |
| [cloak-privacidade.md](cloak-privacidade.md) | Private creator withdrawals via Cloak, with mainnet proof transactions ([screenshots](cloak-provas/)) |
| [design-governance-v2.md](design-governance-v2.md) | Governance ideas deliberately left out of v1 |
| [plano-i18n.md](plano-i18n.md) | Migration plan to English-first with Portuguese at `/pt` |

## Runbooks (PT)

| Doc | What it covers |
|---|---|
| [devnet-upgrade.md](devnet-upgrade.md) | Upgrading the program on devnet under the same program ID |
| [deploy-devnet-x402-teto.md](deploy-devnet-x402-teto.md) | The combined devnet upgrade + server deploy for resale, license caps and x402 |
| [deploy-criador-solvers.md](deploy-criador-solvers.md) | Deploying the creator flow (worker process, review queue) |
| [mainnet-runbook.md](mainnet-runbook.md) | Mainnet launch checklist |
| [demo-cloak.md](demo-cloak.md) | Step-by-step script for the private-withdrawal demo |
| [ci-notes.md](ci-notes.md) | CI/CD notes |

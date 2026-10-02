# Roteiro de deploy: upgrade único da devnet + VPS (resale/v2 + teto de licenças + x402)

Status: **escrito em 02/10/2026, nada disto foi executado.** Vale para a branch `integration/x402-licencas` (junta `feat/x402-agentes` e
`feat/licencas-limitadas`, ambas a partir da `master` 433dd82). Escopo: **devnet**. Mainnet continua bloqueada (x402: seção 9 de `docs/x402-agentes.md`).

## O que sobe, e o que exige o quê

| Mudança | Programa (upgrade da devnet) | Banco | Servidor/web | `.env` da VPS |
|---|---|---|---|---|
| Revenda + governança v2 (já na `master`) | sim | 0012, 0013 | sim | `RESALE_ENABLED` (já ligada na VPS) |
| Teto de licenças (`SupplyCap`) | **sim** (`create/raise_supply_cap`, conta nova em `purchase_license`) | 0015 (`agents.max_licenses`) | sim | nada |
| x402 (agentes compram em USDC) | **não** | 0014 (`x402_orders`) | sim | `X402_*`, `CUSTODY_KEYPAIR` |

**Um único upgrade do programa cobre tudo.** O `.so` precisa ser construído **da árvore integrada** (o x402 não muda o programa, mas o `.so`
da revenda/v2 mais o teto só existe na branch do teto).

## Regras que não podem ser quebradas

1. **Nada de `git push` na `master` antes do upgrade do programa e do `migrate-config`** (o push dispara o deploy automático).
   Servidor novo contra programa antigo: compra de licença falha (falta a conta `supply_cap`) e garantia grava escrow em layout velho.
2. **Servidor antigo contra programa novo**: a compra de licença falha até o deploy (a conta nova não existe nele). Créditos, garantias e revenda
   seguem. Por isso o push vem **logo depois** do `migrate-config`.
3. As migrations (0014, 0015) são **só aditivas** e rodam sozinhas no deploy (`infra/deploy.sh`), antes de trocar o release.
4. Chaves (`CUSTODY_KEYPAIR`, admin, fee payer) nunca vão para o git, para log ou para resposta de API.

## Passo 0: juntar na `master` (local, sem push)

```bash
git checkout master                       # na checkout principal
git merge --ff-only integration/x402-licencas    # a branch descende da 433dd82: fast-forward
```
Se a `master` andou (o outro agente comitou), faça `git merge integration/x402-licencas` e rode `pnpm typecheck && pnpm test`.
**Não dê push ainda.** Conferir também: `programs/` não mudou desde o `.so` que você vai implantar (passo 1).

## Passo 1: upgrade do programa na devnet (WSL; detalhes e valores em `docs/devnet-upgrade.md`)

1. `bash scripts/chain/build-program.sh` (gera `.so`, IDL e cliente; tem que dar **932.768 bytes**, teto da CI 946.244). `git status` não pode mostrar
   `packages/solvers-client` alterado em relação ao commit (se mostrar, o cliente está velho: commite).
2. `bash scripts/chain/test-program.sh` (esperado: **124 testes passando**).
3. Pré-check de Config e dry-run: `bash scripts/chain/upgrade-devnet.sh` (só lê). Conferir saldo do admin/fee-payer contra o plano
   (o `.so` com revenda + teto pede ~6,4 SOL de buffer, devolvíveis, mais ~0,6 SOL de extensão que não volta; o dry-run imprime os números reais).
4. `bash scripts/chain/upgrade-devnet.sh --yes`.
5. **Logo em seguida**, sem outra instrução no meio (janela em que a Config v1 não deserializa):
   `pnpm --filter @solvers/server cli:admin:devnet migrate-config --keypair ~/solvers-keys/admin.json` (dry-run) e depois com `--yes`.

Conferir: `solana program show DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW --url devnet` (Last Deployed Slot novo).

## Passo 2: preparar o `.env` da VPS (ainda sem ligar o x402)

Em `/var/www/solvers/shared/.env`: nada é obrigatório para o teto. Para o x402 só **prepare**; não ligue ainda:

```
X402_ENABLED=false
X402_FACILITATOR_URL=https://x402.org/facilitator      # público, aceita o nosso USDC da devnet (spike 0.2)
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
X402_MIN_PRICE_USDC=5
X402_MAX_PRICE_USDC=100
X402_ORDER_TTL_SECS=900
X402_MAX_OPEN_ORDERS_PER_IP=20
X402_TEST_FAIL_MINT=false                               # só para e2e; nunca true no ar
```
Ler `VPS_GUIDE.md (guia privado)` antes de qualquer mudança de porta, nginx ou PM2. **Não há mudança de nginx**: a rota é `/api/x402`.

## Passo 3: push e deploy (primeiro com o x402 desligado)

1. `git push origin master` (agora sim: o programa já foi atualizado e migrado).
2. O GitHub Actions faz typecheck/testes, o `infra/deploy.sh` roda as migrations 0014 e 0015 **antes** de trocar o release e faz rollback sozinho
   se o health check falhar. Acompanhe a execução.
3. Conferir no ar:
   - na VPS: `curl -fsS http://127.0.0.1:3017/health` (o próprio deploy já exige 3 verificações seguidas);
   - uma compra normal pela vitrine (precisa terminar: prova que `purchase_license` com a conta `supply_cap` funciona);
   - `GET /api/agents` devolve `supply` (`max: null` até algum criador definir teto).

## Passo 4: teto de licenças em algum solver (opcional, quando quiser)

Em `manifest.json` do solver: `"supply": { "maxLicenses": N }` e `pnpm --filter @solvers/server cli:publish:devnet <slug do pacote em agents/>` (o CLI cria o teto
on-chain com a chave do criador e só **sobe** depois). Validar: `GET /api/agents/<slug>` mostra `supply.left`; `cd scripts && npx tsx src/e2e-supply.ts`
(teto 1, dois compradores, o segundo recebe `sold_out`).

## Passo 5: ligar o x402 na VPS (o que ficou pendente do x402)

1. **Gerar a custódia na própria VPS** (uma carteira nova, nunca reaproveitada; o comando recusa se repetir fee payer/verificador/uso/admin):
   ```bash
   ssh deploy@<VPS_IP>
   cd /var/www/solvers/app
   pnpm --filter @solvers/server cli:x402-setup --generate /var/www/solvers/shared/custody.json   # recusa se o arquivo existir
   chmod 600 /var/www/solvers/shared/custody.json
   ```
2. No `/var/www/solvers/shared/.env`: `CUSTODY_KEYPAIR=/var/www/solvers/shared/custody.json` (o servidor aceita caminho de arquivo).
3. Criar a ATA de USDC da custódia (o fee payer paga o rent; idempotente): `pnpm --filter @solvers/server cli:x402-setup` (no mesmo diretório).
   (Equivalente a partir do PC: `cli:x402-setup:devnet` com o túnel do banco aberto e a custódia no `.env.devnet`; prefira a VPS para a chave não sair de lá.)
4. `X402_ENABLED=true` no `.env` e `pm2 reload solvers-api --update-env`. O servidor **recusa subir** se `X402_ENABLED` com mainnet, sem custódia, ou com custódia
   repetida (`x402ConfigProblem`).
5. Verificar: `GET /api/x402/solvers/<slug>` devolve `available: true`, `payTo` = endereço da custódia. Do PC, com USDC de teste e a carteira de um agente:
   `cd scripts && npx tsx src/e2e-agent.ts` (9 passos: cotação, 402, pagamento adulterado recusado, compra, login do agente, uso do Solver, `already_owned`,
   reembolso). Se o x402 ficar desligado, os agentes continuam recebendo instruções de compra por x402 nas respostas do MCP: ligue-o logo depois do deploy.

## Rollback

- **x402**: `X402_ENABLED=false` + `pm2 reload solvers-api --update-env` (a rota some; ordens pendentes são retomadas ao religar). A migration é aditiva.
- **Servidor**: o `infra/deploy.sh` volta sozinho ao release anterior se o health check falhar. Manual: apontar os symlinks para o release anterior (ver o script).
- **Programa**: o upgrade não tem volta automática. O backup do `.so` anterior fica em `~/solvers-build/backup/` (o script grava antes de escrever).
  Contas novas (`SupplyCap`) não atrapalham o `.so` antigo, mas o `.so` antigo não decodifica Config v2 nem aceita a conta nova na compra.

## Pendências conhecidas (não bloqueiam o deploy)

1. E2E do cenário `price_changed` do x402 (exige a chave do criador).
2. A rota x402 foi validada na devnet **antes** da conta `supply_cap`: rode `e2e-agent.ts` de novo depois do upgrade (passo 5.5).
3. Decisão O1 (uma licença por carteira nos produtos limitados): o guarda `already_owned` do x402 já vale para todos os produtos nas compras por x402 e
   na vitrine (`/tx/purchase`); não há regra on-chain.
4. Parecer jurídico da custódia antes de qualquer mainnet; `X402_ENABLED` é recusado na mainnet por código.

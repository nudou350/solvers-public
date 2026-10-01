# Atualizar o programa na devnet (mesmo program id)

> **NUNCA dar `git push` (deploy automático da master) antes de o upgrade do programa estar concluído e
> conferido.** Servidor novo contra programa antigo cria escrow no layout antigo sem aviso, e esse escrow fica
> irrecuperável depois do upgrade. O inverso (programa novo + servidor antigo) só impede criar garantias; o
> resto continua funcionando.

Programa `DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW`, upgrade authority = admin
`EA2Nz3yBuF28hHC4xYBnSR4B3bJVWuDUt3VSsCV9KoGr`. Tudo roda no WSL, na raiz do repositório.
Quem faz o trabalho é `scripts/chain/upgrade-devnet.sh` (dry-run por padrão; só escreve com `--yes`).

## Pré-requisitos

- Chaves em `~/solvers-keys/`: `admin.json` (authority), `fee-payer.json` (financia o admin), `program.json`.
- Solana CLI no WSL (o `env.sh` acrescenta o PATH, então `wsl bash script` funciona).
- Um `.so` novo em `~/solvers-build/target/deploy/solvers.so`, mais recente que `programs/solvers/src`
  (o script recusa binário velho, mesma regra do `test-program.sh`).
- Saldo: o upgrade cria um buffer do tamanho do `.so` (~3,5 SOL, **devolvido ao admin ao final**) e, se o `.so`
  crescer, `solana program extend` cobra o depósito dos bytes extras (~5,08e-6 SOL/byte, não volta). Com `--yes`
  o script transfere do fee-payer para o admin só o que faltar (arredondado a 0,1 SOL), sem faucet. O fee-payer
  também paga taxas/rent do servidor, então o script aborta se ele ficar com menos de 1 SOL
  (`FEEPAYER_RESERVE_LAMPORTS` muda isso). Hoje: admin ~1,51; fee-payer ~4,81; necessário ~3,83; transfere ~2,4.
- O ProgramData pode não ter folga sobre o `.so` implantado: qualquer crescimento além do `Data Length` atual
  (`solana program show <id> --url devnet`) exige extensão; o script estende o crescimento + 1 KB de margem.
- **Config (fee_bps)**: o novo `update_config` recusa `fee_bps` > 2000. Confira antes (somente leitura, a partir
  de `apps/server`; se passar de 2000, corrija a Config antes do upgrade):

```bash
cd apps/server && node --input-type=module - <<'EOF'
import { createSolanaRpc } from "@solana/kit";
import * as c from "@solvers/client";
const rpc = createSolanaRpc("https://api.devnet.solana.com");
const cfg = await c.fetchConfig(rpc, (await c.findConfigPda())[0]);
console.log("fee_bps =", cfg.data.feeBps, cfg.data.feeBps <= 2000 ? "(ok)" : "(ACIMA de 2000)");
EOF
```
  Hoje: `fee_bps = 1000` (ok).

## Ordem exata

1. **Build** (gera `.so`, IDL e cliente): `bash scripts/chain/build-program.sh`. Opcional: `bash scripts/chain/test-program.sh`.
   Commite o que mudou em `packages/solvers-client` (IDL/cliente), **mas sem dar push**.
2. **Dry-run**: `bash scripts/chain/upgrade-devnet.sh`. Só lê da devnet e imprime o plano: tamanho do ProgramData
   e do novo `.so`, bytes a estender, saldo do admin x necessário, quanto sairia do fee-payer, caminho do backup.
   Sai com erro se faltar keypair/`.so`/CLI, se o `.so` estiver velho, se a authority on-chain não for o admin,
   se o fee-payer ficaria abaixo da reserva ou se a rede não for a devnet (confere o genesis hash).
3. **Revisar** o plano (valores, hash do `.so`, buffers antigos presos do admin, se listados) e o pré-check de Config.
4. **Executar**: `bash scripts/chain/upgrade-devnet.sh --yes` (acrescente `--return-excess` para devolver ao
   fee-payer, no fim, o que sobrar no admin acima de 0,5 SOL; sem a flag nada é devolvido). Sequência: backup do
   `.so` em produção (`solana program dump` para `~/solvers-build/backup/solvers-slot<slot>-<data>.so`, mais cópia
   do `.so` novo) -> transferência fee-payer -> admin (se faltar) -> `extend` (blocos de 10000 bytes) ->
   `solana program deploy` (upgrade, `--with-compute-unit-price 1000`) -> conferência (Last Deployed Slot mudou,
   Data Length >= `.so`, conteúdo on-chain idêntico ao `.so`) -> saldos finais (e devolução, se pedida).
5. **Conferir as outras contas** (somente leitura; só depois disto liberar o push). Hoje o programa tem 53 contas
   (6 Agent, 19 LicenseReview, 19 Review, 7 UserReputation, 1 Config e o escrow de teste antigo); depois do
   upgrade devem decodificar todas, exceto o escrow antigo:

```bash
cd apps/server && node --input-type=module - <<'EOF'
import { createSolanaRpc } from "@solana/kit";
import * as c from "@solvers/client";
const rpc = createSolanaRpc("https://api.devnet.solana.com");
const accs = await rpc.getProgramAccounts(c.SOLVERS_PROGRAM_ADDRESS, { encoding: "base64" }).send();
const dec = { [c.SolversAccount.Agent]: c.getAgentDecoder, [c.SolversAccount.Config]: c.getConfigDecoder, [c.SolversAccount.Credits]: c.getCreditsDecoder, [c.SolversAccount.Escrow]: c.getEscrowDecoder, [c.SolversAccount.LicenseReview]: c.getLicenseReviewDecoder, [c.SolversAccount.Review]: c.getReviewDecoder, [c.SolversAccount.UserReputation]: c.getUserReputationDecoder };
const n = {}, bad = [];
for (const { pubkey, account } of accs) {
  const data = Buffer.from(account.data[0], "base64");
  try { const k = c.identifySolversAccount(data); dec[k]().decode(data); n[c.SolversAccount[k]] = (n[c.SolversAccount[k]] ?? 0) + 1; }
  catch { bad.push(pubkey); }
}
console.log(accs.length, "contas; decodificam:", JSON.stringify(n), "| falham:", bad.length, bad.join(" "));
EOF
```
   Esperado após o upgrade: só `CY8GP4eM25jL7ofX4oEfedoCVh3BHtP4oHucmwWKvTzd` (o escrow antigo) pode falhar; se
   outra conta falhar, **não dê push**: investigue (ou faça rollback).
6. **Servidor + web**: só agora, `git push` na `master` (o CI faz o deploy na VPS). Acompanhe o Actions e
   `pm2 logs solvers-api`. Veja a janela de incompatibilidade abaixo.
7. **Retirar o escrow antigo no banco da VPS** (PG `solvers`, porta 5433). Faça `pg_dump` antes e rode, na VPS:
   `pnpm --filter @solvers/server cli:retire-escrows` (dry-run: só lista, lê o RPC, não altera nada) e, revisando a
   lista, `pnpm --filter @solvers/server cli:retire-escrows --yes`. Ele marca como `refunded`/`closed` os escrows
   ausentes ou ilegíveis na cadeia; não apaga linhas.
8. **Reindexar**: na VPS, `pnpm --filter @solvers/server cli:reindex --backfill` (idempotente; completa
   `chain_txs` e reconstrói o espelho a partir do estado on-chain). Se sobrar pendência: `cli:reindex --dead`.
9. **Republicar especialistas se o hash mudou**: `pnpm --filter @solvers/server cli:publish <slug...>` (ou sem
   argumentos, para todos os pacotes em `agents/`), só dos pacotes cujo conteúdo/hash mudou.

## O que muda neste upgrade (governança do admin)

- **5 instruções novas**: `propose_admin(new_admin)`, `accept_admin`, `cancel_admin_transfer` (rotação do admin em 2 etapas),
  `set_treasury` (troca a conta de USDC da tesouraria) e `top_up_stake(amount)` (o criador repõe stake; reativar o
  solver ainda exige `approve_agent`). Retirada de stake e pausa continuam inexistentes (`docs/design-governance-v2.md`).
- **PDA nova** `PendingAdmin` (seeds `["pending_admin", config]`, 73 bytes): só existe entre a proposta e o aceite ou
  cancelamento. Não muda o layout de `Config` nem de nenhuma conta existente, então o passo 5 não muda.
- **5 eventos e 2 erros novos** (`NotPendingAdmin` 6034, `InvalidNewAdmin` 6035). O indexador já os trata: `StakeToppedUp`
  relê o solver (o stake é espelhado) e `TreasuryUpdated` limpa o cache da tesouraria; os de admin só ficam registrados.
- **O `.so` cresce de 715.664 para 773.992 bytes (+58.328)**. Em 2026-10-01 o `solana program show` da devnet mostrava
  `Data Length: 726216` (o ProgramData já tem folga sobre o `.so` anterior), então o crescimento a cobrir é de
  47.776 bytes. Pelo cálculo do script (crescimento + 1.024 de margem, arredondado a blocos de 10.240): **extensão de
  51.200 bytes (5 blocos), ~0,26 SOL (51.200 × 5,08e-6, não volta)**. O buffer do upgrade passa de ~3,5 para
  **~3,9 SOL** (774.029 bytes; volta ao admin). Necessário no admin: ~3,9 + 0,26 + 0,05 de margem = **~4,2 SOL**
  (a linha "Hoje" dos pré-requisitos, ~3,83, era para o `.so` de 715.664 bytes). Com o admin em ~3,70 SOL faltam ~0,5
  e o script transfere ~0,6 do fee-payer (~2,40 SOL), que fica com ~1,8, acima da reserva de 1 SOL. Estimativa: o
  `Data Length` muda a cada upgrade, então confira o valor atual antes e use o dry-run do passo 2, que imprime os
  números reais.
- **Ordem (a mesma de sempre)**: build, dry-run, `--yes`, conferência e **só então** `git push` do servidor. O servidor
  novo conhece os eventos, mas não depende deles para funcionar; já o programa novo com servidor antigo só deixa os
  eventos novos sem tratamento (o parser ignora discriminador desconhecido), sem derrubar o indexador.

### Operar o admin: `cli:admin`

Dry-run por padrão (imprime contas, quem assina, saldo do fee payer, taxa estimada e o resultado da simulação; nada é
enviado); só envia com `--yes`. Nunca imprime chave. Use `cli:admin:devnet` para carregar o `.env.devnet`.
O comando confere o genesis hash do RPC e **aborta se não for a devnet, até no dry-run** (um `.env` de mainnet não envia nada
por engano). Só para outra rede, de propósito: `--allow-network <nome>`, em que `<nome>` é a rede detectada
(`mainnet-beta` ou `desconhecida`, ex. localnet); nome que não bate com a rede detectada não libera. Erro ao ler arquivo de
chave mostra só `arquivo de chave inválido: <caminho>`, nunca trecho do conteúdo.

```bash
# troca de admin (2 etapas). O fee payer da plataforma paga as taxas e o rent da proposta (volta ao fechar)
pnpm --filter @solvers/server cli:admin:devnet propose <novo-admin> [--yes]        # assina ADMIN_KEYPAIR (ou --keypair)
pnpm --filter @solvers/server cli:admin:devnet accept --keypair <chave-do-novo-admin.json> [--yes]
pnpm --filter @solvers/server cli:admin:devnet cancel [--yes]                       # desiste da proposta pendente
# tesouraria: informe a CONTA de token de USDC (não a carteira); precisa ser do USDC da plataforma e não congelada
pnpm --filter @solvers/server cli:admin:devnet set-treasury <conta-usdc> [--yes]
# stake: assinado pelo CRIADOR (chave em CREATOR_KEYS_DIR/<creator.id>.json ou --keypair); sem a chave só imprime o plano
pnpm --filter @solvers/server cli:admin:devnet top-up-stake <slug> <usdc> [--yes]
```

Depois do `accept`, a chave antiga deixa de ser admin: troque `ADMIN_KEYPAIR` do servidor (se ele usa admin) pela nova.
Se o criador reabastecer um solver suspenso, o admin ainda precisa aprovar de novo (`approve_agent`).

## O escrow de teste antigo

`CY8GP4eM25jL7ofX4oEfedoCVh3BHtP4oHucmwWKvTzd` (740 bytes, layout v1) é o único dos 53 que já não decodifica com
o cliente novo. Seu vault (`6X4jVobkddmdFUKbXxM1ZSgSBW9J8KYG31SqAdGkWo1S`) guarda **19 USDC de teste**. O
programa novo não consegue operar esse escrow, então esse USDC fica preso no vault para sempre: sem valor (USDC
de teste da devnet). Não tente liberá-lo; basta retirá-lo do banco (passo 7).

## Janela de incompatibilidade servidor x programa

- Programa novo + servidor antigo (entre os passos 4 e 6): só impede criar garantias; compras, licenças,
  leituras e o resto seguem funcionando. Se o indexador registrar falhas, o `cli:reindex --dead` do passo 8 recupera.
- Servidor novo + programa antigo (push antes do upgrade): **o pior caso**. O servidor cria escrow no layout
  antigo sem aviso e ele fica irrecuperável depois do upgrade. Por isso o push só acontece no passo 6.

## Rollback

O upgrade authority permite voltar ao `.so` anterior, que o passo 4 guarda em `~/solvers-build/backup/`
(confira o nome impresso em `[1/6]`). Não apague essa pasta antes de validar o upgrade.

```bash
solana program deploy ~/solvers-build/backup/solvers-slot<SLOT>-<DATA>.so \
  --program-id ~/solvers-keys/program.json --upgrade-authority ~/solvers-keys/admin.json \
  --keypair ~/solvers-keys/admin.json --url https://api.devnet.solana.com --with-compute-unit-price 1000
solana program show DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW --url https://api.devnet.solana.com
```

O ProgramData não encolhe: o `.so` antigo (menor) cabe no espaço já estendido. O rollback também precisa de
~3,5 SOL de buffer no admin (devolvidos): se usou `--return-excess`, devolva antes o saldo ao admin. Se o push já
foi dado, desfaça o deploy do servidor/web (revert + push) para voltar ao par compatível. Escrows criados com o
layout novo ficam ilegíveis para o programa antigo; o rollback só é limpo se ninguém os criou.

## Se algo falhar no meio

- O script mostra o que falhou e não reverte sozinho. Confira `solana program show <program id> --url devnet`.
- Upgrade interrompido deixa um buffer com SOL preso: `solana program show --buffers --buffer-authority <admin> --url devnet`
  lista; `solana program close --buffers --keypair ~/solvers-keys/admin.json --url devnet` recupera. O dry-run
  seguinte também avisa se houver buffers antigos.

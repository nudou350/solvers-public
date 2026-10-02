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
  **Esses números são do `.so` anterior à revenda.** Com ela (`.so` de 909.888 bytes) o buffer sobe para ~6,3 SOL
  (devolvíveis) e a extensão custa mais (ver "O que muda neste upgrade"): confira o saldo do admin e do fee-payer
  contra o dry-run, que imprime os valores reais, antes do `--yes`.
- O ProgramData pode não ter folga sobre o `.so` implantado: qualquer crescimento além do `Data Length` atual
  (`solana program show <id> --url devnet`) exige extensão; o script estende o crescimento + 1 KB de margem.
- **Config (fee_bps)**: o novo `update_config` recusa `fee_bps` > 2000. Confira antes (somente leitura, a partir
  de `apps/server`; se passar de 2000, corrija a Config antes do upgrade). O cliente gerado novo só decodifica a
  Config **v2** (285 bytes) e a da devnet ainda é **v1** (187 bytes), então o trecho lê o `fee_bps` direto dos bytes
  (u16 no offset 168: 8 do discriminador + 5 endereços de 32):

```bash
cd apps/server && node --input-type=module - <<'EOF'
import { createSolanaRpc } from "@solana/kit";
import * as c from "@solvers/client";
const rpc = createSolanaRpc("https://api.devnet.solana.com");
const [pda] = await c.findConfigPda();
const { value } = await rpc.getAccountInfo(pda, { encoding: "base64" }).send();
const d = Buffer.from(value.data[0], "base64");
const fee = d.readUInt16LE(168);
console.log("Config", pda, "| tamanho =", d.length, "(v1 = 187) | fee_bps =", fee, fee <= 2000 ? "(ok)" : "(ACIMA de 2000)");
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
4a. **Migrar a Config (v1 -> v2), logo depois do upgrade e antes de qualquer outra coisa.** O programa novo lê a
   Config com 285 bytes; a da devnet tem 187 e só `migrate_config` a estende (acrescenta `layout_version`,
   `pause_flags`, `guardian` e 64 reservados, tudo zerado, e grava `layout_version = 2`; os 187 bytes antigos ficam
   intactos). Assina a **upgrade authority** (na devnet é a chave do admin, `~/solvers-keys/admin.json`); o fee payer
   paga o rent adicional (~0,0007 SOL, fica na conta Config). Dry-run primeiro, depois `--yes`:

```bash
pnpm --filter @solvers/server cli:admin:devnet migrate-config --keypair ~/solvers-keys/admin.json
pnpm --filter @solvers/server cli:admin:devnet migrate-config --keypair ~/solvers-keys/admin.json --yes
```
   O dry-run lê a Config **sem decodificar** (ela é v1), confere que a chave é mesmo a upgrade authority gravada no
   ProgramData e simula. Depois de enviado, `migrate-config` recusa uma segunda vez ("já está no layout v2"), e o
   programa também (`ConfigAlreadyMigrated`, 6037).

   **Janela:** entre o fim do passo 4 e o fim do 4a, **toda instrução do programa que lê a Config falha**
   (`AccountDidNotDeserialize`: compras, garantias, pagamentos, `update_config`, `set_treasury`...). Dura segundos
   se você rodar o 4a em seguida; não rode nada além do 4a nesse intervalo. No servidor, o decoder novo também
   falha em Config v1: `fetchConfig()` lança `ConfigNotMigratedError` (mensagem aponta o `migrate-config`) e a leitura
   da pausa (`fetchConfigState`) devolve `v1` sem lançar (o servidor segue sem bloquear; ver "Pausa" abaixo).
   Por isso o push do servidor (passo 6) só vem depois do 4a.

   **Conferir (somente leitura):** a conta Config deve ter **285 bytes** (v1 = 187) e `layoutVersion = 2`:

```bash
cd apps/server && node --input-type=module - <<'EOF'
import { createSolanaRpc } from "@solana/kit";
import * as c from "@solvers/client";
const rpc = createSolanaRpc("https://api.devnet.solana.com");
const [pda] = await c.findConfigPda();
const { value } = await rpc.getAccountInfo(pda, { encoding: "base64" }).send();
const d = Buffer.from(value.data[0], "base64");
console.log("Config", pda, "| tamanho =", d.length, d.length === 285 ? "(v2, ok)" : "(ESPERADO 285)");
if (d.length === 285) { const x = c.getConfigDecoder().decode(d); console.log({ layoutVersion: x.layoutVersion, pauseFlags: x.pauseFlags, guardian: x.guardian, feeBps: x.feeBps, admin: x.admin }); }
EOF
```
   Esperado: `layoutVersion: 2`, `pauseFlags: 0`, `guardian: 1111...1111` (sem guardian) e os demais campos como antes
   (`feeBps`, `admin`...). Alternativa sem Node: `solana account 4F8CXntHkggs1XyFB156UH55zpHQT3tq4GGxp6bLt8tt --url devnet`
   mostra `Length: 285`. Se o tamanho não for 285, **não dê push**.
   Se o 4a falhar no meio, a transação é atômica: a Config continua v1 e dá para repetir.
5. **Conferir as outras contas** (somente leitura; só depois disto liberar o push). Hoje o programa tem 53 contas
   (6 Agent, 19 LicenseReview, 19 Review, 7 UserReputation, 1 Config e o escrow de teste antigo); depois do
   upgrade (e a migração do passo 4a) devem decodificar todas, exceto o escrow antigo (a Config já migrada conta como v2):

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
6. **Servidor + web**: só agora (upgrade feito, Config com 285 bytes), `git push` na `master` (o CI faz o deploy na VPS: migration,
   servidor e web juntos). A revenda sobe **desligada** (`resaleEnabled=false`; a tela `/revenda` fica "em breve" e o servidor não
   deve montar transações de revenda; conferir no código que a flag cobre as rotas). Acompanhe o Actions e `pm2 logs solvers-api`. Veja a janela de incompatibilidade abaixo.
7. **Retirar o escrow antigo no banco da VPS** (PG `solvers`, porta 5433). Faça `pg_dump` antes e rode, na VPS:
   `pnpm --filter @solvers/server cli:retire-escrows` (dry-run: só lista, lê o RPC, não altera nada) e, revisando a
   lista, `pnpm --filter @solvers/server cli:retire-escrows --yes`. Ele marca como `refunded`/`closed` os escrows
   ausentes ou ilegíveis na cadeia; não apaga linhas.
7a. **Limpar os dados simulados da revenda** (anúncios inventados pelo `seed`: `licenses.listed_for_resale` e
   `licenses.resale_price`, e o histórico da tabela `resale_prices`). Faça `pg_dump` antes e **confirme com o dono antes de
   qualquer DELETE/UPDATE**; o anúncio real só existe a partir do `Listing` on-chain, então nada disso é recuperável nem
   necessário depois. Detalhes em `docs/resale.md`.
8. **Reindexar**: na VPS, `pnpm --filter @solvers/server cli:reindex --backfill` (idempotente; completa
   `chain_txs` e reconstrói o espelho a partir do estado on-chain, incluindo `Listing`). Se sobrar pendência: `cli:reindex --dead`.
8a. **Ligar a revenda**: só com o programa novo conferido, o servidor no ar, os dados simulados limpos e o reindex feito, ligue
   `resaleEnabled` (como, em `docs/resale.md`) e teste um ciclo anunciar -> comprar -> cancelar com carteiras de teste.
9. **Republicar especialistas se o hash mudou**: `pnpm --filter @solvers/server cli:publish <slug...>` (ou sem
   argumentos, para todos os pacotes em `agents/`), só dos pacotes cujo conteúdo/hash mudou.

## O que muda neste upgrade (governança do admin, revenda e teto de licenças)

- **Revenda de licenças: 3 instruções novas** (`programs/solvers/src/instructions/resale.rs`; visão geral em `docs/resale.md`):
  `list_license(price)` (o dono aprova a PDA `market_authority`, seed `market_authority`, como `TransferDelegate` do asset e a
  plataforma abre o `Listing`), `buy_listing(expected_price)` (paga royalty ao criador, taxa à tesouraria e o resto ao vendedor,
  transfere o asset e fecha o `Listing`) e `cancel_listing` (o vendedor sempre; terceiros só anúncio velho; nunca pausa). Sem
  custódia: a licença fica na carteira do vendedor, que mantém o acesso até a venda.
- **PDA nova `Listing`** (seeds `["listing", asset]`, um por asset, 157 bytes, rent pago pela plataforma e devolvido ao fechar;
  `fee_bps` e `royalty_bps` congelados no anúncio) e a PDA sem dados `market_authority`. Existe só entre o anúncio e a venda ou o
  cancelamento. **Nenhuma conta existente muda de layout** (Config, Agent, License etc. ficam como estão).
- **3 eventos e 9 erros novos da revenda**: `LicenseListed`, `LicenseResold`, `ListingCancelled`; `SelfPurchase` 6051,
  `ListingMismatch` 6052, `ResaleCutTooHigh` 6053, `NotAssetOwner` 6054, `AssetNotInCollection` 6055, `ListingStillValid` 6056,
  `CreatorCannotResell` 6057, `ListingNotAuthorized` 6058, `CancelPayerMismatch` 6059. Os eventos entram no indexador; o `Listing`
  é espelhado numa tabela nova (migration aditiva, sobe com o deploy).
- **Regras que importam na operação**: royalty por convenção (só a venda pelo mercado paga; transferência por fora segue livre,
  sem royalty); teto royalty + taxa de 5000 bps; preço >= `config.min_price`; o criador não revende a própria licença (MVP); compra
  bloqueada para solver suspenso, retirado ou com stake abaixo do mínimo (anunciar e cancelar não dependem do status); a pausa de
  entradas bloqueia anunciar e comprar, nunca cancelar; revenda não incrementa `UserReputation` nem `Agent.total_sales`.
- **Teto de licenças por solver, imposto on-chain** (`programs/solvers/src/instructions/supply.rs`; plano em `docs/licencas-limitadas.md`): `create_supply_cap(max)` (o criador assina, a plataforma paga o rent) e `raise_supply_cap(max)` (só sobe; `u32::MAX` = ilimitado), PDA nova `SupplyCap` (`["supply_cap", agent]`, 45 bytes), evento `SupplyCapSet` e erros `SoldOut` 6060, `SupplyCapTooLow` 6061, `SupplyCapCannotDecrease` 6062. **`purchase_license` ganha uma conta nova** (`supply_cap`, entre `reputation` e `mpl_core_program`; o endereço é imposto pelas seeds, então não dá para omiti-la): sem a conta criada o solver é ilimitado; criada, a compra falha com `SoldOut` quando `Agent.total_sales >= max` (a transação inteira volta, nenhum USDC se move). O contador é `total_sales` (licenças emitidas na vida do solver): revender, transferir ou queimar uma licença não reabre vaga. **Nenhuma conta existente muda de layout.** **Janela de compatibilidade:** entre o upgrade e o deploy do servidor novo (que monta a compra com a conta nova), o servidor ANTIGO não consegue comprar licença (falta a conta); créditos, garantias e revenda seguem. Dê o `git push` logo depois do passo 4a. `.so` com o teto: 932.768 bytes (era 909.888; teto da CI 946.244): ~22,9 KB a mais de extensão (~0,12 SOL, não volta) e buffer ~0,16 SOL maior (devolvível).
- **16 instruções novas (e `slash_stake` removida)**: `propose_admin(new_admin)`, `accept_admin`, `cancel_admin_transfer` (rotação do admin em 2 etapas),
  `set_treasury` (troca a conta de USDC da tesouraria), `top_up_stake(amount)` (o criador repõe stake; reativar o
  solver ainda exige `approve_agent`), `migrate_config` (passo 4a, instrução de transição), `set_pause(flags)` e
  `set_guardian(novo)` (pausa de emergência), mais as 8 do **stake com saída e confisco com prazo**:
  `request_stake_exit`, `cancel_stake_exit`, `withdraw_stake`, `contest_slash` (assinadas pelo **criador**) e
  `extend_stake_exit`, `propose_slash`, `cancel_slash`, `execute_slash` (**admin**). `slash_stake` (confisco imediato) deixa
  de existir: o confisco é propor -> 72 h -> executar. As do criador **existem on-chain mas não entram no `cli:admin`**: o
  criador co-assina pelo site (D2 do `PACKAGE_SPEC.md`).
- **Janela do confisco e saída com extensão**: a proposta só executa de 72 h até 72 h + 14 dias (`SlashExpired` depois); vencida, o
  criador pode fechar a proposta (`cancel_slash`, `SlashNotExpired` antes disso; o admin cancela quando quiser) e então sacar o
  stake. O criador **não consegue cancelar a saída** (`cancel_stake_exit`) enquanto houver extensão do admin (`StakeExitExtended`).
- **Stake com saída** (regras no programa, `instructions/stake.rs`): o criador pede saída (`request_stake_exit`) e o solver vira
  **`Retired`** (status 3, fora da venda); o saque (`withdraw_stake`) só passa **30 dias** depois, sem proposta de confisco
  pendente. O admin pode estender a espera em 30 dias, no máximo **2 vezes** (`extend_stake_exit`, com motivo). Confisco:
  `propose_slash(valor, hash do motivo)` suspende o solver na hora; só `execute_slash` **72 h depois** move o dinheiro
  (para a tesouraria); o criador pode `contest_slash` (só evidência) e o admin pode `cancel_slash`. PDAs novas por solver:
  `StakeExit` (`["stake_exit", agent]`) e `SlashProposal` (`["slash", agent]`), fechadas no fim do ciclo. `min_stake` passa a
  valer em compra, créditos, garantia e `approve_agent`.
- **Config muda de layout (v1 187 B -> v2 285 B)**, só com campos novos no fim: `layout_version`, `pause_flags`,
  `guardian`, `_reserved[64]`. Exige o passo 4a. **PDA nova** `PendingAdmin` (seeds `["pending_admin", config]`,
  73 bytes): só existe entre a proposta e o aceite ou cancelamento; nenhuma outra conta existente muda.
- **Pausa de emergência** (`Config.pause_flags`): bit 1 entradas (`register_agent`, `purchase_license`, `buy_credits`,
  `create_escrow`, `list_license`, `buy_listing`; `cancel_listing` nunca pausa), bit 2 pagamentos (`release_milestone`, `mark_passed`, `resolve_dispute`). Saídas do comprador nunca
  pausam. O admin liga e desliga; o `guardian` só liga. Nasce desligada (`0`) e sem guardian.
- **15 eventos e 17 erros novos** (`NotPendingAdmin` 6034, `InvalidNewAdmin` 6035, `Paused` 6036, `ConfigAlreadyMigrated` 6037,
  `InvalidPauseFlags` 6038, `NotPauseAuthority` 6039, `GuardianCannotUnpause` 6040, `AgentRetired` 6041, `AgentNotRetired` 6042,
  `StakeExitNotReached` 6043, `StakeExitExtensionsExhausted` 6044, `SlashPending` 6045, `SlashDelayNotReached` 6046,
  `SlashAlreadyContested` 6047, `StakeExitExtended` 6048, `SlashExpired` 6049, `SlashNotExpired` 6050; eventos: os 5 de governança, `PauseChanged`, `GuardianChanged` e os 8 de stake/slash). O indexador trata todos: `StakeToppedUp` relê o solver (o stake é espelhado),
  `TreasuryUpdated` limpa o cache da tesouraria, `PauseChanged`/`GuardianChanged`/`SlashProposed`/`SlashExecuted` escrevem `[ALERTA]` no log do servidor
  (e `PauseChanged` zera o cache da pausa); os de saída de stake e `SlashExecuted` relêem o solver; `Retired` é espelhado como
  `retired` (some da vitrine, da compra e do teste grátis; licença vitalícia e garantia aberta continuam servindo); os de admin só ficam registrados.
- **Servidor e pausa**: antes de montar compra (`/tx/purchase`) ou garantia (criar escrow), o servidor lê `pause_flags`
  (cache de 10 s, commitment `confirmed`); com o bit de entradas ligado responde **503** `platform_paused` com
  "Compras pausadas temporariamente". Leitura que falha, Config v1 ou tamanho desconhecido **não bloqueiam**
  (fail-open): o programa recusa com `Paused` e a simulação antes da assinatura devolve a mensagem em português
  como 409. Pagamentos pausados (bit 2) só aparecem pela simulação (409), não por 503.
- **Com a revenda o `.so` final mede 909.888 bytes** (antes dela, 797.496: +112.392 bytes; o teto da CI passou a 946.244; CU
  máximos medidos: `list_license` 55.659 (teto de teste 70.000), `buy_listing` 51.611, `cancel_listing` 31.319; 115 testes). Para o
  ProgramData da devnet, que em 2026-10-01 tinha `Data Length: 726216`, a extensão necessária vai a ~183.672 bytes de crescimento
  (+ margem do script). **Custo em SOL: estimativa, confirmar no dry-run do `upgrade-devnet.sh`.** Só a parte da revenda
  (~112 KB a mais) custa ~0,77 SOL de extensão (não volta) e o buffer do upgrade fica em ~6,3 SOL (devolvíveis ao admin). Há
  divergência entre as taxas: o texto antigo usava 5,08e-6 SOL/byte e o LiteSVM mede 6.960 lamports/byte (~6,96e-6 SOL/byte); as
  estimativas desta linha usam a do LiteSVM e, com a taxa antiga, saem ~27% menores. Vale o número que o dry-run imprimir, que lê o
  `solana rent` da própria rede. Os cálculos do item seguinte são do `.so` de 797.496 bytes (sem a revenda) e ficam como histórico
  da conta do script.
- **Antes da revenda: o `.so` cresce de 715.664 para 797.496 bytes (+81.832)** (o `.so` com Config v2, pausa, guardian e stake com
  saída, já com a otimização de tamanho abaixo; `ls -l target/deploy/solvers.so`). Em 2026-10-01 o `solana program show` da devnet
  mostrava `Data Length: 726216`, então o ProgramData **não** comporta o novo e a extensão é obrigatória. Conta (a regra do
  script: crescimento + 1.024 de margem, arredondado para cima a blocos de 10.240; 5,08e-6 SOL por byte):
  - crescimento = 797.496 - 726.216 = **71.280** bytes; + 1.024 = 72.304; / 10.240 = 7,06 -> **8 blocos = 81.920 bytes**;
  - extensão = 81.920 x 5,08e-6 = **~0,416 SOL** (não volta);
  - buffer do upgrade = (797.496 + 37) x 5,08e-6 = **~4,052 SOL** (volta ao admin ao final);
  - necessário no admin = 4,052 + 0,416 + 0,05 de margem = **~4,52 SOL** (a linha "Hoje" dos pré-requisitos, ~3,83, era para
    o `.so` de 715.664 bytes). Com o admin em ~3,70 SOL faltam ~0,82 e o script transfere ~0,9 do fee-payer (arredondado a
    0,1), que fica com ~3,3 se hoje tiver ~4,2, acima da reserva de 1 SOL. Some ~0,0007 SOL da migração da Config (pago pelo
    fee-payer). Estimativa: o saldo do admin e o `Data Length` mudam, então confira antes e use o dry-run do passo 2, que
    imprime os números reais. (Sem a otimização o `.so` seria de 904.576 bytes e a extensão de ~0,94 SOL.)
- **Tamanho do `.so` (otimização do build)**: `opt-level = 2` no `[profile.release]` do `Cargo.toml`, a feature `no-log-ix-name`
  ligada por padrão em `programs/solvers/Cargo.toml` e `-C llvm-args=-inline-threshold=100` em `.cargo/config.toml`
  (`[target.sbpfv1-solana-solana]`, vale **só** para `anchor build --arch v1`, o que `build-program.sh` e `program.yml`
  usam; sem o arquivo o `.so` mede 880.912). O CU de cada instrução ficou entre -1,2% e +1,0% do anterior. O passo "Tamanho do
  `.so` dentro do teto" do `program.yml` falha acima de 946.244 bytes (909.888 + 4%, com a revenda; era 829.396 sobre 797.496). **Efeito visível:** o log `Program log: Instruction: X`
  deixa de existir, então os explorers (Solscan, Solana Explorer) mostram a transação sem o nome da instrução (o IDL
  e os eventos seguem iguais). O build verificável (Docker, mainnet-runbook seção 3) precisa usar o mesmo `.cargo/config.toml`
  (copiado para dentro da imagem) para reproduzir o tamanho; **não verificado**.
- **Sequência final (a ordem que vale)**: **build** (`build-program.sh`) -> **dry-run** (`upgrade-devnet.sh`) -> **upgrade**
  (`upgrade-devnet.sh --yes`) -> **`migrate-config`** (passo 4a, dry-run e `--yes`) -> **conferir** (Config com **285 bytes**,
  `layoutVersion` 2, e as outras contas do passo 5) -> **push do servidor** (migration + servidor + web, com
  `resaleEnabled=false`) -> **limpar os dados simulados da revenda** (passo 7a, com confirmação do dono) ->
  **`cli:reindex --backfill`** (passo 8) -> **ligar `resaleEnabled`** (passo 8a).
- **Ordem**: a sequência final acima, e o push do servidor só no fim do programa. O servidor
  novo conhece os eventos, mas não depende deles para funcionar; já o programa novo com servidor antigo só deixa os
  eventos novos sem tratamento (o parser ignora discriminador desconhecido), sem derrubar o indexador. **Programa novo com
  servidor antigo é seguro para a revenda**: o servidor antigo não monta `list_license`/`buy_listing`, então ninguém anuncia
  e nada fica pendurado.

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
# migração da Config v1 -> v2 (passo 4a): assina a UPGRADE AUTHORITY (na devnet, a chave do admin) com --keypair
pnpm --filter @solvers/server cli:admin:devnet migrate-config --keypair <upgrade-authority.json> [--yes]
# pausa de emergência: none | entradas | pagamentos | tudo (ou 0 a 3). Admin liga e desliga; o guardian (--keypair) só liga
pnpm --filter @solvers/server cli:admin:devnet set-pause <none|entradas|pagamentos|tudo> [--keypair <guardian.json>] [--yes]
# guardian da pausa (só o admin): endereço, ou none para remover
pnpm --filter @solvers/server cli:admin:devnet set-guardian <endereço|none> [--yes]
# confisco (admin): propor -> esperar 72 h -> executar. reason_hash = sha256 do texto do motivo (o comando imprime o hash)
pnpm --filter @solvers/server cli:admin:devnet propose-slash <slug> <usdc> "<motivo>" [--yes]
pnpm --filter @solvers/server cli:admin:devnet execute-slash <slug> [--yes]     # o dry-run mostra quanto falta para as 72 h
pnpm --filter @solvers/server cli:admin:devnet cancel-slash <slug> [--yes]
# saída de stake (admin): +30 dias na espera do saque, no máximo 2 vezes
pnpm --filter @solvers/server cli:admin:devnet extend-stake-exit <slug> "<motivo>" [--yes]
```
`migrate-config` confere a chave contra a upgrade authority lida no ProgramData e recusa Config que já é v2, ausente ou de
tamanho inesperado. `set-pause` descobre se a chave é do admin ou do guardian e recusa, antes de enviar, o guardian que tentar
soltar um bit. Os dois lêem a Config e simulam no dry-run (a migração lê a conta crua, sem decodificar). `execute-slash --yes` recusa antes
de enviar se as 72 h não passaram e avisa quando o criador contestou. Guarde o texto do motivo: só o hash vai on-chain.
Os comandos do **criador** (`request_stake_exit`, `cancel_stake_exit`, `withdraw_stake`, `contest_slash`) existem no
programa e no cliente, mas **não** estão no CLI: ele co-assina pelo site (D2).

Depois do `accept`, a chave antiga deixa de ser admin: troque `ADMIN_KEYPAIR` do servidor (se ele usa admin) pela nova.
Se o criador reabastecer um solver suspenso, o admin ainda precisa aprovar de novo (`approve_agent`).

## O escrow de teste antigo

`CY8GP4eM25jL7ofX4oEfedoCVh3BHtP4oHucmwWKvTzd` (740 bytes, layout v1) é o único dos 53 que já não decodifica com
o cliente novo. Seu vault (`6X4jVobkddmdFUKbXxM1ZSgSBW9J8KYG31SqAdGkWo1S`) guarda **19 USDC de teste**. O
programa novo não consegue operar esse escrow, então esse USDC fica preso no vault para sempre: sem valor (USDC
de teste da devnet). Não tente liberá-lo; basta retirá-lo do banco (passo 7).

## Janela de incompatibilidade servidor x programa

- Programa novo + Config ainda v1 (entre os passos 4 e 4a): toda instrução que lê a Config falha, e o servidor novo
  (decoder v2) não lê a Config. Só existe até o `migrate-config`; não dê push antes.
- Programa novo + servidor antigo (entre os passos 4a e 6): só impede criar garantias; compras, licenças,
  leituras e o resto seguem funcionando. Se o indexador registrar falhas, o `cli:reindex --dead` do passo 8 recupera.
- Programa novo + servidor antigo, no que toca à revenda: seguro. As instruções novas só existem se alguém as monta (o servidor
  antigo não monta), e os eventos novos são ignorados pelo parser.
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
layout novo ficam ilegíveis para o programa antigo; o rollback só é limpo se ninguém os criou. A Config v2 (285 bytes)
é o v1 mais 98 bytes no fim, e o programa antigo a lê (teste `config_v2_is_the_v1_prefix_and_v1_readers_still_decode_it`
em `programs/solvers/tests/program.rs`; não rodei esse teste nesta sessão), então o rollback do binário não exige
desmigrar. O que o rollback perde: a pausa e o guardian (o binário antigo ignora `pause_flags`).

**AVISO: depois do primeiro pedido de saída de stake não dá mais para voltar ao `.so` anterior.** O pedido grava o status
`Retired` (valor 3) no Agent, e o binário antigo **não decodifica** um Agent com esse valor (o enum dele só tem 0 a 2): o
solver (e toda instrução que o lê) passa a falhar. Até o primeiro `request_stake_exit` o rollback é limpo; depois, só
corrigindo para a frente (novo upgrade). Combine com os criadores antes de liberar o site para o pedido de saída.

**NOTA DE ROLLBACK DA REVENDA: depois do primeiro anúncio, voltar ao `.so` antigo deixa assets com delegate pendurado.** Cada
anúncio põe a PDA `market_authority` como `TransferDelegate` no asset da licença; o binário antigo não conhece essa PDA nem o
`Listing`, então ninguém mais cancela ou compra, e o delegate continua no asset. Não é perda de fundos (a licença segue com o
vendedor, a PDA só transfere com o programa novo e a authority volta a `Owner` após qualquer transferência), e o **vendedor
revoga o delegate pela própria carteira** direto no mpl-core. O `Listing` fica preso como conta do programa (sem o
`cancel_listing` para fechá-lo; o rent da plataforma só volta com um upgrade para a frente). Antes do primeiro anúncio o
rollback é limpo; depois, prefira corrigir para a frente e, se for preciso voltar, desligue `resaleEnabled` primeiro. O contrário
(programa novo com servidor antigo) é seguro. A migration da revenda é aditiva: com `resaleEnabled=false` as tabelas ficam, sem uso.

## Se algo falhar no meio

- O script mostra o que falhou e não reverte sozinho. Confira `solana program show <program id> --url devnet`.
- Upgrade interrompido deixa um buffer com SOL preso: `solana program show --buffers --buffer-authority <admin> --url devnet`
  lista; `solana program close --buffers --keypair ~/solvers-keys/admin.json --url devnet` recupera. O dry-run
  seguinte também avisa se houver buffers antigos.

# Runbook de lançamento na mainnet

Decisões do dono (2026-10-01): admin on-chain em **carteira fria** até a Abertura (depois, vault 1 do Squads); upgrade authority no **Squads v4 (2 de 3)**; programa com **keypair novo** (outro `declare_id!`) e **Config v2 nascendo pronto**; o servidor **nunca** assina como admin, upgrade authority ou guardian. Contexto e alternativas: `docs/design-governance-v2.md` §3, §4 e §5. Procedimento da devnet: `docs/devnet-upgrade.md`.

Legenda: **[existe]** já está no repositório; **[a criar]** falta código (outro agente ou tarefa futura); **[não verificado]** não foi possível confirmar em 2026-10-01.

## Papéis e chaves

| Chave | Onde vive | Quem assina |
|---|---|---|
| Keypair do programa (`declare_id!`) | offline, 2 backups em locais distintos; só é usada no deploy inicial | dono |
| Chave de **deploy** | arquivo em máquina do dono (não na VPS); descartável, só com SOL para taxas/buffer. **Separada do admin.** | dono, via script |
| Upgrade authority | vault 0 do Squads v4 (2-de-3: chaves em carteiras distintas; composição mantida em privado) | proposta no Squads |
| Admin on-chain | carteira fria até a Abertura; depois vault 1 do mesmo Squads (`propose_admin`) | dono, de fora do servidor |
| Guardian (só liga a pausa) | dispositivo separado do dono | dono |
| Fee payer, verifier, usage authority | `.env` da VPS (`FEE_PAYER_KEYPAIR`, `VERIFIER_KEYPAIR`, `USAGE_AUTHORITY_KEYPAIR`) | **servidor** |

**O servidor assina só:** fee payer (taxas e rent; não autoriza movimento de fundos), verifier e usage authority.
**O servidor nunca assina:** upgrade authority, admin, guardian, keypair do programa, chave de deploy, dono da tesouraria, chaves de criador/comprador.
Trava no código: `apps/server/src/env.ts` recusa o boot com `SOLANA_CLUSTER=mainnet-beta` se `ADMIN_KEYPAIR`, `GUARDIAN_KEYPAIR` ou `UPGRADE_AUTHORITY_KEYPAIR` estiverem definidas (teste: `apps/server/test/env-mainnet.test.ts`). Consequência: com a mainnet, `cli:publish` não aprova solver sozinho (ele lê `admin` do `.env`, `apps/server/src/cli/publish.ts:150`); aprovar vira passo do admin frio. Comando de aprovação para a mainnet: **[a criar]** (`cli:admin approve`).

## Checklist, na ordem

### 1. Preparar (nada on-chain)
1. **Keypair novo do programa**, em máquina offline: `solana-keygen new --outfile program-mainnet.json` (frase de passe se possível). Anote o endereço: é o novo `declare_id!`. Backup em 2 locais; sem esta chave não há deploy inicial (depois dele ela deixa de ser necessária).
2. **Chave de deploy**: `solana-keygen new --outfile deploy-mainnet.json` (nome sem "admin"; o script recusa). Envie SOL de uma carteira sua: buffer (~4,05 SOL para o `.so` de 797.496 bytes, volta ao reembolso) + rent do programa no deploy inicial + margem. O dry-run do script imprime o valor exato.
3. **Squad**: criar o Squads v4 (2-de-3) e anotar o **endereço do vault 0** (é ele, não o endereço do Squad/multisig, a upgrade authority). Cada membro confere o endereço pelo próprio painel.
4. **Carteira fria do admin** e **dispositivo do guardian**: só os endereços públicos entram nos comandos abaixo.
5. **Mint de USDC da mainnet**: confira o endereço na documentação oficial da Circle antes de pôr em `USDC_MINT` (o endereço público conhecido é `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; **[não verificado]** contra a fonte oficial nesta sessão).
6. **Trocar o `declare_id!`** (ver "O que muda com o novo declare_id!") e fechar tudo numa branch/commit do lançamento.

### 2. Ensaio na devnet com um Squad de teste (antes de gastar SOL real)
1. Programa descartável na devnet (keypair novo, `solana program deploy ... --url devnet`; pode ser o mesmo `.so`: o ensaio é da mecânica de upgrade, não do programa).
2. Squad de teste na devnet (3 chaves de teste) e `solana program set-upgrade-authority <programa> --new-upgrade-authority <vault-teste> --skip-new-upgrade-authority-signer-check` com a chave de deploy de teste.
3. `bash scripts/chain/upgrade-mainnet-buffer.sh --rehearsal-devnet --squad-vault <vault-teste> --program-id <programa-teste> --deploy-key <deploy-teste.json>` (dry-run, depois `--yes`). O ensaio usa o genesis hash da devnet.
4. Criar, aprovar (2 de 3) e executar a proposta de upgrade no Squads com o buffer; conferir `solana program show` (Last Deployed Slot mudou) e o hash do dump. Anote os nomes reais dos menus do Squads e corrija o passo 4 de "Upgrade de rotina" abaixo (nomes de menu **[não verificado]**).
5. Ensaio de `extend`: `.so` maior que o ProgramData, `solana program extend` pela chave de deploy, depois a proposta.
Só siga para a mainnet com o ensaio completo funcionando.

### 3. Build verificável (Docker)
Meta: o `.so` do deploy sai de build determinístico, e outra pessoa/máquina reproduz o mesmo sha256.
- O CLI do WSL (anchor 1.2.0, conferido) tem `anchor build --verifiable [--docker-image <img>] [--solana-version <v>]`. Pelo binário, a imagem padrão parece ser `solanafoundation/anchor:v<versão do anchor>` (inferido, **[não verificado]**).
- **Não confirmado e possivelmente impeditivo:** no Docker Hub (`docker manifest inspect`, 2026-10-01) **não existe** `solanafoundation/anchor:v1.2.0` nem `:v1.1.0`; as tags públicas são `v0.32.0`, `v0.32.1`, `v1.0.0-rc.3..5`, `v1.0.0`, `v1.0.1`, `v1.0.2` e `latest`. Não sei qual versão do Solana essas imagens trazem (precisaria baixar a imagem) nem se reproduzem o `.so` do toolchain pinado (Solana 3.0.0, `--arch v1`).
- Existe `solanafoundation/solana-verifiable-build:3.0.0` (manifest ok), a imagem usada pelo `solana-verify build`. **`solana-verify` não está instalado** no WSL, e não conferi se instala (`cargo install solana-verify`) nem se aceita o nosso `--arch v1`.
- **Decisão pendente do dono/devops:** (a) `anchor build --verifiable --docker-image solanafoundation/anchor:v1.0.2 --solana-version 3.0.0`, ou (b) `solana-verify build` com a imagem 3.0.0. Escolha uma, rode no ensaio, builde **duas vezes em máquinas diferentes** e compare o sha256. Se nenhuma reproduzir, a alternativa honesta é publicar o hash do `.so` e o commit, sem selo de "verificado".
- O `.so` da devnet saiu de build **fora do Docker**: não serve de referência de hash.
- O tamanho do `.so` depende de `.cargo/config.toml` (`-inline-threshold=100`, só para `--arch v1`), de `opt-level = 2` e da feature `no-log-ix-name` (sem o log `Instruction: X` nos explorers). Um build verificável em Docker precisa enxergar o mesmo `.cargo/config.toml`, senão o hash e o tamanho (hoje 797.496 bytes; o CI falha acima de 829.396) mudam. **[não verificado]** com `solana-verify`/`anchor build --verifiable`.
- Por isso o job `verifiable-build` **não foi** adicionado ao `.github/workflows/program.yml` (não consegui justificar que a imagem para Anchor 1.2.0 existe). Quando a decisão acima for tomada, acrescentar o job `continue-on-error: true` com a imagem escolhida.

### 4. Deploy inicial
Ordem obrigatória, numa sentada só. **Motivo:** `initialize_config` exige que o `admin` que assina seja a upgrade authority do programa naquele momento (`programs/solvers/src/instructions/admin.rs`, `InitializeConfig`, `program_data.upgrade_authority_address == Some(admin.key())`). Por isso a chave de deploy é, por poucos minutos, upgrade authority e admin; o Squads só assume depois.

1. Dry-run de custos: `solana rent <tamanho do .so + 45> --lamports --url <rpc>` e saldo da chave de deploy.
2. Deploy (chave de deploy como autoridade provisória):
   `solana program deploy <solvers.so> --program-id program-mainnet.json --keypair deploy-mainnet.json --upgrade-authority deploy-mainnet.json --with-compute-unit-price 1000 --url <rpc-mainnet>`
   Opcional: `--max-len` com folga para crescer sem `extend` (o rent dos bytes extras não volta).
3. `solana program show <programa> --url <rpc>`: conferir `Authority` = chave de deploy e Data Length.
4. **`initialize_config` v2** assinada pela chave de deploy (admin provisório), com `verifier` e `usage_authority` = endereços públicos das chaves do servidor, `fee_bps`, `min_stake`, `min_price` e a **tesouraria** = ATA de USDC de um dono seu (não do servidor). Comando para a mainnet: **[a criar]** (`scripts/src/bootstrap-chain.ts` NÃO serve: cria mint de teste e transfere SOL do fee payer). Montador existente: `SolversChain.initializeConfigIxs` em `packages/chain/src/chain.ts`.
5. `propose_admin(<carteira fria>)` pela chave de deploy e `accept_admin` pela carteira fria: `cli:admin propose <fria> --keypair deploy-mainnet.json --allow-network mainnet-beta --yes`, depois `cli:admin accept --keypair <fria.json> --allow-network mainnet-beta --yes` **[existe]** (o `cli:admin` só roda na devnet sem `--allow-network`; rode sem `--yes` antes e confira). Confirme `Config.admin` lendo a conta.
6. `set_guardian(<guardian>)` pelo admin frio: `cli:admin set-guardian <guardian> --keypair <fria.json> --allow-network mainnet-beta --yes` **[existe]** (rode sem `--yes` antes e confira o guardian atual e quem assina). Para remover: `set-guardian none`. Confirme lendo a Config (`guardian`).
   Não há `migrate-config` na mainnet: o `initialize_config` do passo 4 já cria a Config **v2** (285 bytes, `layout_version = 2`, sem pausa, sem guardian). Confira o tamanho da conta Config (285) antes de seguir; `cli:admin migrate-config` recusa uma Config v2.
7. **`solana program set-upgrade-authority <programa> --new-upgrade-authority <vault 0> --skip-new-upgrade-authority-signer-check --keypair deploy-mainnet.json --url <rpc>`**. O vault é uma PDA que não assina, por isso o `--skip-...`: **endereço errado é irrecuperável** (o programa fica sem upgrade para sempre). Dupla conferência obrigatória: (a) cada membro compara o endereço do vault no painel do Squads, caractere a caractere, com o do comando; (b) rode primeiro o ensaio da devnet com o mesmo procedimento; (c) depois execute, e confira com `solana program show <programa>`: `Authority` = vault.
8. Teste de fumaça do fluxo de upgrade já na mainnet: `upgrade-mainnet-buffer.sh` (dry-run) com o vault e o programa reais deve passar na checagem "authority on-chain = vault".
9. **Apague/guarde offline** `program-mainnet.json` e zere o saldo da chave de deploy (devolva o SOL).

### 5. Servidor e cliente
Só depois do passo 4. Mudanças em "O que muda com o novo declare_id!". `.env` da mainnet (segue `VPS_GUIDE.md`: projeto `solvers`, `solvers-api` porta 3017, sem mexer em nginx):
`SOLANA_CLUSTER=mainnet-beta`, `SOLANA_RPC_URL` (provedor próprio, com segundo provedor de reserva), `USDC_MINT`, `FAUCET_ENABLED=false` (`infra/setup-vps.sh` cria o `.env` com `true`; a mainnet **não** recusa isso no código), `MP_TEST_MODE=false`, `PIX_SIMULATE` (forçado a `false` na mainnet por `env.ts`), **sem** `ADMIN_KEYPAIR`.
Não dê push na `master` antes de o programa estar implantado e conferido (mesma regra de `docs/devnet-upgrade.md`).

### 6. Rotação e operação do admin (carteira fria)
- **Admin**: `cli:admin propose|accept|cancel` **[existe]**. Na Abertura: `propose_admin(<vault 1 do Squads>)`; o `accept_admin` precisa ser executado como proposta do Squads.
- **Tesouraria**: `cli:admin set-treasury <conta-usdc>` **[existe]**.
- **Verifier / usage authority**: instrução `update_config` (assina o admin, `UpdateConfig` em `admin.rs`). Não há comando em `cli:admin`: **[a criar]** (`cli:admin update-config`). Atenção: `update_config` regrava todos os campos; leia a Config antes.
- **Upgrade authority**: `set-upgrade-authority` da seção 4, passo 7, ou proposta no Squads.
- Troque a chave do servidor correspondente em `.env` e reinicie `solvers-api` (PM2) logo depois de rotacionar verifier/usage.

## Upgrade de rotina (depois do lançamento)
Nunca com a upgrade authority no servidor nem na máquina de deploy.
1. Build verificável (seção 3); anote o sha256 do `.so`.
2. `bash scripts/chain/upgrade-mainnet-buffer.sh --squad-vault <vault 0> --program-id <programa> --deploy-key deploy-mainnet.json` (dry-run: confere genesis hash da mainnet, que o programa existe e que a authority on-chain é o vault informado, binário não mais velho que `programs/solvers/src`, saldo da chave de deploy). Revise e rode de novo com `--yes`: `write-buffer` com a chave de deploy, `set-buffer-authority` para o vault, confere autoridade e conteúdo do buffer e imprime o hash.
3. Se o `.so` cresceu, o script imprime o `solana program extend` (não exige a authority; paga a chave de deploy). Rode antes da proposta.
4. No Squads (vault 0): proposta de upgrade do programa com o buffer e reembolso para endereço seu. Os outros membros conferem programa, buffer e que o hash do buffer = hash do build verificável, e aprovam (2 de 3). Executar.
5. Conferir: `Last Deployed Slot` mudou e `solana program dump` tem o sha256 esperado. Se o `.so` mudou a Config ou o IDL: regenerar o cliente (`scripts/chain/build-program.sh`) e fazer o deploy do servidor **depois**.
Genesis hash da mainnet usado no script: `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, conferido na página oficial da Anza (`docs.anza.xyz/clusters/available`, "Genesis Hashes"). `solana-verify` ausente: o script usa dump + sha256.

## Confisco e saída de stake (regras e comandos)
Regras do programa (`programs/solvers/src/instructions/stake.rs`, `state.rs`):
- **Saída do criador: 30 dias.** `request_stake_exit` deixa o solver `Retired` (fora da venda); `withdraw_stake` só depois do prazo e **sem proposta de confisco pendente**. O criador pode desistir (`cancel_stake_exit`, volta a suspenso, nunca ativo). Esses 4 comandos do criador (`request_stake_exit`, `cancel_stake_exit`, `withdraw_stake`, `contest_slash`) existem **on-chain**, mas ficam fora do `cli:admin`: o criador co-assina pelo site (D2).
- **Extensão da espera: +30 dias, no máximo 2 vezes** (`extend_stake_exit`, só o admin, com motivo). Serve para dar tempo de apurar uma disputa; terceira tentativa = `StakeExitExtensionsExhausted`.
- **Confisco: propor -> 72 h -> executar.** `propose_slash` (admin) suspende o solver na hora e só `execute_slash` **72 h depois** move o dinheiro (para a tesouraria, no máximo o saldo do cofre). Uma proposta por solver; o criador pode `contest_slash` (só evidência, uma vez) e o admin pode `cancel_slash`. O confisco imediato (`slash_stake`) foi removido.
- **Janela do confisco:** a proposta executa de 72 h até 72 h + 14 dias (`SlashExpired` depois). Vencida, o criador pode fechar a proposta (`cancel_slash` pelo site; antes disso `SlashNotExpired`, só o admin cancela) e sacar o stake: proposta esquecida não prende o stake para sempre. O `execute-slash --yes` do CLI recusa proposta vencida.
- **Extensão trava o cancelamento:** enquanto houver extensão do admin, o criador não consegue cancelar a saída (`StakeExitExtended`).
- Nenhuma delas respeita a pausa (são saídas e controles).
Comandos (admin frio; na mainnet todos com `--keypair <fria.json> --allow-network mainnet-beta`, sem `--yes` é dry-run) **[existem]**:
`cli:admin propose-slash <slug> <usdc> "<motivo>" --yes` (imprime o `reason_hash` = sha256 do motivo; guarde o texto), `cli:admin execute-slash <slug> --yes` (o dry-run diz quanto falta para as 72 h e se o criador contestou), `cli:admin cancel-slash <slug> --yes`, `cli:admin extend-stake-exit <slug> "<motivo>" --yes`.
Depois de `propose_slash`/`execute_slash` o indexador escreve `[ALERTA]` no log (sem alerta ativo ainda); o solver confiscado volta à venda só com `approve_agent` e stake >= `min_stake` (`top_up_stake`).

## Pausa de emergência
Desenho: `docs/design-governance-v2.md` §3 (`Config.pause_flags`: bit0 entradas, bit1 pagamentos; saídas do comprador nunca pausam; o guardian só liga, o admin liga e desliga). Instruções `set_pause` e `set_guardian` em `programs/solvers/src/lib.rs`; comandos de CLI **[existem]**: `cli:admin set-pause` e `cli:admin set-guardian` (`apps/server/src/cli/admin.ts`). Na mainnet todos levam `--keypair <arquivo> --allow-network mainnet-beta`; sem `--yes` é dry-run (imprime a pausa atual, quem assina e a simulação). O servidor da VPS não tem essas chaves.
1. **Decidir**: fundos em risco, bug em instrução de pagamento, chave comprometida? Na dúvida, pause entradas (bit0).
2. **Pausar** com a chave do guardian (dispositivo separado) ou do admin: `cli:admin set-pause entradas|pagamentos|tudo --keypair <guardian.json> --allow-network mainnet-beta --yes` **[existe]**. O guardian só liga bits; ligar mais um bit (ex.: de `entradas` para `tudo`) passa, soltar qualquer um é recusado antes de enviar (e pelo programa, `GuardianCannotUnpause`).
3. **Conferir** lendo a Config (`pause_flags`: 1 entradas, 2 pagamentos, 3 tudo) e testando que uma compra nova é recusada. O servidor responde **503** "Compras pausadas temporariamente" em `/tx/purchase` e na criação de garantia em até ~10 s (cache) ou na hora, quando o indexador vê `PauseChanged`; se ele não conseguir ler a Config, deixa passar (fail-open) e a simulação devolve o erro `Paused` em português ("Esta operação está temporariamente pausada por segurança...", `packages/chain/src/program-errors.ts`) como 409. O indexador escreve `[ALERTA] pausa alterada por ...` no log (`pm2 logs solvers-api`).
4. Avisar usuários (status da plataforma), investigar, corrigir. Bug numa **saída** do comprador só se corrige com upgrade (Squads).
5. **Retomar**: só o admin (carteira fria) desliga: `cli:admin set-pause none --keypair <fria.json> --allow-network mainnet-beta --yes` **[existe]**. Registrar o motivo.
6. Se a chave do guardian vazar: o admin troca com `cli:admin set-guardian <novo|none>`. Se a do admin vazar: `propose_admin` não ajuda (o atacante também é admin); pause pelo guardian e fale com o Squads (upgrade authority) para corrigir por upgrade.

## Alertas necessários (nenhum existe hoje)
Hoje há só o log "DESISTIU" de assinatura `dead` e `/health` que testa o banco (`.agents/skills/solana-backend-ts/SKILL.md`).
1. **Mudança de upgrade authority ou upgrade do programa**: vigiar a conta ProgramData do programa; alertar se a authority != vault 0 ou se `Last Deployed Slot` mudar sem proposta do Squads aprovada. Prioridade máxima.
2. **`ConfigUpdated`, `AdminTransfer*`, `TreasuryUpdated` e os eventos de pausa**: o indexador só os registra (`apps/server/src/indexer/processor.ts`); `PauseChanged` e `GuardianChanged` já escrevem uma linha `[ALERTA]` no log, mas **não há alerta ativo** (ninguém é avisado). Qualquer ocorrência fora de janela de manutenção deve virar alerta.
3. **Atraso do indexador**: (slot da ponta − último slot processado) acima de um limite, e `indexer_failures` em estado `dead`.
4. **Saldo do fee payer** (`FEE_PAYER_KEYPAIR`): alerta abaixo de um piso em SOL; sem saldo o servidor não paga rent nem taxas.
5. Saldo da chave de deploy não precisa de alerta (fica zerada fora do upgrade); o Squads deve ter notificação de propostas para os 3 membros.

## O que muda com o novo declare_id!
O endereço do programa está **compilado** no cliente gerado, não em variável de ambiente (`packages/chain/src/chain.ts:50`, `PROGRAM_ID = gen.SOLVERS_PROGRAM_ADDRESS`). Um build de servidor fala com um programa só.
- `programs/solvers/src/lib.rs:10` `declare_id!(...)`.
- `Anchor.toml`: `[programs.localnet]`, `[programs.devnet]`; acrescentar `[programs.mainnet]`; o `[provider]` aponta para `~/.config/solana/solvers-admin.json` e cluster `devnet`: ajuste para os comandos de mainnet do runbook (não rode `anchor deploy` com ele).
- Rebuild (`scripts/chain/build-program.sh`) para regenerar `target/idl/solvers.json`, copiado para `packages/solvers-client/idl/solvers.json`, e `pnpm --filter @solvers/client generate` (arquivos em `packages/solvers-client/src/generated/`, inclusive `programs/solvers.ts` e todos os `pdas/*`). O CI (`.github/workflows/program.yml`) falha se o IDL/cliente versionado não bater.
- `scripts/chain/local-validator.sh` e `scripts/src/e2e-v2.ts` têm o endereço da devnet fixo (`--upgradeable-program DW6U...`): atualize se for usar o novo id localmente.
- `docs/devnet-upgrade.md` e `NEXT_STEPS.md` citam o programa da devnet: ficam como estão (a devnet continua com o id antigo).
- **Conflito a decidir:** como o id é compilado, trocar o `declare_id!` na `master` quebra a devnet atual (servidor da VPS aponta para o programa novo, que não existe lá). Opções: branch de lançamento (`mainnet`) com o id novo e deploy só dela; ou tornar o id selecionável no cliente por build/ambiente **[a criar]**. Escolha antes de dar push.
- Servidor/env: nada de `SOLVERS_PROGRAM_ID` no `env.ts` hoje; só `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `USDC_MINT`. Os dados da devnet (PG `solvers`) não migram: use banco novo (ou limpe) para a mainnet, e reindexe com `cli:reindex --backfill`.
- Procure o id antigo antes de publicar: `grep -rn DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW --exclude-dir=node_modules --exclude-dir=target .`

## Pendências deste runbook
Build verificável decidido e reproduzido (seção 3); job `verifiable-build` no CI; comandos `cli:admin` para `initialize_config` na mainnet, `update-config` e `approve` (pausa, guardian e migração já existem); alertas da seção anterior; decisão sobre o conflito do `declare_id!` com a devnet; nomes dos menus do Squads; ensaio completo na devnet.

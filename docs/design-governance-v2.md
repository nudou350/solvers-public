# Governança v2: o que ficou de fora

Fora daqui (outro agente): `propose/accept/cancel_admin`, `set_treasury`, `top_up_stake`. Só proposta, sem código.

**Conferido no código:** o cofre `[stake, agent]` só se move por `slash_stake`. `Escrow` guarda `agent`, mas `Agent` não conta escrows nem disputas, e `resolve_dispute` paga do cofre do escrow: a stake não garante escrow nenhum. Config na devnet tem 187 bytes e `Account<Config>` numa conta curta falha com `AccountDidNotDeserialize` (anchor-attribute-account 1.2.0, `lib.rs:284`). O `resize` zera bytes novos (solana-account-info 3.1.1).

## 1. `withdraw_stake` (sem mudar layout existente)

Conta nova `StakeLock` `[b"stake_lock", agent]` (`exit_at`, `slash_amount`, `slash_reason_hash`, `slash_at`, `bump`; 97 B).

| Instrução | Regra |
|---|---|
| `request_stake_exit` (criador) | `status` vira `Retired`, variante nova no fim do enum (a verificar: decodifica Agent antigo). Os `== Active` atuais já barram venda e escrow, sem conta extra |
| `withdraw_stake` (criador) | `Retired`, `now >= exit_at + 97 dias`, sem slash pendente; paga `vault.amount` a `agent.creator_usdc`, zera `stake`, fecha cofre e lock |
| `cancel_stake_exit` | volta a `Suspended`, nunca `Active` |

`approve_agent` recusa `Retired`; o admin pode confiscar durante a espera. 97 dias = entrega máxima 60 + revisão máxima 30 + SLA 7.

**Limite honesto:** sem layout novo não se prova "nenhuma disputa aberta"; etapa entregue e contestada só sai pelo admin, sem prazo. Mitigação: `extend_stake_exit` do admin (máx. 2 × 30 dias, com evento). O contador `Agent.open_escrows` exigiria realocar os Agents e passar `agent` a `cancel_undelivered` e `resolve_stale_dispute` (IDL muda em 3 instruções); não vale, pois a stake não cobre escrow.

## 2. `slash_stake`

Hoje: admin, qualquer valor, imediato, sempre suspende, destino tesouraria, evento sem motivo, sem teste.

Proposta: `propose_slash(amount, reason_hash)` e `execute_slash` após 72 h, no mesmo `StakeLock` (um caso por agente). Propor já suspende. Eventos `StakeSlashProposed`/`StakeSlashExecuted`; ajustar `DECODERS` em `packages/chain/src/events.ts`. Remover o `slash_stake` direto, senão o prazo é decorativo (nenhum cliente TS o usa).

- **Teto por evento:** não recomendo; N eventos o contornam. A defesa é prazo + multisig.
- **Recurso:** `contest_slash(reason_hash)` só registra evidência; o admin decide.
- **Destino:** tesouraria. Indenizar comprador on-chain fica fora do v2.

**P6 (`min_stake > 0`):** slash parcial deixa `stake < min_stake` e `approve_agent` recusa até o `top_up_stake`. Os 6 Agents da devnet têm stake 0. Exigir `agent.stake >= config.min_stake` em `purchase_license`, `buy_credits` e `create_escrow` não precisa de conta nem layout novo (já leem Agent e Config), mas só após `top_up_stake` existir.

## 3. Pausa de emergência

| Opção | Custo |
|---|---|
| A. `Config.pause_flags` | 0 contas extras: `register_agent`, `purchase_license`, `buy_credits`, `create_escrow`, `mark_passed`, `release_milestone`, `resolve_dispute` já leem Config. IDL das instruções intacto |
| B. PDA `[b"pause"]` | +1 conta em cada instrução bloqueada: IDL, cliente, servidor e tx mudam; "inexistente = livre" pede checagem manual |

**Recomendo A.** Bit0 entradas (`register_agent`, `purchase_license`, `buy_credits`, `create_escrow`); bit1 pagamentos (`release_milestone`, `mark_passed`, `resolve_dispute`). Saídas do comprador nunca pausam (`cancel_undelivered`, `resolve_stale_dispute`, `close_escrow`, `open_dispute` já não leem Config). `set_pause`: `guardian` só liga; admin liga e desliga. Bug numa saída só se corrige com upgrade.

## 4. Migração do Config

**v2 = v1 (179 B) + `layout_version: u8`, `pause_flags: u8`, `guardian: Pubkey`, `_reserved: [u8; 64]`** = 285 B. Rent extra ~0,0007 SOL (a verificar). O futuro consome `_reserved`.

`migrate_config`: `authority` (= `upgrade_authority_address`, como `initialize_config`; vale com o Squads), `payer` (servidor), `config` como `UncheckedAccount`. Confere owner, discriminador e `data_len == 187` (senão `ConfigAlreadyMigrated`), transfere rent, `resize(285)`, grava `layout_version = 2`.

- **Janela:** entre upgrade e migração toda instrução que lê Config falha. Na devnet são segundos: inserir entre os passos 4 e 5 de `docs/devnet-upgrade.md`. Na mainnet `initialize_config` já cria v2; remover `migrate_config` depois.
- **Rollback:** layout só cresce no fim; o binário antigo deve ler v2 (`try_deserialize_unchecked` usa `deserialize`, não `try_from_slice`; a verificar por teste).
- **LiteSVM:** `Env::build(false)` e `svm.set_account` já existem nos testes. Struct espelho `ConfigV1` com o discriminador de Config (187 B). Casos: instrução comum falha com v1; não-authority falha; migra preservando os 187 B e zerando o resto; segunda chamada falha; fluxo normal passa depois; leitor v1 lê v2.

## 5. Autoridade na mainnet

| Chave | Proposta |
|---|---|
| Upgrade authority | Squads v4, vault 0, 2-de-3: chaves em carteiras distintas; composição mantida em privado |
| Admin | Carteira fria até a Abertura; depois vault 1 do mesmo Squads (`propose_admin`) |
| `guardian` | Só pausa, com o dono |
| Servidor assina | `FEE_PAYER` (não autoriza fundos), `VERIFIER`, `USAGE_AUTHORITY` |
| Servidor nunca assina | upgrade authority, admin, guardian, keypair do programa, dono da tesouraria, chaves de criador/comprador |

**Rotação:** verifier/usage por `update_config`; admin e tesouraria pelos novos comandos; upgrade authority por `set-upgrade-authority --skip-new-upgrade-authority-signer-check` (endereço errado é irrecuperável).
**Buffer:** `write-buffer` com a chave de deploy, `set-buffer-authority` ao vault, `solana-verify get-buffer-hash` igual ao do build, `extend` se crescer, proposta no Squads.
**Build:** `anchor build --verifiable` existe no 1.2.0 (conferido no WSL), mas `solana-verify` não está instalado e o `.so` da devnet saiu fora do Docker. Imagem para Solana 3.0.0: a verificar.

**Já existe:** `upgrade-devnet.sh`, `docs/devnet-upgrade.md`, `build-program.sh`, `program.yml` (toolchain pinada, não verificável).
**Falta:** ensaio com Squad na devnet; `upgrade-mainnet-buffer.sh` sem upgrade authority; build verificável no CI; recusar `ADMIN_KEYPAIR` com `SOLANA_CLUSTER=mainnet-beta` (`env.ts`); alerta de `ConfigUpdated` e troca de authority; runbook de pausa.

## 6. Perguntas ao dono

1. **Admin:** carteira fria até a Abertura e Squads depois, ou Squads já? Recomendo a primeira (`approve_agent` é frequente).
2. **Stake:** 97 dias com extensão do admin, ou contador no Agent? Recomendo os 97 dias.
3. **Confisco:** 72 h, sem teto, só tesouraria? Recomendo sim.
4. **Pausa:** flags no Config e `guardian` que só liga; quem segura? Recomendo o dono, em dispositivo separado.
5. **Mainnet:** novo keypair de programa (outro `declare_id!`) ou o da devnet? Recomendo novo, já com Config v2.

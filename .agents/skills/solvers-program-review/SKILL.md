---
name: solvers-program-review
description: Checklist de revisão de PR em programs/solvers (Anchor 1.2, Metaplex Core, USDC no Token clássico). Use ao revisar diff ou ao alterar instruções, contas, erros, escrow, stake ou testes do programa; termina com saída CRITICAL/WARNING/INFO por arquivo:linha.
---

# Revisão de PR do programa solvers

Diff: `git diff master...HEAD -- programs/ scripts/chain packages/solvers-client` mais o trabalho não commitado. Leia inteiros os structs de contas e os handlers tocados. Ataques genéricos: `solana-security`. Não afirme comportamento que você não conferiu no código, no crate do Anchor ou num teste; o que ficar sem conferir vai para "a verificar".

## Mapa para ancorar

- PDAs em `state.rs`: config, pending_admin (config), agent (agent_id), stake (agent), rep (buyer), review (agent, author), credits (agent, buyer), escrow (buyer, agent, nonce), escrow_vault (escrow), collection_authority, license_review (asset).
- Fundos: licença e créditos (`pay_split` para tesouraria e `creator_usdc`), escrow por marcos (cofre com authority = escrow), stake (cofre com authority = agent).
- Licença é um asset mpl-core numa coleção por agente; a PDA `collection_authority` assina a criação.
- `Config.admin` vem de `initialize_config`, que exige a upgrade authority, e só muda pela rotação em 2 etapas (`propose_admin` -> `accept_admin`, com `cancel_admin_transfer`; proposta na PDA `PendingAdmin`, uma por vez). `verifier` e `usage_authority` são chaves do servidor.

## Checklist

1. **Dono, signer, PDA.** Cada `UncheckedAccount` tem `/// CHECK:` que o código impõe (`address =`, `owner =`). Quem autoriza é sempre `buyer`/`creator`/`author`/`admin`, nunca o `payer` (a plataforma paga rent). Papel privilegiado ligado ao estado (`has_one`). PDA com seeds por tipo e por usuário, bump armazenado (`bump = x.bump`, `vault_bump`), sem `find_program_address` em handler. Conta que move USDC valida mint e destino contra `Config` ou `Agent`.
2. **Contas mutáveis duplicadas (Anchor 1.x).** Duas contas `Account<>` mutáveis iguais falham em runtime com `ConstraintDuplicateMutableAccount` (`anchor-syn` `try_accounts.rs`), salvo `dup`. Caminhos a decidir e testar: compra própria (`buyer_usdc` = `creator_usdc` em `PurchaseLicense`/`BuyCredits`), escrow com criador = comprador (`buyer_usdc` = `creator_usdc` em `ResolveDispute`; `create_escrow` não impede), `creator_usdc` = `treasury`. Para cada par: bloquear com erro próprio ou aceitar com `dup` justificado. Nenhum teste cobre isso hoje.
3. **`init_if_needed`** só com sentinela e conta nunca fechada: `UserReputation.wallet`, `Credits.owner`, `Review.author`, `LicenseReview.review` valem `default` até o primeiro uso. Se algum `close` aparecer nessas contas, a recriação zera contadores (`disputes_lost` burlaria `BuyerNotEligible`). `init_if_needed` novo é WARNING até haver justificativa. Seeds amarradas ao signer.
4. **Close e revival.** Só `close_escrow` fecha: exige status `Completed|Refunded`, devolve a sobra do cofre, fecha o cofre por CPI e o escrow por `close = rent_payer`. Confira destino fixo e cofre zerado. O escrow é `init`, então o mesmo nonce pode recriar o endereço depois do close (a flag `escrows.closed` do espelho assume endereço único: a verificar).
5. **Aritmética.** `checked_*` em todo valor; sem `as` que estreita. Hoje há `as u64` e `-` sem checked em `fee_split`, `now + window` em `escrow.rs` e `agent.stake -= amount` em `slash_stake`, aparentemente protegidos por validação anterior (confira ao tocar). Código novo usa `checked_*` mesmo assim.
6. **CPI mpl-core.** `mpl_core_program` com `address = mpl_core::ID`; coleção casada por `has_one = collection`; `invoke_signed` com seeds de `collection_authority`; nome, URI e atributos vêm do estado do `Agent`, não do input. `holds_license` (review.rs) checa dono da conta = mpl-core, `Key::AssetV1`, owner = autor e `UpdateAuthority::Collection(agent.collection)`; mudança ali exige teste com licença de outra coleção e de outro dono. Tokens: `transfer_checked` com `decimals` do mint e `Program<'info, Token>`.
7. **ATA por endereço, não por dono.** `associated_token::authority` valida o endereço derivado **e** `owner == authority` (`ConstraintTokenOwner`, `anchor-syn` `constraints.rs`). No Token clássico o dono de uma ATA pode ser trocado por `SetAuthority(AccountOwner)`; a conta deixa de passar e, como o endereço é determinístico, não dá para recriá-la. Conta de destino que o programa precisa pagar sem o titular (reembolso, sobra, repasse) valida endereço + mint (`address = get_associated_token_address(..)` ou endereço guardado + `transfer_checked`). `ResolveDispute`, `ResolveStaleDispute` e `CloseEscrow` usavam `associated_token::authority = escrow.buyer`; na árvore de trabalho de 2026-10-01 (não commitado) já estão com `token::mint` + `address = get_associated_token_address(..)`. `RegisterAgent` mantém `associated_token::authority = creator`, só na criação e com o criador assinando. Os testes `buyer_ata_owner_swap_*` em `tests/program.rs` cobrem o caso; confira se passam. O comentário "se fechar, pode recriar" cobre close, não troca de dono.
8. **Escrow sem ponto único de falha.** Para cada estado de etapa liste quem sai dele: Pending (verifier `mark_passed`; comprador `release_milestone`, `open_dispute`, `cancel_undelivered` após o prazo); Passed (comprador, ou qualquer um após a janela; contestação na janela); Disputed (`resolve_dispute` só admin; `resolve_stale_dispute` qualquer um, mas só com `passed_at == 0`, SLA e prazo vencidos). Etapa entregue e contestada só sai pelo admin (`StaleDisputeNeedsJudgment`), sem prazo-limite; é decisão consciente, e PR novo não pode ampliar isso. Nada de fundo preso: o cofre fecha em zero e sobra volta ao comprador. `update_config` não troca `admin`; a troca é a rotação em 2 etapas (o novo admin precisa assinar `accept_admin`, então indicar chave errada ou perdida não passa a administração; o admin atual desfaz com `cancel_admin_transfer`). Perder a chave do admin ATUAL antes de propor continua travando esse caso, e não há pausa (design em `docs/design-governance-v2.md`).
9. **Stake com saída.** `register_agent` deposita `min_stake` no `stake_vault`; `slash_stake` (admin) o reduz e `top_up_stake` (criador, qualquer status, `amount > 0`, `checked_add`) o repõe; reativar o solver ainda exige `approve_agent`. Nenhuma instrução devolve stake ao criador (retirada não existe; design em `docs/design-governance-v2.md`) e `set_treasury` (admin) só troca a conta de USDC de `Config.treasury`, que precisa ser do mint da plataforma e não congelada (conferido em admin.rs e agent.rs em 2026-10-01). Mudança que mexa em stake precisa definir a saída, manter `amount <= agent.stake` e `approve_agent` exigindo `stake >= min_stake`.
10. **Eventos e cliente.** Evento ou instrução nova pede IDL e cliente regenerados (`scripts/chain/build-program.sh` copia para `packages/solvers-client`) e entrada em `DECODERS` de `packages/chain/src/events.ts`; o indexador depende disso.
11. **Testes.** Toda instrução tem teste feliz e negativo; todo erro de `errors.rs` tem teste que checa o nome (`err.contains("Nome")`). Em 2026-10-01, lendo `lib.rs`, `errors.rs` e `tests/program.rs`: sem teste, 5 instruções (`suspend_agent`, `slash_stake`, `update_version`, `set_eval`, `record_usage_batch`) e 14 erros (`NotUsageAuthority`, `NotCreator`, `AgentNotPending`, `StringTooLong`, `InvalidBps`, `PayPerUseDisabled`, `InvalidAmount`, `InvalidRating`, `InvalidTokenAccount` (sem uso em `src`), `InvalidLicenseAccount`, `InvalidMilestones`, `InsufficientStake`, `MathOverflow`, `InvalidReviewWindow`). Refaça a conta, não copie: `for e in $(grep -oE '^    [A-Z][A-Za-z]+,$' programs/solvers/src/errors.rs | tr -d ' ,'); do grep -q "contains(\"[^\"]*$e" programs/solvers/tests/program.rs || echo $e; done`; para instruções, `grep -c "instruction::Nome\b" programs/solvers/tests/program.rs`.
12. **CU.** Defina teto por instrução: leia `compute_units_consumed` do metadata do LiteSVM (0.17) e registre. As mais pesadas: `register_agent` (init do cofre, transferência, `CreateCollectionV2`) e `purchase_license` (duas transferências, `CreateV2`, `init_if_needed`). O cliente fixa `COMPUTE_UNITS = 400_000` em `packages/chain/src/chain.ts`; consumo perto disso exige ajuste lá.

## Rodar os testes

Windows nativo falha no linker (`-lgcc_eh`): use WSL. Os testes carregam `target/deploy/solvers.so` e `tests/fixtures/mpl_core.so` e não recompilam; um `.so` velho testa código velho. `bash scripts/chain/test-program.sh` copia para `~/solvers-build`, recusa um `.so` mais velho que o fonte e aceita `BUILD=1` para reconstruir (`build-program.sh`, `anchor build`). À mão, na cópia do WSL: `anchor build` e depois `cargo test --locked -p solvers --test program`.

## Saída

```
REVISÃO: <branch> vs master | <n> arquivos | +<add> -<rem>
CRITICAL (corrigir antes do merge): fundos, autoridade ou saída de estado afetados
WARNING (corrigir ou aceitar explicitamente): init_if_needed novo, dup, lacuna de teste, ATA por dono
INFO: CU, estilo
A VERIFICAR: suspeitas não confirmadas
Cada item: arquivo:linha | problema | cenário (quem envia o quê, com quais contas) | correção
```

Pronto quando não houver CRITICAL e cada WARNING estiver corrigido ou aceito pelo usuário.

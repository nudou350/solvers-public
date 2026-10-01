# Revenda de licenças

Programa: `programs/solvers/src/instructions/resale.rs`. Estado em devnet; **mainnet depende dos termos de revenda com o advogado** (`NEXT_STEPS.md`). Upgrade e rollback: `docs/devnet-upgrade.md`.

## Visão

O dono de uma licença permanente anuncia por um preço em USDC, outro usuário compra pelo mercado, a licença muda de carteira na mesma transação e o criador do solver recebe royalty. **Sem custódia**: a licença não sai da carteira do vendedor até a venda, e ele mantém o acesso até lá. Ao anunciar, o dono aprova a PDA `market_authority` (seed `market_authority`) como `TransferDelegate` do asset; a plataforma abre uma conta `Listing` (PDA `["listing", asset]`, 157 bytes, um por asset, rent pago pela plataforma e devolvido ao fechar).

## Fluxo

- **Anunciar** (`list_license(price)`, assina o vendedor): exige `price >= config.min_price`, dono do asset = vendedor, asset na coleção do solver, e que o vendedor não seja o criador (MVP). Grava `fee_bps` (de `config.fee_bps`) e `royalty_bps` (de `agent.royalty_bps`) **congelados** no anúncio: mudar a taxa depois não afeta anúncios abertos. Não há `update`: para mudar o preço, cancele e anuncie de novo.
- **Cancelar** (`cancel_listing`): o vendedor cancela quando quiser (revoga o delegate e fecha o `Listing`). Qualquer outra carteira só fecha anúncio **velho** (o dono mudou, o delegate foi revogado ou o asset foi queimado), para o endereço não ficar preso e o novo dono poder anunciar.
- **Comprar** (`buy_listing(expected_price)`, assina o comprador): confere o preço esperado, que o asset ainda é do vendedor, da coleção e delegado à PDA. Transfere o asset, paga royalty, taxa e vendedor e fecha o `Listing`, tudo numa transação.

## Divisão do pagamento

Do preço pago pelo comprador: **royalty** (`agent.royalty_bps`) para a ATA do criador, **taxa da plataforma** (`config.fee_bps`) para a tesouraria, e **o resto** para a ATA do vendedor (pelo endereço derivado, então trocar o dono da própria ATA não trava a venda). Royalty e taxa arredondam para baixo; a sobra fica com o vendedor (`resale_split` em `state.rs`).

Exemplo: preço 100 USDC, royalty 5%, taxa 10% -> criador 5, plataforma 10, vendedor 85.

## Regras e limites

- Royalty **por convenção**: só a venda pelo mercado paga. Transferir a licença por fora segue livre e sem royalty (as coleções existentes usam `RuleSet::None`).
- Teto de royalty + taxa: 5000 bps (50%). Preço >= `config.min_price`.
- Compra bloqueada para solver suspenso, retirado ou com stake abaixo do mínimo. Anunciar e cancelar não dependem do status.
- A pausa de entradas (`PAUSE_ENTRIES`) bloqueia anunciar e comprar; cancelar nunca pausa.
- Revenda não é venda do criador: não incrementa `UserReputation` nem `agent.total_sales`.
- Depois de qualquer transferência o mpl-core devolve a authority do delegate ao dono (provado em teste com o `mpl_core.so` real), então a PDA nunca transfere duas vezes.
- **Memórias não acompanham a licença** (são da carteira). As avaliações pessoais ficam com quem as escreveu e a nota é a do solver.
- Medidas: `.so` 909.888 bytes (teto da CI 946.244); CU máximos `list_license` 55.659 (teto de teste 70.000), `buy_listing` 51.611, `cancel_listing` 31.319.

## Erros do programa

| Código | Nome | Quando |
|---|---|---|
| 6051 | `SelfPurchase` | o vendedor tenta comprar o próprio anúncio |
| 6052 | `ListingMismatch` | o anúncio não corresponde ao solver ou ao asset |
| 6053 | `ResaleCutTooHigh` | royalty + taxa passam de 5000 bps |
| 6054 | `NotAssetOwner` | o asset não é da carteira do vendedor |
| 6055 | `AssetNotInCollection` | o asset não é da coleção do solver |
| 6056 | `ListingStillValid` | terceiro tenta cancelar um anúncio ainda executável |
| 6057 | `CreatorCannotResell` | o criador tenta revender licença do próprio solver |
| 6058 | `ListingNotAuthorized` | o delegate não aponta mais para a PDA |
| 6059 | `CancelPayerMismatch` | o vendedor cancela pagando a própria transação (quem paga tem que ser quem abriu o anúncio; ele sempre pode revogar o delegate direto no mpl-core) |

Também valem os já existentes: `PriceTooLow`, `InvalidAmount`, `PriceChanged` (`expected_price` diferente), `AgentNotActive`, `InsufficientStake` e `Paused`. As mensagens em português dos erros novos pertencem a `packages/chain/src/program-errors.ts` (o teste dessa lista quebra sem elas; na data desta escrita ainda não estavam lá: conferir). Eventos: `LicenseListed`, `LicenseResold` (com `royalty`, `fee`, `seller_amount`) e `ListingCancelled`.

## Flags

`resaleEnabled` (em `PublicConfig`): desligada, a tela `/revenda` mostra "em breve", a biblioteca não oferece "Anunciar" e o servidor não deve montar transações de revenda. O deploy sobe com ela **desligada** e só se liga no fim do upgrade (`docs/devnet-upgrade.md`, passo 8a). O programa não conhece essa flag: ela só controla servidor e web. *Confirmar no código da Fase 3 o nome da variável de ambiente que a alimenta.*

## Operação

- **Reindexar**: `pnpm --filter @solvers/server cli:reindex --backfill` (na VPS) reconstrói o espelho de anúncios e vendas a partir da cadeia. Rode depois do upgrade e antes de ligar a flag.
- **Dados simulados**: o `seed` antigo marcava anúncios inventados em `licenses.listed_for_resale`/`licenses.resale_price` e gravava histórico em `resale_prices`. Limpe antes de ligar a flag (`pg_dump` antes; **confirmar com o dono antes do DELETE/UPDATE**). Nunca mostrar dados simulados na tela.
- **Anúncio preso**: um anúncio velho qualquer carteira fecha com `cancel_listing`. Se o delegate ficou pendurado num asset (rollback do programa), o vendedor o revoga pela própria carteira.

## Pendências

- **Advogado**: termos de revenda para a mainnet (royalty por convenção, taxa e royalty no mercado, licença usada).
- **Avaliação de licença usada**: a avaliação on-chain é uma por asset (`LicenseReview`); se a dona anterior já avaliou com aquele asset, o novo dono não consegue avaliar com ele. Aceito no MVP.
- **Wash trading**: nada impede o mesmo dono de comprar e vender entre as próprias carteiras para mexer no histórico de preço do mercado. Sem mitigação no MVP.
- **Custo do upgrade**: SOL da extensão do ProgramData e do buffer é estimativa; confirmar no dry-run do `upgrade-devnet.sh`.

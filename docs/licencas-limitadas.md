# Licenças limitadas (teto de licenças por solver)

Status: **implementado no programa e no servidor em 02/10/2026** (branch `feat/licencas-limitadas`, sem push, sem deploy).
Falta o upgrade único da devnet (seção 8) e rodar o e2e (`scripts/src/e2e-supply.ts`) depois dele.
Escopo: **devnet**. O teto é **imposto pelo programa Anchor** (`purchase_license`); o servidor só espelha e dá respostas claras antes de montar a compra.

Este documento substitui o plano de 01/10/2026, que mantinha o teto só no servidor. O usuário pediu o teto verificável on-chain e
que ele entre no **mesmo** upgrade da devnet da revenda e da governança v2 (um upgrade só).

## 1. Decisões confirmadas pelo usuário

| # | Pergunta | Resposta |
|---|---|---|
| 1 | O criador define o número de licenças? | **Sim.** Padrão ilimitado. Limitado = inteiro de 1 a 1.000.000 em `supply.maxLicenses` do `manifest.json`. |
| 2 | Onde vive o teto? | **On-chain** (PDA `SupplyCap`), no mesmo upgrade da devnet da revenda e da v2. *(Antes: só servidor.)* |
| 3 | O que conta para o teto? | **Licenças emitidas na vida do solver** (`Agent.total_sales`, que só sobe). Queimar, revender ou transferir **não** reabre vaga. *(Substitui a antiga decisão "a licença reembolsada libera a vaga": o programa não tem instrução de queima e o contador monotônico é o que dá para verificar.)* |
| 4 | Teste grátis em produto limitado? | **A critério do criador**, independente do teto (`trial.available`). Não consome vaga. |

### Decisões que continuam abertas (recomendação em itálico)

| # | Pergunta | Recomendo |
|---|---|---|
| O1 | Em produto limitado, 1 licença por carteira? | *Sim, mas só no servidor.* Nada disso é imposto on-chain. A branch `feat/x402-agentes` já traz o guarda `already_owned` para **todos** os produtos em `/tx/purchase` (`store/purchase-guards.ts`); ao juntar as duas branches o O1 fica resolvido sem código novo aqui. |
| O3 | Vitrine mostra o número exato ("3 de 10")? | *Sim* (é o que está implementado: `supply { max, sold, left }`). |
| O4 | Tarefa com garantia em produto limitado? | *Independente*: a garantia dá acesso por tarefa, não é licença e não ocupa vaga (`guarantee.available` decide). |
| O5 | Quem edita o teto depois de publicado? | *Fase 2*: endpoint do criador (seção 7). Hoje: republicar o manifest (`cli:publish`), que só sobe o teto. |

## 2. Como funciona

1. **Programa** (`programs/solvers/src/instructions/supply.rs`, `purchase.rs`, `state.rs`):
   - PDA `SupplyCap { agent, max: u32, bump }`, seeds `["supply_cap", agent]`, 45 bytes. **Nenhuma conta existente muda de layout** (regra do repositório).
   - `create_supply_cap(max)` (o criador assina, a plataforma paga o rent): `max >= 1` e `max >= Agent.total_sales`; `init` (não existe duas vezes).
   - `raise_supply_cap(max)` (só o criador): `max` **maior** que o atual, senão `SupplyCapCannotDecrease`. `u32::MAX` equivale a ilimitado.
   - `purchase_license` ganha a conta `supply_cap` (entre `reputation` e `mpl_core_program`). O endereço é imposto pelas seeds, então **não dá para omiti-la nem trocá-la**. Conta nunca criada (dono = System Program) = ilimitado; criada, a compra falha com `SoldOut` (6060) quando `total_sales >= max`. A transação inteira volta: nenhum USDC se move.
   - Evento `SupplyCapSet { agent, max }`; erros `SoldOut` 6060, `SupplyCapTooLow` 6061, `SupplyCapCannotDecrease` 6062.
   - Concorrência: duas compras pela última vaga na mesma slot disputam a conta `agent` (escrita); o runtime serializa e **exatamente uma passa**. Não existe tabela de reservas.
2. **Servidor** (só espelha e pré-checa):
   - `agents.max_licenses integer` (nullable; `null` = ilimitado). `syncAgent` lê a PDA a cada sincronização (`chain.fetchSupplyCap`) e o evento `SupplyCapSet` dispara o `syncAgent`.
   - `store/supply-rules.ts` (puro): `supplyOfRow`, `isRowSoldOut`, `supplyLabel`, `nextMaxLicenses` (regra "só sobe" do `cli:publish`). `store/supply.ts`: `assertSupplyOpen(row)` -> **409 `sold_out`**, usando só o espelho (sem RPC).
   - Chamado em `POST /tx/purchase` (antes de qualquer RPC) e em `neededUnits` do Pix e do SODAX (`type: "permanent"`): ninguém paga Pix por uma compra que o programa recusaria. Se o espelho estiver atrasado e a simulação pegar `SoldOut`, `assertSimulationOk` devolve o mesmo 409 `sold_out`.
   - `Agent.supply` e `CreatorDashboard.agents[].supply` (`{ max, sold, left }`, sem consulta extra: vêm de `total_sales` e `max_licenses`).
   - MCP: `find_solver` mostra "X de Y licenças restantes" ou "esgotado"; `get_purchase_link`, `activate_solver` (sem acesso) e o fim do teste não oferecem link de compra de solver esgotado e só sugerem a revenda com `RESALE_ENABLED`. O fluxo do teste grátis não muda.
   - Manifest: `supply: { maxLicenses }` (1 a 1.000.000, estrito); aviso `SUPPLY_WITH_TRIAL` (nível A) quando o produto tem teto **e** teste ligado (o teste não consome vaga).
   - `cli:publish`: cria o teto se não existe e o manifest pede; sobe se o manifest é maior; **avisa e mantém** se o manifest é menor ou some (nunca vira ilimitado por omissão); depois `syncAgent`. Publicar um manifest **com** `supply` contra o programa antigo falha com mensagem apontando o upgrade.
3. **Vitrine** (fork B, ver o plano de web em `apps/web`): selo "X de Y restantes", "Esgotado" com botão desabilitado, `sold_out` no checkout.

## 3. O que se pode e o que não se pode prometer ao comprador

O programa só impede **baixar** o teto. O criador pode **subi-lo** depois (até `u32::MAX`, ilimitado), e um solver cujo teto nunca foi criado é ilimitado. Portanto:

- **Pode dizer**: "o limite atual é N, verificável na blockchain, e só pode aumentar".
- **Não pode dizer**: "só existirão N licenças" nem "garantido para sempre". Os textos do MCP, da vitrine, do `PACKAGE_SPEC.md` e do material do hackathon seguem isso.
- O teto é imposto pelo programa, mas **o criador pode aumentá-lo**: a exclusividade vale enquanto ele mantiver o limite.

## 4. Limitações (o que sobrou da versão só-servidor)

| # | Limitação | Efeito | Como remover |
|---|---|---|---|
| L1 | **Teto só sobe, nunca desce** (por desenho). | Quem comprou acreditando em "X de Y" não é diluído; o criador não "reduz a oferta" depois. Se errar para cima, não há volta. | Reabrir a decisão. |
| L2 | **O criador pode aumentar o teto** (até ilimitado). | "Limitado" é o limite do momento, não uma promessa eterna (seção 3). | Não remover: é o desenho. |
| L3 | **Contador = licenças emitidas** (`total_sales`), não licenças vivas. | Queimar o NFT, revender ou transferir não abre vaga. O mercado secundário é o caminho para quem quer entrar depois. | Só com instrução de queima + contador próprio (fora do escopo). |
| L4 | **O espelho do banco pode atrasar** (indexador/webhook). | O pré-check pode deixar passar uma compra de solver recém-esgotado (a simulação e o programa barram: 409 `sold_out`, nada se move) ou barrar um pouco depois de o criador subir o teto (até o próximo `syncAgent`; o `SupplyCapSet` dispara na hora). | O polling de fallback já cobre. |
| L5 | **Pix e SODAX não reservam vaga.** Só conferem ao abrir a cobrança. | Quem paga o Pix pode perder a última vaga antes de comprar. O dinheiro **não se perde**: vira USDC na carteira. A tela explica. | Reserva na cobrança (complexidade alta, fora do escopo). |
| L6 | **Várias carteiras contornam qualquer limite por carteira.** | Açambarcar e revender continua possível com carteiras diferentes: o criador ganha royalty a cada giro. | Nenhuma (identidade real fica fora do produto). |
| L7 | **Esgotado só tem saída pela revenda.** | Com `RESALE_ENABLED=false` a tela mostra só "Esgotado". Na VPS atual a revenda está ligada. | Manter a flag ligada onde houver produto limitado. |
| L8 | **Teste grátis é independente do teto.** | Não consome vaga e é por carteira. Quem quer exclusividade real desliga o teste (o validador avisa com `SUPPLY_WITH_TRIAL`). | Decisão do usuário. |
| L9 | **A janela entre o upgrade e o deploy do servidor novo.** | O servidor antigo monta `purchase_license` sem a conta `supply_cap`: compras de licença falham até o deploy do servidor novo. | Fazer o push logo depois do passo 4a do upgrade (seção 8). |

Resolvidas pela mudança para on-chain (existiam no plano só-servidor): furar o teto com SOL próprio chamando o programa direto, "1 NFT só" não verificável pelo comprador, corrida das reservas, reserva presa por 10 min, tabela `license_reservations` e job de purga.

## 5. Testes (rodados em 02/10/2026)

- Programa (LiteSVM, WSL): 122 passam, 7 novos de teto: bloqueia no teto sem mover USDC; solver sem conta é ilimitado; teto criado depois das vendas (zero e abaixo do vendido recusados, igual ao vendido já nasce esgotado, subir reabre); só o criador cria/sobe e só uma vez; só sobe (`u32::MAX`); a compra não escapa passando outra conta no lugar de `supply_cap` (PDA de outro solver, endereço aleatório, System Program, a carteira do comprador, conta omitida); transferir a licença não libera vaga. `.so` de 932.768 bytes (teto da CI: 946.244).
- Servidor: `supply-rules.test.ts` (puro), `supply.db.test.ts` (banco descartável: coluna opcional, `supply` na API do catálogo e no painel, 409 `sold_out` em `/tx/purchase` e `neededUnits`, textos do MCP), `simulation-gate.test.ts` (SoldOut vira `sold_out`), `validate.test.ts` (`supply` aceito/recusado, `SUPPLY_WITH_TRIAL`). `trial.test.ts` sem alteração.
- `shared`: `supply.test.ts`. `chain`: erros e eventos novos cobertos pelos testes de paridade existentes.
- **Ainda não rodado**: `scripts/src/e2e-supply.ts` (teto 1, comprador A compra, B recebe `SoldOut` sem mover USDC, sobe para 2, B compra, baixar falha). Exige o programa novo na rede: só depois do upgrade da devnet.

## 6. Checklist de pronto

1. [x] Programa: `SupplyCap`, `create_supply_cap`, `raise_supply_cap`, conta em `purchase_license`, testes, `.so` dentro do teto da CI.
2. [x] Cliente, `chain` e `shared` regenerados/atualizados.
3. [x] Servidor: coluna, indexador, pré-checks, API, painel, MCP, manifest, validador, `cli:publish`.
4. [x] `PACKAGE_SPEC.md` (§4.1 e Apêndice A), `docs/devnet-upgrade.md` (o que muda e a janela L9).
5. [ ] Vitrine, checkout, assistente do criador e painel (web).
6. [ ] Upgrade da devnet com o `.so` novo + `migrate-config` (docs/devnet-upgrade.md) e só então `git push`.
7. [ ] `e2e-supply.ts` verde na devnet.
8. [ ] Migration do servidor renumerada ao juntar com a branch do x402 (seção 8).

## 7. Fase 2 (depois): o criador edita o teto pelo site

`PATCH /api/creator/agents/:id/supply` (JWT, carteira = criadora do solver) com `{ maxLicenses: number | null }`. O servidor valida com `nextMaxLicenses`, monta a transação `raise_supply_cap` (ou `create_supply_cap`) para o **criador assinar** (a plataforma paga a taxa), como as outras operações do criador. Não exige nova versão nem revisão: o teto não está no pacote nem no hash. O teste grátis continua no pacote (mudar exige nova versão e revisão). Depende do pipeline real de envio do `PACKAGE_SPEC.md` §14 (o assistente do criador ainda é mock).

## 8. Como encaixa no upgrade único da devnet

- O programa desta branch parte da `master`, então o `.so` já contém **revenda + governança v2 + teto**. Um upgrade só.
- Ordem (`docs/devnet-upgrade.md`): build, dry-run, `upgrade-devnet.sh --yes`, `migrate-config` (passo 4a), **e logo em seguida** o `git push` (deploy automático da `master`). Entre o upgrade e o deploy do servidor novo as compras de licença do servidor antigo falham (L9): segundos, se o push for imediato.
- Custo extra do teto no upgrade: `.so` +22.880 bytes (909.888 -> 932.768): extensão ~0,12 SOL (não volta) e buffer ~0,16 SOL maior (devolvível).
- **Migration do servidor**: `apps/server/src/db/migrations/0014_agents_max_licenses.sql` (só `ADD COLUMN max_licenses integer`, nullable: aditiva, a release antiga continua rodando). A branch `feat/x402-agentes` também usa o número `0014` (`0014_x402_orders.sql`): ao juntar, **renumerar uma delas para `0015`** (arquivo, entrada em `meta/_journal.json` e snapshot) e rodar `db:generate` para conferir que o snapshot continua coerente.
- Integração com o x402: a compra por custódia usa `purchaseLicenseIxs` (que já passa a `supply_cap` sozinha, pois o cliente gerado a deriva do `agent`) e o programa barra com `SoldOut`; a rota x402 deve chamar `assertSupplyOpen(row)` **antes** de emitir o 402 (para o agente não pagar e depois ser reembolsado) e tratar `SoldOut` na emissão como falha com reembolso (já é o caminho de `mint_failed`).

## 9. Fora de escopo

Reserva de vaga no Pix/SODAX (L5); limite por carteira configurável pelo criador (`maxPerWallet`); lista de espera ou aviso quando o teto subir; leilão de vagas; reembolso/queima de licença que reabra vaga.

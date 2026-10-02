# Agentes compradores via x402 (fases 0 a 2)

Status: **fases 0, 1 e 2 implementadas e validadas na devnet em 02/10/2026 (seção 13), sem commit nem deploy.** O deploy (6.12) e o parecer jurídico (seção 9) continuam pendentes.
Escrito a partir de quatro auditorias (código e spec do x402).
Escopo: **devnet**. Mainnet fica bloqueada até o parecer jurídico (seção 9).

## 0. Decisões confirmadas pelo usuário (01/10/2026)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Onde trabalhar | Branch nova **`feat/x402-agentes`** a partir da `master`, commits locais, **sem push** (a regra do projeto proíbe push antes do upgrade da devnet; a `master` já tem commits de revenda sem push). |
| 2 | Quem recebe o NFT | **Sempre quem pagou.** Sem destinatário informado no pedido. |
| 3 | Limites de preço na rota x402 (devnet) | **Piso = mínimo do programa (5 USDC)**, **teto = 100 USDC** por compra. O piso pode **subir** se a spike 0.5 mostrar que o custo supera a taxa; nunca descer abaixo do mínimo do programa. |
| 4 | Facilitator, se o público não aceitar o nosso USDC | **Subir facilitator próprio** (≈ +4 a 6 h) com a nossa chave de taxa. É a única saída: a custódia precisa receber o mesmo USDC que o programa usa. |
| 5 | Teste grátis para agentes | **Nenhum.** Agente sem licença recebe a instrução de compra. |

### O que é o facilitator (glossário)

O facilitator do x402 é o "caixa" do pagamento. Faz três coisas: (1) **confere** a transferência de USDC que o agente assinou (valor, moeda, destino, memo);
(2) **paga a taxa de rede** (SOL) em nome do agente, que só precisa ter USDC; (3) **envia a transação** à Solana e avisa o servidor "pagou", com o
endereço de quem pagou. Ele **não troca moeda nem converte nada** — não tem relação com o SODAX (que é swap/cotação usado na demo para humanos).
Em teste usamos o público `x402.org/facilitator` (grátis, sem chave). Se ele não aceitar o nosso mint de USDC da devnet, rodamos o nosso
(`@x402/core`, `new x402Facilitator()` + `ExactSvmScheme`, com `FEE_PAYER_KEYPAIR` como pagador da taxa).

Legenda: **[código]** = lido no repositório (arquivo:linha na época da leitura). **[spec]** = lido na especificação do x402.
**[confirmar]** = ainda não verificado; a fase 0 existe para fechar esses itens.

---

## 1. Objetivo e definição de pronto

Um agente de IA sem humano, só com um keypair Solana e USDC, consegue:

1. Achar um Solver e saber o preço.
2. Pagar via x402 e receber a licença (NFT Metaplex Core) **na própria carteira**.
3. Entrar no MCP assinando com a carteira e usar o Solver (ativar, etapas, ferramentas, conhecimento, memória).
4. Não pagar duas vezes pelo mesmo Solver, e ser reembolsado se o pagamento passar mas a licença falhar.

**Pronto quando** o script `scripts/src/e2e-agent.ts` rodar na devnet, de carteira nova, sem intervenção, e terminar com
a licença na carteira do agente, uma sessão de Solver ativa com `access = license`, e um `run_tool` executado.

Fora do escopo (fases 3 e 4): revenda por x402, SDK/CLI de agente, tools MCP de transação, nível de garantia no servidor,
ajuda ao criador, descoberta (`llms.txt`, OpenAPI, Bazaar), aceite de termos assinado, reconciliação completa, mainnet.

## 2. Decisões e por quê

| # | Decisão | Motivo |
|---|---|---|
| D1 | Compra por rota HTTP pública, **fora do MCP** | O `/mcp` exige OAuth; o agente não chega nele antes de comprar. O transporte `@x402/mcp` só tem exemplos EVM [spec]. |
| D2 | Rota em **`/api/x402/...`**, não em `/v1` | `/api` já passa pelo nginx e pelos limites de `app.ts:72-73`. Uma rota nova fora de `/api` exigiria editar o nginx, e o deploy não atualiza o nginx (nota 503 do projeto). |
| D3 | Programa Anchor **não muda** | O `exact` do SVM só aceita um `TransferChecked` + compute budget + memo [spec]; o `purchase_license` não passa. A plataforma recebe o USDC e compra pela custódia. |
| D4 | Fluxo **`upfront`** (liquida antes de mintar) | No fluxo padrão o handler roda antes do settle; se o settle falhar, a licença já existe de graça [spec]. |
| D5 | **Ordem com preço travado** e `order_id` como `extra.memo` | O memo é obrigatório no SVM; usar o id da ordem amarra o pagamento ao preço e permite reconciliar [spec]. |
| D6 | O NFT vai **para o pagador** (não para um destinatário informado) — **confirmado pelo usuário** | Menor superfície de abuso. Destinatário livre fica para depois. |
| D7 | Facilitator externo na devnet (`x402.org/facilitator`); **facilitator próprio é o plano B já autorizado** | Sem chave, devnet [spec]. Se não aceitar o nosso mint de USDC, sobe o próprio com `@x402/core` (≈ +4 a 6 h) — decisão já tomada, não precisa perguntar de novo. |
| D8 | Agentes **não** têm teste grátis — **confirmado pelo usuário** | Carteira nova custa zero e esgotaria o trial indefinidamente (`NEXT_STEPS.md:28`). |
| D10 | Limites da rota: piso 5 USDC (pode subir pela spike 0.5), teto 100 USDC — **confirmado pelo usuário** | Margem fina no preço mínimo; teto limita a exposição da custódia. |
| D9 | Autenticação do agente no MCP por **SIWS direto** (endpoint novo), não `client_credentials` | `client_credentials` não tem segredo no nosso modelo (`token_endpoint_auth_methods_supported: none`). O SIWS reaproveita `oauth_tokens`, revogação e refresh. |

## 3. Pré-requisitos e regras do repositório

1. `AGENTS.md`: não mexer no programa; layout de conta existente não muda; nada de `unwrap/expect/panic` (não se aplica, o programa não muda).
2. **Nunca dar push antes do upgrade da devnet** (`docs/devnet-upgrade.md`). Esta frente não exige upgrade, mas o repositório tem commits de revenda ainda sem push.
   Trabalhar na branch **`feat/x402-agentes`** (criada da `master`), commits locais e **sem push**. Os commits só saem quando o usuário pedir.
3. Antes de qualquer deploy: ler `VPS_GUIDE.md (guia privado)` (PM2, nginx, portas, banco).
4. Chaves (`CUSTODY_KEYPAIR`) só em `.env.devnet`/segredos da VPS. Nunca em commit, log ou resposta de API.
5. Commits e push só quando o usuário pedir. Há alterações locais não relacionadas (`.codex/`, `docs/teste-manual/`, `output/`): não tocar.
6. Testes do servidor: `pnpm --filter @solvers/server test` (node:test, `test/*.test.ts`). Integração via scripts `e2e-*.ts` com servidor e Postgres no ar.

---

## 4. Fase 0 — Spikes (≈ 5 h)

Objetivo: fechar os 5 itens **[confirmar]** antes de escrever código de produção. Cada spike termina com uma linha de
resultado em `docs/x402-agentes.md` (seção 11) e uma decisão.

### 0.1 Compatibilidade de `@x402/svm` com `@solana/kit` 8.4 (≈ 1 h)

- Problema: o servidor usa `@solana/kit ^8.4.0` (`apps/server/package.json`, `packages/chain/package.json`). Os pacotes
  `@solana-program/token@0.9`, `token-2022@0.6.1` e `compute-budget@0.11` (dependências do `@x402/svm`) declaram peer `@solana/kit ^5.0` [spec/npm].
- Passos: numa pasta descartável dentro do scratchpad (fora do repo), `pnpm add @x402/core @x402/svm @x402/fetch @solana/kit@8.4`;
  conferir avisos de peer e se há duas cópias de `@solana/kit` (`pnpm why @solana/kit`); executar um `createKeyPairSignerFromBytes` e a
  montagem de um pagamento (ver 0.2).
- Aceite: instala sem erro de runtime e o pagamento é montado e assinado.
- Se falhar: (a) isolar o cliente x402 num pacote com `@solana/kit@5` (só `scripts/` e o agente de teste), e no servidor usar só
  `@x402/core` + verificação própria; ou (b) implementar o payload `exact` à mão (compute limit, compute price, `TransferChecked`, Memo,
  transação v0 parcialmente assinada). O servidor só precisa **ler** o payload, não montá-lo.

### 0.2 Pagar um 402 na devnet com o `x402.org/facilitator` (≈ 1,5 h)

- Passos: servidor mínimo (Express) com uma rota que responde 402; cliente com `wrapFetchWithPayment`; USDC de devnet; `GET /supported` do facilitator.
- Confirmar: (a) rede aceita `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; (b) **o facilitator aceita o nosso mint de USDC**
  (`USDC_MINT` do `.env.devnet`; o padrão do SDK é `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`); (c) o campo `extra.feePayer`
  que ele anuncia; (d) a ATA do `payTo` precisa existir antes; (e) o memo (`extra.memo`) é exigido e conferido; (f) latência do `settle`.
- Aceite: um pagamento liquidado, com `PAYMENT-RESPONSE` contendo `transaction` e `payer`.
- Se o mint não for aceito: **subir o facilitator próprio** (decisão já tomada, seção 0 e D7): `new x402Facilitator()` + `ExactSvmScheme`
  com o nosso `FEE_PAYER_KEYPAIR`, exemplo `examples/typescript/facilitator/basic`. Usar outro mint (o padrão do SDK) **não** resolve: a
  custódia precisa receber o mesmo USDC que o programa usa para pagar criador e tesouraria.
  Registrar na seção 11 qual caminho venceu: ele define `X402_FACILITATOR_URL` e o `accepts`.
- O facilitator próprio é um serviço pequeno (Express: `/verify`, `/settle`, `/supported`), pode rodar no mesmo processo do servidor
  numa rota interna (ex.: `/internal/x402-facilitator`, sem exposição pública no nginx) ou como processo à parte; decidir na spike.
  Não expor `/settle` publicamente sem autenticação: quem o chama gasta SOL do fee payer.

### 0.3 Superfície da API do servidor x402 (≈ 0,5 h)

- Confirmar nos pacotes instalados em 0.1 os nomes reais para: construir os requisitos de pagamento, codificar o header
  `PAYMENT-REQUIRED`, decodificar `PAYMENT-SIGNATURE`, chamar `verify` e `settle` do facilitator, e montar `PAYMENT-RESPONSE`.
  Ponto de partida: `x402ResourceServer` e `HTTPFacilitatorClient` de `@x402/core/server`, `ExactSvmScheme` de `@x402/svm/exact/server` [spec; nomes a confirmar].
- Decisão: usar o **middleware** `@x402/express` só se ele deixar plugar a ordem de passos da seção 6.4. Caso contrário
  (esperado), escrever o handler à mão com `verify` e `settle` do facilitator.

### 0.4 Tamanho e simulação de `purchase_license` + `TransferV1` (≈ 1 h)

- Conta feita à mão: ≈ 862 a 937 bytes contra o limite de 1232 (sem ALT) [inferência da auditoria].
- Passos: montar a transação (compute budget + `purchase_license` com a custódia como `buyer` + `TransferV1` para uma carteira de teste),
  `chain.simulate(wire)` (`chain.ts:344`), imprimir `unitsConsumed` e o tamanho em bytes.
- **Discriminador do `TransferV1`** do mpl-core: não existe builder em TypeScript no repositório (`chain.ts` só decodifica Core).
  Conferir contra o crate `mpl-core` usado nos testes Rust (`programs/solvers/tests/program.rs:553`, `TransferV1Builder`)
  e/ou contra a doc do Metaplex. O esperado é `14` + `Option<CompressionProof>` = `0`; **não assumir sem checar**.
- Contas do `TransferV1` (ordem do mpl-core): `asset`, `collection` (opcional, aqui obrigatória pois o asset é da coleção do solver),
  `payer`, `authority` (a custódia, dona do asset), `new_owner`, `system_program`, `log_wrapper`.
- Aceite: simulação `ok`, bytes ≤ 1232 com folga. Se estourar: enviar o transfer em uma segunda transação logo depois (ver 6.6, caminho B).

### 0.5 Custo e margem (≈ 0,5 h)

- Ler `fee_bps` e `min_price` reais da Config on-chain da devnet, o rent do asset Core e o custo de 3 assinaturas.
- Aceite: número escrito na seção 11 (taxa da plataforma em USDC por venda mínima vs. SOL gasto pela plataforma). Se o custo superar a
  taxa no preço mínimo, subir `X402_MIN_PRICE_USDC` acima de 5 USDC (o piso nunca fica abaixo do mínimo do programa).

---

## 5. Fase 1 — Usar a licença sem navegador (≈ 14 h)

Hoje o agente consegue o OAuth do MCP só com um keypair (`scripts/src/e2e-mcp.ts:18-91`: registro dinâmico, `/authorize` sem seguir o
redirect, nonce, assinatura SIWS, `/authorize/complete`, `/token`). Funciona, mas é um cliente de 70 linhas com PKCE e parsing de
`Location`. A fase 1 troca isso por **duas chamadas** e fecha os pontos em que um agente trava.

### 1.1 Endpoint de login do agente (≈ 4 h)

Arquivos: `apps/server/src/oauth/routes.ts`, `apps/server/src/auth/siws.ts`.

- `GET /oauth/agent/nonce?wallet=<base58>` →
  `createNonce(wallet, "agent", "Autorizar este agente a usar os especialistas do Solvers. Isto não autoriza pagamentos.")`
  (`siws.ts:51`). Usar `purpose = "agent"` para os nonces **não** serem intercambiáveis com os do fluxo do navegador (`"oauth"`).
  Resposta: `{ nonce, message, domain, issuedAt, expirationTime }`.
- `POST /oauth/agent/token` com `{ wallet, message, signature, memorySignature? }`:
  1. `verifySiws({ wallet, message, signature }, "agent")` (`siws.ts:120`) — valida domínio, carteira, rede, janela de 5 min, assinatura e consome o nonce.
  2. Se vier `memorySignature`: mesmo tratamento de `oauth/routes.ts:272-277` (`decodeVerifiedSignature` + `wrapKey(deriveMemoryKey(...))`). Sem ela, `get_memory`/`save_memory` respondem "Memória indisponível".
  3. `issueTokens("agent", wallet, wrapped)` (`routes.ts:126`). `clientId = "agent"`; `oauth_tokens.client_id` não tem chave estrangeira, não precisa de linha em `oauth_clients`.
  4. Resposta idêntica a `/oauth/token`: `{ access_token, token_type, expires_in, refresh_token, scope }`.
- Refresh: o agente usa `POST /oauth/token` com `grant_type=refresh_token`, `refresh_token` e `client_id=agent` (a validação de `refreshRejection` compara o `client_id`).
- Limites: o router já limita 60/min por IP (`routes.ts:145-154`). Acrescentar limite **por carteira** no `nonce` (ex.: 10/min) com `express-rate-limit` e `keyGenerator` = `req.query.wallet`.
- Anunciar o endpoint em `authorizationServerMetadata()` (campo não padrão `agent_nonce_endpoint` / `agent_token_endpoint`) e documentar no `docs/`.
- Aceite: de uma carteira nova, duas chamadas HTTP resultam em um token que passa em `initialize` e `tools/list` no `/mcp`.
- Testes: `apps/server/test/agent-auth.test.ts` (node:test) — (a) nonce de `"login"` ou `"oauth"` **não** vale em `/oauth/agent/token`; (b) nonce reutilizado falha; (c) assinatura de outra carteira falha; (d) refresh com `client_id=agent` funciona e o antigo é revogado.

### 1.2 O token sabe que é de agente (≈ 1 h)

- O access token é assinado com `signAccessToken(wallet, tokenId, clientId, ttl)` (`routes.ts:133`), então `clientId` já viaja no JWT. [confirmar o nome do claim em `auth/jwt.ts:27-35`]
- Em `mcp/routes.ts` (função `bearer`, linhas 27-43) acrescentar ao `McpContext` (`mcp/tools.ts:57`) o campo `isAgent: clientId === "agent"`.
- Aceite: um teste de unidade monta o contexto com cada tipo de token.

### 1.3 Sem teste grátis para agentes (≈ 2 h) — decisão confirmada (seção 0, item 5)

- `resolveAccess(wallet, agent, pkg, opts)` (`runtime/access.ts:103`) já tem `allowTrial`. Para agente: `allowTrial: false` e **novo motivo** `agent_no_trial` no tipo `Access` (hoje `retired` serviria, mas o texto ao usuário seria errado).
- Em `mcp/tools.ts` (trecho de `activate_solver`, ≈ 320-338), para `agent_no_trial` responder com a instrução de compra por x402 (1.5).
- Aceite: agente sem licença chama `activate_solver` e recebe as instruções de compra; **nenhuma linha** é criada em `trials`.

### 1.4 Guardas de compra (≈ 2 h)

Arquivo: `apps/server/src/store/routes.ts`, handler `POST /tx/purchase` (352-370). Reaproveitar nas rotas x402.

- `already_owned`: se `licenses` tem linha para (`wallet`, `agentId`) e `refreshLicenseOwner(id)` confirma o dono, responder **409** `code: "already_owned"` com `assetId`.
- `creator_cannot_buy`: se `wallet` é a carteira do criador do solver (coluna do criador em `agents`, `schema.ts:51-94`) responder **400**. Evita o erro de ATA duplicada (DEF-54 em `docs/teste-manual/06-defeitos-e-lacunas.md`).
- Extrair para `store/purchase-guards.ts` (`assertCanPurchase(wallet, agentRow)`), usado por `/tx/purchase` e pela rota x402.
- Testes: unitário para as duas regras; regressão do `/tx/purchase` para quem **não** tem licença (continua montando a transação).

### 1.5 Textos e respostas para agente nas tools do MCP (≈ 3 h)

Arquivo: `apps/server/src/mcp/tools.ts`. Os trechos que travam um agente (todos mandam falar com "o usuário") estão em ≈ 54, 235, 245, 327, 338, 557, 558, 576 e em `guarantee-text.ts`.

- Criar `purchaseInstructions(ctx, agentRow)`:
  - humano (`!ctx.isAgent`): comportamento atual (link `/checkout?...`).
  - agente: bloco estruturado e curto, por exemplo
    ```
    Para comprar (você é um agente com carteira Solana):
    POST {API}/api/x402/solvers/{agent_id}/license  → responde 402; pague em USDC (x402) e repita com PAYMENT-SIGNATURE.
    Rede: solana-devnet · preço: {price} USDC · a licença chega na sua carteira.
    Depois de pagar, chame activate_solver de novo.
    ```
- `find_solver`, `get_purchase_link` e o ramo "sem acesso" de `activate_solver` usam essa função.
- Nas etapas dos Solvers há 3 arquivos com "pergunte ao usuário" (`agents/backend-node/steps/01-guia.md`, `agents/frontend-react/steps/04-revisar.md`,
  `agents/ui-design/steps/04-handoff.md`; a busca pode ter deixado outros). Em vez de reescrever cada um: no cabeçalho devolvido por `next_step`
  para tokens de agente, incluir "Você é um agente autônomo. Onde a etapa pedir confirmação do usuário, decida pelo contexto e registre a suposição em `result_summary`." Revisar os 8 pacotes e anotar os que realmente exigem humano.
- `escalate_to_creator` e `submit_deliverable` ficam como estão (fase 3).
- Aceite: para um token de agente nenhuma resposta das tools contém "mostre ao usuário" nem `/checkout`.

### 1.5b Janela "pagou e ainda não vale" (≈ 2 h)

- `ownedAgents` (`runtime/access.ts:186`) lê só o banco. Para `list_my_solvers`: passar cada linha por `refreshLicenseOwner` (limitado a 20 licenças) e descartar as que mudaram de dono.
- `licenseOf` (`access.ts:20-42`) cai em `findLicenses` com timeout de 3 s e engole o erro. Mudar para retornar `unknown` quando o RPC falhar/estourar o tempo, e `activate_solver` responder "não consegui confirmar sua licença agora, tente de novo em instantes" em vez de mandar comprar.
- Na compra por x402 (fase 2) a licença já é gravada **antes** de responder 200, então a janela fecha no caso feliz.
- Aceite: simular `findLicenses` lento; `activate_solver` não sugere compra.

### 1.6 Cliente de referência do agente (≈ 2 h)

- `scripts/src/e2e-mcp.ts` já exporta `connect(signer)`, `rpc()` e `call()`. Criar `scripts/src/lib/agent-client.ts` com `connectAgent(signer, { memory })` (duas chamadas da 1.1) e reaproveitar `rpc`/`call`.
- Aceite: `pnpm tsx scripts/src/e2e-agent-use.ts` (carteira que já tem licença) lista, ativa, roda `next_step` e `run_tool`.

---

## 6. Fase 2 — Comprar por x402 (≈ 34 h)

### 6.1 Visão geral do fluxo

```
Agente                           Servidor (nosso)                   Facilitator           Solana
  | POST /api/x402/solvers/:id/license                                  |                    |
  |------------------------------->| cria ordem (preço travado)          |                    |
  |<-------------------------------| 402 + PAYMENT-REQUIRED (memo=order) |                    |
  | monta TransferChecked+Memo, assina                                   |                    |
  | POST ... + PAYMENT-SIGNATURE   |                                     |                    |
  |------------------------------->| valida ordem/termos/guardas         |                    |
  |                                |---- verify ------------------------>|                    |
  |                                |<--- ok (payer) ---------------------|                    |
  |                                | claim atômico da ordem              |                    |
  |                                |---- settle ------------------------>|------ tx USDC ---->|
  |                                |<--- success (tx, payer) ------------|<----- confirmed ---|
  |                                | custódia: purchase_license + TransferV1 (1 tx) ---------->|
  |                                | indexa; confere licença no banco    |                    |
  |<-------------------------------| 200 + PAYMENT-RESPONSE + licença    |                    |
  |        (se o mint falhar: custódia devolve o USDC ao pagador e responde 502 "refunded")      |
```

### 6.2 Modelo de dados — migration `0014_x402_orders.sql`

A última migration é `0013_listings_sold_unique.sql`. Gerar com `pnpm --filter @solvers/server db:generate` a partir do `schema.ts` e conferir o SQL.

Tabela `x402_orders` (`apps/server/src/db/schema.ts`, no estilo das demais):

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `ord_` + `randomId(12)`; é o `extra.memo` |
| `agent_id` | text not null | |
| `price` | u64 not null | USDC, 6 casas, **travado** na criação |
| `status` | text not null | `created`, `settling`, `paid`, `minting`, `minted`, `refunding`, `refunded`, `failed`, `expired` |
| `payer` | text null | preenchido no claim |
| `pay_signature` | text null, **unique** (índice parcial `where not null`) | assinatura do pagamento x402 |
| `mint_signature` | text null | gravada **antes** do envio (permite retomar) |
| `asset` | text null | endereço do NFT |
| `refund_signature` | text null | |
| `error` | text null | último erro legível |
| `expires_at` | timestamptz not null | criação + 15 min |
| `created_at`, `updated_at` | timestamptz | |

Índices: `status`, `payer`. Sem dados sensíveis.

### 6.3 Configuração (`apps/server/src/env.ts`)

| Variável | Tipo | Padrão | Uso |
|---|---|---|---|
| `X402_ENABLED` | bool | `false` | liga a rota |
| `X402_FACILITATOR_URL` | url | `https://x402.org/facilitator` | decidido na spike 0.2 |
| `X402_NETWORK` | string | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet) | rede do `accepts` |
| `CUSTODY_KEYPAIR` | string | — (obrigatória se `X402_ENABLED`) | JSON, base58 ou arquivo, como `FEE_PAYER_KEYPAIR` |
| `X402_MIN_PRICE_USDC` | número | 5 (mínimo do programa; sobe se a spike 0.5 exigir, nunca desce) | piso da rota |
| `X402_MAX_PRICE_USDC` | número | 100 | teto por ordem |
| `X402_ORDER_TTL_SECS` | número | 900 | |

- Validação: se `X402_ENABLED` e `SOLANA_CLUSTER === "mainnet-beta"` → **recusar a inicialização** (mensagem apontando a seção 9). Segue o padrão de `forbiddenMainnetKeys` (`env.ts:115-137`). Isso impede ligar custódia na mainnet por acidente antes do parecer jurídico.
- A carteira de custódia **não** pode ser a do fee payer, do verificador nem da autoridade de uso (distintas).
- `assertNotFeePayer` (`chain.ts:304`) já bloqueia o fee payer como carteira de usuário; incluir também a custódia (um agente não pode ser a custódia).
- Script `cli:x402-setup`: gera/valida o keypair, cria a **ATA de USDC da custódia** com o fee payer (a ATA do `payTo` precisa existir antes do primeiro pagamento [spec]) e imprime o endereço. Idempotente.

### 6.4 Endpoints (`apps/server/src/x402/routes.ts`, montado como `Mount` em `app.ts`)

Prefixo `/api/x402`. Entra no `costly` (`app.ts:73`) acrescentando o prefixo à lista. CORS e `optionalAuth` do `/api` não atrapalham (cliente não é navegador).

**`GET /api/x402/solvers/:idOrSlug`** — cotação pública, sem criar ordem:
```json
{ "agentId": "…32 hex…", "slug": "…", "name": "…", "priceUsdc": "12.5", "available": true,
  "network": "solana:…", "asset": "<mint>", "payTo": "<custódia>", "endpoint": "<API>/api/x402/solvers/<id>/license" }
```
Usa `findAgentRow` e `agentIsAvailable` (os mesmos de `store/routes.ts`).

**`POST /api/x402/solvers/:idOrSlug/license`** — corpo vazio (reservado). Duas formas:

*(a) Sem `PAYMENT-SIGNATURE`:*
1. `assertEntriesOpen("purchase")` (pausa de emergência) → 503 antes de qualquer ordem.
2. Agente disponível; `assertFreshPrice(row)` (`store/routes.ts:364`); preço dentro de `[X402_MIN_PRICE_USDC, X402_MAX_PRICE_USDC]`.
3. Criar ordem `created` com `price = row.price` e `expires_at`.
4. Responder **402**, header `PAYMENT-REQUIRED` (JSON em base64) e o mesmo JSON no corpo:
   ```json
   { "x402Version": 2, "error": "payment_required",
     "resource": { "url": "…/license", "description": "Licença vitalícia do Solver <nome>", "mimeType": "application/json" },
     "accepts": [{ "scheme": "exact", "network": "<X402_NETWORK>", "amount": "<price atômico>", "asset": "<USDC_MINT>",
                   "payTo": "<custódia>", "maxTimeoutSeconds": 60,
                   "extra": { "feePayer": "<do facilitator>", "memo": "<order_id>" } }] }
   ```
   `Cache-Control: no-store, private`. (Nomes e ordem dos headers conforme spec v2; confirmar em 0.3.)

*(b) Com `PAYMENT-SIGNATURE`:*
1. Decodificar o payload; ler `accepted.extra.memo` → `order_id`; carregar a ordem. Inexistente, `expired` ou fora de `created` → 409 `order_invalid` (nada é liquidado).
2. **Igualdade exata** entre `accepted` e a ordem: `amount == order.price`, `asset`, `payTo`, `network`, `memo`. Qualquer diferença → 400. (Conferir `>=` não basta.)
3. Preço fresco: se o preço on-chain mudou desde a criação da ordem → 409 `price_changed` (a ordem fica `expired`; o agente pede outra). Evita pagar e depois falhar no `expected_price`.
4. `verify` no facilitator → obtém `payer`. Falha → 402 com os mesmos requisitos.
5. Guardas com o `payer`: `payer` ≠ custódia/fee payer; `assertCanPurchase(payer, row)` (1.4) → `already_owned` ou `creator_cannot_buy` **antes de liquidar**.
6. **Claim atômico**: `update x402_orders set status='settling', payer=$payer where id=$id and status='created' returning *`. Zero linhas → 409 `order_in_use` (sem liquidar). Isso garante que **um pagamento por ordem** vença.
7. `settle`. Falha conclusiva → ordem volta a `created` se ainda válida (dinheiro não saiu) e responde 402. Resposta ambígua (timeout) → ordem **fica `settling`**; o reconciliador (6.8) decide.
8. Sucesso: gravar `pay_signature` (índice único: duplicata = 409 e **nenhuma** segunda emissão), status `paid`.
9. Emitir a licença (6.5/6.6). Sucesso → `minted` → **200**.
10. Falha na emissão → reembolso (6.7) → **502** `{ code: "mint_failed", refunded: true, refundSignature }`.

Resposta **200**:
```json
{ "agentId": "…", "asset": "<NFT>", "owner": "<payer>", "paymentSignature": "…", "mintSignature": "…", "next": "activate_solver" }
```
Header `PAYMENT-RESPONSE` (base64 do `SettlementResponse`: `{ success, transaction, network, payer }`) e `Cache-Control: no-store, private`.

### 6.5 Custódia no código (`packages/chain/src/chain.ts`)

- Nova opção de construtor/propriedade `custody: KeyPairSigner` (passada por `apps/server/src/chain/index.ts`, onde já se carrega o `feePayer`). Sem `CUSTODY_KEYPAIR` o método lança.
- Refatorar `purchaseLicenseIxs(buyer, agentIdHex, expectedPrice?)` (`chain.ts:746`) para aceitar `buyerSigner?: TransactionSigner` (hoje usa `createNoopSigner(buyer)`). Com a custódia, passar o `KeyPairSigner` real; `signTransactionMessageWithSigners` (`signServerTx`, `chain.ts:369`) assina com ele, com o fee payer e com o keypair do asset.
- Novo `transferCoreIx({ asset, collection, authority, newOwner })`: instrução `TransferV1` do mpl-core montada à mão (ver 0.4 para discriminador e contas). Testes de unidade conferem os bytes contra um vetor gerado pelo crate Rust.
- Novo `custodyMintFor(payer, agentIdHex, expectedPrice)` que devolve `{ asset, signed: SignedTx }` com **uma** transação: `[compute budget] + purchase_license(custódia) + TransferV1(custódia → payer)`.
  - Antes: confere que a ATA da custódia tem saldo ≥ preço (`usdcBalance`).
  - Depois de montar: `simulate(wire)` (`chain.ts:344`). `rejected` → não envia, vai direto ao reembolso. `infra` (RPC ruim) → segue o fail-open já usado em `store/tx-build.ts`.
- Novo `refundUsdc(payer, amount)`: `TransferChecked` da ATA da custódia para a ATA do pagador (o pagador **já** tem ATA, pois pagou dela). Assinado pela custódia, fee payer da plataforma.

### 6.6 Emissão (`apps/server/src/x402/mint.ts`)

Passo a passo, com recuperação:

1. Marcar a ordem `minting` e gravar `asset` e `mint_signature` **antes** de enviar (a assinatura é conhecida porque `signServerTx` assina sem enviar).
2. `chain.sendSigned(signed)`. Se a resposta for ambígua, `sendSigned(signed, { resume: true })` retransmite e espera o desfecho (`chain.ts:395`).
3. `processSignature(signature)` (indexador) — o `LicensePurchased` chama `syncLicense`, que lê o **dono atual on-chain** (`indexer/sync.ts:88-111`). Como o `TransferV1` está na mesma transação, o dono lido já é o pagador; não há corrida.
4. Conferir no banco: `licenses.id == asset` e `owner_wallet == payer`. Se faltar, `syncLicense(asset, agentId, signature)` direto. Só então `minted`.
5. **Caminho B** (se a spike 0.4 mostrar que não cabe): `purchase_license` numa transação e `TransferV1` em outra, logo depois. Entre as duas a licença está na custódia. A ordem só vira `minted` quando o dono on-chain for o pagador; um job retoma ordens `minting` com o NFT ainda na custódia.

### 6.7 Reembolso

- Gatilhos: simulação `rejected` na emissão, falha definitiva do envio, ou ordem `paid`/`minting` parada por mais de 2 minutos.
- Ação: status `refunding` → `refundUsdc(payer, order.price)` → grava `refund_signature` → `refunded`. Chave de idempotência = a própria ordem: só reembolsa se `status in ('paid','minting','refunding')` e `refund_signature is null`; transição atômica para `refunding` antes de enviar.
- Se o NFT chegou a ser criado e o reembolso foi feito, é incoerente: antes de reembolsar, conferir on-chain se `asset` existe. Se existe e o dono é o pagador, **não reembolsar** (marcar `minted`).
- Falha do reembolso (RPC, saldo) → permanece `refunding`, alerta no log (`error`) e retentativa pelo job. Nunca descartar.

### 6.8 Reconciliação mínima (`apps/server/src/x402/reconcile.ts`)

Job simples, no padrão de `jobs.ts` (liberação automática), a cada 60 s, flag `X402_ENABLED`:

1. Ordens `created` vencidas → `expired`.
2. Ordens `settling` por mais de 2 min: consultar a transação de pagamento no facilitator/RPC. Pagou → segue para `paid`; não pagou → `created` (se vigente) ou `expired`.
3. Ordens `paid`/`minting` paradas → retomar (6.6) ou reembolsar (6.7).
4. Ordens `refunding` → repetir o reembolso.
5. Log estruturado de cada transição (`order`, `from`, `to`, `signature`).

A reconciliação completa (cruzar todas as transferências recebidas pela custódia com ordens, para achar pagamento **sem** ordem) fica para a fase 4.

### 6.9 Indexador: atribuição quando o comprador é a custódia

Arquivo: `apps/server/src/indexer/processor.ts:238-246` (`LicensePurchased`).

- Hoje: `syncReputation(ev.data.buyer)` e `recordChainTx(..., ev.data.buyer, ...)` usam o `buyer` do evento (a custódia).
- Mudança: `const owner = await syncLicense(...)` (já devolve o dono); se `ev.data.buyer` é o endereço da custódia, gravar `chain_txs.wallet = owner` (histórico do agente) e **não** chamar `syncReputation` para a custódia. Como o histórico de `/me/profile` filtra por `chain_txs.wallet` (`routes.ts:198`), a compra do agente passa a aparecer.
- Endereço da custódia: `chain().custody.address` (ou `null` se x402 desligado).
- Testes: dois casos no teste do processador — compra normal (inalterada) e compra com `buyer == custódia`.
- Efeito colateral conhecido (fase 3): `UserReputation.purchases` do agente não sobe, então ele fica no nível `limited` de garantia (20 USDC; acima de 10 USDC exige ≥ 2 etapas — `shared/rules.ts:45-81`).

### 6.10 Anti-abuso da rota

1. Prefixo no `costly` (20/min por IP).
2. Teto de preço por ordem e piso (`X402_MIN/MAX_PRICE_USDC`).
3. Limite de **ordens abertas** por IP (ex.: 20 em `created`) e limpeza das vencidas — a rota sem pagamento escreve no banco.
4. Respostas pagas com `Cache-Control: no-store, private` (risco de cache servir a licença a quem não pagou [spec]).
5. A custódia **nunca** paga nada que não seja (i) `purchase_license` de uma ordem `paid` e (ii) reembolso ao pagador da própria ordem. Nenhuma rota recebe endereço de destino do cliente.
6. Nunca logar o payload de pagamento completo nem chaves.

### 6.11 Testes

Unitários (`apps/server/test/`, node:test):
- `x402-orders.test.ts`: máquina de estados (transições permitidas e proibidas; claim concorrente → só um vence); igualdade exata de requisitos (amount, asset, payTo, network, memo); expiração.
- `x402-refund.test.ts`: idempotência (duas chamadas, um reembolso); não reembolsa se o NFT existe e é do pagador.
- `chain` (`packages/chain/src/*.test.ts`): bytes do `TransferV1` contra vetor de referência; `purchaseLicenseIxs` com signer real e com `NoopSigner` (regressão).
- `agent-auth.test.ts` (1.1).

Integração (devnet, manual, servidor + Postgres no ar), `scripts/src/e2e-agent.ts` — o script da definição de pronto:
1. Carteira nova; USDC via `/api/faucet` (exige JWT web: `POST /api/auth/verify` com `returnToken: true`; `FAUCET_ENABLED=true`).
2. `GET /api/x402/solvers/:id` (cotação).
3. `POST /license` com cliente x402 → 200; conferir `owner == carteira` on-chain (`fetchCoreAsset`).
4. `connectAgent` (1.1) → `list_my_solvers` mostra o Solver como comprado.
5. `activate_solver` → `access = license`; `next_step`; `run_tool`.
6. Repetir o passo 3 → **409 `already_owned`** (sem cobrança).
7. Falha induzida: ordem com `expected_price` desatualizado (alterar o preço on-chain entre o 402 e o pagamento) → `409 price_changed`, nenhum USDC movido.
8. Falha de mint induzida (feature flag de teste ou preço mudado após o settle) → `502 mint_failed refunded: true`, saldo do agente volta ao original.

### 6.12 Deploy na devnet (depois de aprovado; ler `VPS_GUIDE.md` antes)

1. Gerar `CUSTODY_KEYPAIR` (carteira nova, **não reutilizar** nenhuma existente), `cli:x402-setup` para criar a ATA.
2. Variáveis no `.env.devnet` da VPS: `X402_ENABLED=true`, `X402_FACILITATOR_URL`, `CUSTODY_KEYPAIR`.
3. Migration 0014 (`db:migrate`) antes de subir o processo novo.
4. PM2: reiniciar só o processo do servidor. Rota em `/api`, então **sem mudança de nginx**.
5. Rollback: `X402_ENABLED=false` e reiniciar (a rota deixa de existir; ordens pendentes seguem reconciliadas ao religar). A migration é aditiva.

---

## 7. Ordem de execução e esforço

| Passo | Conteúdo | Depende de | Horas |
|---|---|---|---|
| 0.1 a 0.5 | Spikes | — | 5 |
| 1.1 | Login SIWS do agente | — | 4 |
| 1.2, 1.3 | Token de agente; sem trial | 1.1 | 3 |
| 1.4 | Guardas de compra | — | 2 |
| 1.5, 1.5b | Textos das tools; janela de acesso | 1.2, 1.4 | 5 |
| 1.6 | Cliente de referência | 1.1 | 2 |
| 6.2, 6.3 | Migration, env, setup da custódia | spikes | 3 |
| 6.5 | `custody`, `transferCoreIx`, `refundUsdc` | 0.4 | 8 |
| 6.4, 6.6 | Rota e emissão | 6.2, 6.5, 0.2, 0.3 | 10 |
| 6.7, 6.8 | Reembolso e reconciliação mínima | 6.6 | 6 |
| 6.9 | Indexador | 6.5 | 2 |
| 6.10 a 6.12 | Anti-abuso, testes, deploy | todos | 5 |
| **Total** | | | **≈ 55 h** |

Caminho crítico: 0.1 → 0.2 → 0.4 → 6.5 → 6.6. A fase 1 pode andar em paralelo com a 0.

Paralelização sugerida: um responsável pelas spikes + fase 2; outro pela fase 1 (arquivos diferentes, sem conflito).

## 8. Riscos abertos

1. **Facilitator não aceita o nosso mint** de USDC na devnet → facilitator próprio (+4 a 6 h).
2. **Conflito `@solana/kit` 8 × peers do `@x402/svm`** → pacote isolado ou payload à mão (+2 a 4 h).
3. **Transação não cabe** (improvável, ≈ 300 bytes de folga) → caminho B de 6.6.
4. **Custódia é chave quente** com USDC de terceiros em trânsito. Mitigação: saldo operacional ≈ zero (entra e sai na mesma operação), teto por ordem, monitoramento, rota desligável por flag.
5. **Margem fina** (rent + 3 assinaturas vs. taxa sobre o preço mínimo) → piso de preço da rota (spike 0.5).
6. **Pausa de entradas entre pagar e mintar** deixa o dinheiro preso → mitigado checando antes do 402 e reembolsando automaticamente.
7. **O login do agente é invenção nossa** (sem spec MCP ou x402 que o cubra); clientes MCP genéricos (Claude, ChatGPT) não o descobrem sozinhos. Serve a clientes próprios.
8. **Facilitator externo é dependência**: fora do ar = sem compra por x402 (a compra normal da vitrine continua).

## 9. Bloqueio de mainnet (jurídico) — registrar, não resolver aqui

Com dinheiro real a custódia deixa de ser detalhe técnico. Pontos para um advogado e o contador, **antes** de ligar `X402_ENABLED` na mainnet
(o código recusa por padrão, seção 6.3):

1. Manter USDC de terceiros, mesmo por segundos, pode ser enquadrado como transmissão de dinheiro ou prestação de serviço de ativos virtuais, conforme a jurisdição (Brasil incluído; esta pesquisa não aprofundou o Brasil).
2. Os documentos de revenda dizem "sem custódia" (`programs/solvers/src/instructions/resale.rs:1`, `docs/resale.md`) e a conta de impostos do contador (item C do `NEXT_STEPS.md`) parte dessa premissa.
3. Origem do dinheiro: hoje não há KYC nem triagem de carteiras sancionadas.
4. Pagamento x402 é irreversível; reembolso é transferência nova. Precisa de política de reembolso e termos (texto do advogado ainda pendente, `NEXT_STEPS.md:26`).
5. Quem é o comprador: o contrato é com a pessoa ou empresa dona do agente; o servidor hoje não registra aceite de termos na compra (só o checkbox do front, `CheckoutView.tsx:294-295`).

## 10. Backlog (fases 3 e 4), para não perder

Revenda via custódia (`buy_listing` + `TransferV1`, ≈ 6 h); nível de garantia calculado no servidor a partir de licenças próprias (4 a 6 h);
SDK/CLI e tools MCP de transação (12 a 20 h); ajuda ao criador com canal de resposta e limite (6 a 8 h); `llms.txt`, OpenAPI e extensão
`bazaar` (6 a 8 h); aceite de termos assinado (4 a 8 h); reconciliação completa e limites por carteira/dia (6 a 8 h); on-ramp de USDC em mainnet;
registro no Metaplex Agent Registry; CIMD no OAuth (o registro dinâmico foi marcado como deprecado na spec MCP 2026-07-28).

## 11. Resultados das spikes (preencher na fase 0)

| Spike | Resultado | Decisão |
|---|---|---|
| 0.1 kit 8 × `@x402/svm` | `@x402/core`, `@x402/svm`, `@x402/fetch` 2.28.0 instalam com `@solana/kit` 8.4.0: só avisos de peer (`@solana/kit ^5.0`, `@solana/sysvars ^5.0`); `pnpm why` mostra **uma única cópia** do kit. `ExactSvmScheme` instancia com um `KeyPairSigner` do kit 8 e o pagamento é montado e assinado (02/10/2026). | Usar o kit 8.4 direto, sem pacote isolado. Os avisos de peer são esperados. |
| 0.2 facilitator e mint | `x402.org/facilitator` anuncia `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` com `extra.feePayer = CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5`. Com o **nosso** `USDC_MINT` (`4Ut3Yn…`): `verify` válido, `settle` ok em ~1,4 s, custódia recebeu 5 USDC (tx `LsAjQLgs…`). **Pegadinha do cliente:** `x402Client` recusa mint fora da lista padrão e limita US$ 1 por pagamento (`spendControls`). | **Facilitator público basta; não precisa de facilitator próprio** (D7 não é acionado). O cliente do agente precisa de `x402Client.fromConfig({ schemes, spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network, asset: USDC_MINT, maxAmountPerPayment: "100000000" }] } })`; documentar para quem escrever agentes. |
| 0.3 API do servidor x402 | Nomes reais em `@x402/core` 2.28: servidor `x402ResourceServer` (`buildPaymentRequirements`, `createPaymentRequiredResponse`, `verifyPayment`, `settlePayment`), `HTTPFacilitatorClient` (`verify`, `settle`, `getSupported`); cliente `x402Client` (`createPaymentPayload`), `x402HTTPClient` (`encodePaymentSignatureHeader`, `getPaymentRequiredResponse`, `getPaymentSettleResponse`). | Handler à mão com `HTTPFacilitatorClient.verify/settle` (ordem da seção 6.4); sem middleware. |
| 0.4 tamanho, simulação, discriminador do `TransferV1` | Discriminador do crate `mpl-core 0.12.1` (`transfer_v1.rs`): **14**, argumento `Option<CompressionProof>` (None = `0`) → dados `[14, 0]`. Contas: asset (w), collection, payer (w, signer), authority (signer), new_owner, system_program, log_wrapper (o próprio mpl-core no lugar quando ausente). Devnet em 02/10/2026: Config v2, 6 solvers ativos (preço 7 a 19 USDC). **Validado na devnet com `custodyMintFor`:** transação única (compute budget + `purchase_license` com a custódia + `TransferV1` custódia → pagador) = **862 bytes** (limite 1232), `simulate` ok com **71.592 CU**, envio em ~1,2 s, evento `LicensePurchased`, dono on-chain = pagador, coleção correta, USDC da custódia caiu exatamente o preço. Reembolso `refundUsdcTx` conferido. A custódia compra como `buyer`, então o programa cria a `UserReputation` dela (por isso a seção 6.9 importa). | `transferCoreIx` e `custodyMintFor` em `packages/chain`; **caminho B (duas transações) não é necessário.** |
| 0.5 custo e piso de preço | Devnet: `feeBps = 1000` (10%), `minPrice = 5 USDC` → taxa da plataforma no preço mínimo = **0,50 USDC**. Custo medido de uma emissão x402 (tx `4hmFANnN…`): **15.000 lamports de taxa (3 assinaturas) + 3.577.720 de rent do asset Core ≈ 0,0036 SOL por venda**; a taxa do pagamento do agente é do facilitator (não sai da plataforma). Só a assinatura extra da custódia (5.000 lamports) é custo novo em relação à compra normal. Equilíbrio no preço mínimo: ≈ 0,50 USDC ÷ 0,0036 SOL ≈ US$ 139 por SOL (mesma conta de qualquer compra de 5 USDC, regra do `CLAUDE.md`). | Piso mantido em 5 USDC (`X402_MIN_PRICE_USDC`); reavaliar na mainnet conforme o preço do SOL. |

## 12. Fontes

Código: `programs/solvers/src/instructions/{purchase,resale,review,escrow}.rs`; `packages/chain/src/chain.ts`;
`apps/server/src/{app,env}.ts`, `store/routes.ts`, `oauth/routes.ts`, `auth/siws.ts`, `mcp/{routes,tools}.ts`, `runtime/access.ts`, `indexer/{processor,sync}.ts`;
`scripts/src/{e2e-mcp,e2e-full,e2e-purchase}.ts`; `docs/teste-manual/06-defeitos-e-lacunas.md`; `NEXT_STEPS.md`.

Spec e docs (consultadas em 01/10/2026): `github.com/x402-foundation/x402` (`specs/x402-specification-v2.md`, `specs/schemes/exact/scheme_exact_svm.md`,
`specs/transports-v2/{http,mcp}.md`, `specs/extensions/payment_identifier.md`), `docs.cdp.coinbase.com/x402`, `docs.payai.network`,
`solana.com/docs/payments/agentic-payments/intro-to-x402`, `modelcontextprotocol.io/specification/latest/basic/authorization`,
`arxiv.org/html/2605.11781v1` (ataques ao x402).

## 13. Estado da implementação (02/10/2026)

Worktree `.claude/worktrees/x402-agentes`, branch `feat/x402-agentes`, **sem commit e sem push**.

**Feito e validado na devnet** (`scripts/src/e2e-agent.ts`, 9 passos, de carteira nova e sem SOL): cotação; 402 com ordem de preço travado;
pagamento adulterado (valor menor, ordem inexistente) recusado sem mover USDC; compra em ~6 s com a licença na carteira do agente e débito
exato; ordem `minted`; login SIWS do agente, `list_my_solvers`, `activate_solver` (acesso por licença), `next_step`, `run_tool`; segunda
compra `409 already_owned` sem cobrança; emissão que falha depois do pagamento → `502 mint_failed refunded` e saldo de volta.
Também validado com pagamento real: queda do servidor depois do settle (ordem `settling`) → o reconciliador achou o pagamento pela cadeia
(memo = id da ordem), emitiu a licença ao pagador e fechou a ordem numa rodada.

| Parte | Onde |
|---|---|
| Rota (cotação, 402, pagamento, estado da ordem) | `apps/server/src/x402/routes.ts` |
| Regras puras (estados, igualdade de requisitos, limites, decisão de reembolso) | `x402/rules.ts` |
| Ordens no banco (transições atômicas, lease) e migration `0014_x402_orders.sql` | `x402/orders.ts`, `db/schema.ts` |
| Emissão com transação gravada antes do envio | `x402/mint.ts` |
| Reembolso idempotente (nunca com emissão ainda possível) | `x402/refund.ts` |
| Reconciliação (job de 60 s) | `x402/reconcile.ts`, `jobs.ts` |
| Facilitator (interface + cliente HTTP) | `x402/facilitator.ts` |
| Custódia, `transferCoreIx`, `custodyMintFor`, `refundUsdcTx` | `packages/chain/src/chain.ts` |
| Config, recusa na mainnet e de chave repetida | `env.ts`, `chain/index.ts` |
| Indexador (histórico no dono, sem reputação da custódia) | `indexer/processor.ts` |
| Setup da custódia | `pnpm --filter @solvers/server cli:x402-setup` (`--generate <arquivo>`) |
| Fase 1 (login do agente, sem teste grátis, guardas, textos) | `oauth/`, `mcp/`, `runtime/access*.ts`, `store/purchase-guards.ts`, `docs/agentes-login.md` |

**Testes:** `x402-rules.test.ts`, `x402-env.test.ts`, `x402-orders.db.test.ts` (banco descartável; claim concorrente, assinatura única), `packages/chain/src/x402.test.ts`
e os da fase 1. Suíte do servidor: 541 testes, 0 falhas (os `*.db.test.ts` com `TEST_DATABASE_URL`).

**Diferenças em relação ao plano (decididas na implementação):**
1. `GET /api/x402/orders/:id` (novo): quem recebe `202` (`payment_pending` ou `mint_pending`) consulta o estado.
2. Resposta `202` quando o settle é ambíguo (timeout) ou a emissão ainda não terminou: o dinheiro não fica sem dono, a reconciliação conclui.
3. O `verify` roda **antes** de `assertCanPurchase` (o pagador só é conhecido depois do `verify`). Consequência: um agente que já tem a licença **e não tem saldo** para pagar de novo recebe `402` (simulação do facilitator falha) em vez de `409 already_owned`. Com saldo, recebe `409` sem cobrança. Possível melhoria: ler o pagador direto do payload antes do `verify`.
4. `X402_TEST_FAIL_MINT` (só para o e2e): faz a emissão falhar depois do pagamento para provar o reembolso. Padrão `false`; nunca ligar de verdade.
5. Cliente x402 do agente: o SDK recusa por padrão qualquer mint fora da lista dele e pagamentos acima de US$ 1. O agente precisa de `x402Client.fromConfig({ schemes, spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network, asset: USDC_MINT, maxAmountPerPayment: "100000000" }] } })` (ver `scripts/src/e2e-agent.ts`).
6. A `UserReputation` da custódia é criada pelo programa (ela é a `buyer`); o indexador não a espelha.

**Pendente:**
1. Deploy na devnet (6.12): gerar a `CUSTODY_KEYPAIR` da VPS, `cli:x402-setup:devnet`, variáveis no `.env.devnet`, migration 0014 antes do processo novo. **Ler o `VPS_GUIDE.md` antes.**
2. E2E do cenário `price_changed` (exige a chave do criador para `update_pricing`); hoje só há cobertura por leitura de código.
3. Teste de rota com facilitator falso (o fluxo completo só roda no e2e da devnet).
4. Parecer jurídico da custódia antes de qualquer mainnet (seção 9); o código recusa `X402_ENABLED` na mainnet.
5. Commit: nada foi commitado.

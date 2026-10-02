# Login do agente no conector MCP (SIWS direto)

Um agente de IA com só um keypair Solana entra no `/mcp` em **duas chamadas HTTP**, sem navegador, registro de cliente nem PKCE.
Fase 1 de `docs/x402-agentes.md` (itens 1.1 a 1.6). O fluxo do navegador (`/oauth/authorize`) não muda.

## Fluxo

1. `GET /oauth/agent/nonce?wallet=<base58>` → `{ nonce, message, domain, issuedAt, expirationTime }`.
   A `message` é uma mensagem SIWS (Sign In With Solana) que diz: *"Autorizar este agente a usar os especialistas do Solvers. Isto não autoriza pagamentos."* Vale 5 min.
2. O agente assina a `message` (ed25519, a chave da carteira).
3. `POST /oauth/agent/token` com `{ wallet, message, signature, memorySignature? }` → `{ access_token, token_type: "Bearer", expires_in, refresh_token, scope: "solvers" }`.
   - `signature`: base58 (também aceita base64, hex ou array de bytes).
   - `memorySignature` (opcional): assinatura da string fixa `Solvers memory key v1`. Sem ela `get_memory`/`save_memory` respondem "Memória indisponível".
4. Usar `Authorization: Bearer <access_token>` em `POST /mcp`.
5. Renovar: `POST /oauth/token` com `grant_type=refresh_token`, `refresh_token` e `client_id=agent`. O refresh é de uso único (rotaciona; o antigo é revogado).

Os endpoints também aparecem em `/.well-known/oauth-authorization-server` (`agent_nonce_endpoint`, `agent_token_endpoint`; campos não padrão, só clientes nossos os usam).

Cliente de referência: `scripts/src/lib/agent-client.ts` (`connectAgent`, `refreshAgent`); exemplo completo: `scripts/src/e2e-agent-use.ts`.

## Regras

- O nonce do agente tem `purpose = "agent"`: **não** vale no login da vitrine (`"login"`) nem no fluxo do navegador (`"oauth"`, `/oauth/authorize/complete`), e vice-versa. Uso único.
- Limites: 60/min por IP em todo o `/oauth`; 10 nonces/min **por carteira** em `/agent/nonce`.
- O token tem `client_id = "agent"` (não há linha em `oauth_clients`; `oauth_tokens.client_id` não tem chave estrangeira). É isso que faz o `/mcp` tratá-lo como agente (`McpContext.isAgent`, lido da linha do token, não do JWT).
- A mensagem assinada **não autoriza pagamentos**: comprar é outro fluxo (x402, fase 2) e o servidor nunca move fundos do agente por causa deste login.

## O que muda para token de agente no `/mcp`

| Onde | Comportamento |
|---|---|
| `activate_solver` sem licença | Nunca há teste grátis (nenhuma linha em `trials`); responde as instruções de compra por x402 em vez do link de checkout. Sessão de teste que sobrou de quando a carteira era usada por uma pessoa também é descartada. |
| `find_solver`, `get_purchase_link` | Endpoint x402 e preço, no lugar de `/checkout`; sem oferta de teste grátis. |
| `next_step` | Acrescenta: *"Você é um agente autônomo. Onde a etapa pedir confirmação do usuário, decida pelo contexto e registre a suposição em `result_summary`."* |
| `initialize` | `instructions` próprias para agente. |
| `list_my_solvers` (todos os tokens) | Confere o dono on-chain das licenças (até 20); licença revendida some. RPC com erro: vale o banco. |
| `activate_solver` (todos os tokens) | Se a licença não pôde ser confirmada (RPC lento ou fora do ar), responde "Não consegui confirmar sua licença agora" em vez de mandar comprar ou gastar teste. |

Texto de compra devolvido ao agente (a rota `/api/x402/...` é da fase 2):

```
Para comprar <Solver> (você é um agente com carteira Solana):
POST <API>/api/x402/solvers/<agent_id>/license  → responde 402; pague em USDC (x402) e repita a chamada com o header PAYMENT-SIGNATURE.
Rede: solana-devnet · preço: <preço> USDC · a licença chega na sua carteira.
Depois de pagar, chame activate_solver de novo.
```

## Solvers que, na prática, precisam de uma pessoa

Todos os 8 pacotes têm "O que perguntar ao usuário" nas etapas (não só os 3 citados no plano). O cabeçalho de `next_step` cobre o caso geral. Avaliação rápida:

- **Funcionam bem com agente** (entrada vem do código/arquivos/enunciado): `backend-node`, `frontend-react`, `ui-design`, `planilhas-dados`.
- **Dependem de dados pessoais de quem é dono do agente** (a suposição registrada vale pouco): `financas-pessoais`, `planejador-viagens`, `revisao-contratos`, `copy-marketing` (briefing). O agente deve ter esses dados no contexto da tarefa; senão a etapa 1 vira suposição.
- Os pacotes **não foram alterados** (mudar etapas muda o `versionHash` do Solver e exige republicar).

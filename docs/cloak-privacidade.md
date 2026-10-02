# Saque privado do criador (Cloak) — Privacy Sprint nº 0001

Recurso opt-in do painel do criador: move USDC da carteira para outro endereço **sem o explorador ligar os dois**, e gera a "chave do contador" (leitura do histórico). Usa o pool blindado do [Cloak](https://docs.cloak.ag) na **mainnet**. O resto do Solvers continua na devnet; este módulo conversa com a rede real por conta própria.

Desafio: <https://privacy.superteam.com.br/> (envio até **sáb 03/10, 23:59 BRT**).

## Por que este caso de uso (e o limite honesto)

- A receita do criador já é pública por design (`Agent.total_sales` × preço): isso dá confiança aos compradores e não muda.
- O que o Cloak esconde é **o que o criador faz depois**: para onde o dinheiro vai, o valor de cada saque e o saldo acumulado na carteira de vendas.
- Não esconde: as vendas, o uso do Cloak, valor e horário (num pool pequeno, valores e horários parecidos podem sugerir a ligação) e o que o próprio Cloak vê (a chave de visualização é registrada no relay dele; nada de chave vai para a blockchain).
- O lado do **comprador** (licença em carteira nova) seria mais forte, mas exige o Solvers na mainnet. Fica como próximo passo.
- Zcash ficou de fora: não há ponto natural no Solvers.

## O que foi construído

| Parte | Onde |
|---|---|
| Regras puras (taxa 0,45 USDC + 0,3%, valor mínimo 1 USDC, validações) + testes | `packages/shared/src/cloak.ts`, `cloak.test.ts` |
| Módulo do navegador (chaves, depósito, saque, retomada, relatório) | `apps/web/src/lib/cloak/{config,history,withdraw}.ts` |
| Tela e aba "Saque privado" | `apps/web/src/components/creator/PrivateWithdraw.tsx`, `app/criador/saque-privado/page.tsx`, `CreatorHead.tsx` |
| `WalletLike.signTransaction(tx, { network: "mainnet" })` (o Privy assina na rede certa) | `packages/api-client/src/index.ts`, `lib/wallet/privy.tsx` |
| Spike (script) | `scripts/src/cloak-spike.ts` |
| Mesmo módulo do navegador rodando no Node com dinheiro real | `scripts/src/cloak-web-flow.ts` |
| Relatório do contador por linha de comando | `scripts/src/cloak-report.ts` |

Como funciona: (1) uma assinatura da carteira (`"Solvers private withdrawal key v1"`, ed25519 determinístico) é transformada em chaves do pool, então a mesma carteira refaz tudo em qualquer aparelho, sem nada para guardar; (2) o USDC é depositado no pool (nota recuperável); (3) o saque sai do pool para o destino, enviado pelo relay do Cloak. Cada etapa fica no histórico local (`localStorage`) antes da seguinte, e um saque interrompido depois do depósito pode ser concluído pela tela ("Concluir saque").

## Como ligar

Em `apps/web/.env.local` (build-time; sem isso a aba e a página não existem):

```
NEXT_PUBLIC_CLOAK_ENABLED=1
NEXT_PUBLIC_CLOAK_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<chave restrita ao domínio>
```

- O RPC público da Solana limita o ritmo (HTTP 429, o depósito chegou a falhar no meio) e bloqueia navegadores. Use uma chave Helius **restrita ao domínio**: ela fica visível no bundle.
- A carteira precisa de **USDC e ~0,005 SOL na mainnet** no mesmo endereço do criador (o endereço aparece na tela). O USDC de teste do Solvers não vale aqui.
- Nada disto roda no `master`/produção sem a variável. O push no `master` publica sozinho: ligue só quando decidir.

## Teste manual no navegador (ainda não executado)

O módulo foi provado no Node com dinheiro real (abaixo) e a tela compila e passa no typecheck e no `next build`. O teste **no navegador** (prova zk no browser, assinatura do Privy, CORS do RPC e dos circuitos) não foi feito porque a automação do navegador foi bloqueada. Roteiro:

1. `pnpm --filter @solvers/web dev` com as duas variáveis acima e a API local no ar (`API_DEV_URL`).
2. Entre no painel do criador → aba **Saque privado**. Confira o endereço e o aviso "Rede real".
3. Envie ~3 USDC e 0,01 SOL (mainnet) para o endereço mostrado e clique em **Atualizar**.
4. Digite 1 (ou 2) USDC e um endereço de destino **dedicado** (outra carteira sua). O resumo mostra taxa e quanto o destino recebe.
5. **Sacar em privado**: o Privy pede a assinatura das chaves e depois assina o depósito. Leva ~1 min. Esperado: etapas viram ✓ e aparecem os links do depósito e do saque.
6. Abra os dois links no Solscan: o saque não contém a carteira de origem.
7. **Copiar chave do contador** e **Baixar relatório (CSV)** (leva alguns minutos): devem aparecer o depósito, o saque e a taxa.
8. Se algo falhar depois do depósito, a tela mostra "Saque pela metade" com **Concluir saque**.

Pontos a vigiar no primeiro teste real: erro de CORS ao baixar os circuitos (`storage.googleapis.com/cloak-circuits`), o Privy aceitar `signTransaction` com `chain: solana:mainnet` para a transação v0 do depósito, e o tempo/memória da prova no celular.

## Provas na mainnet (02/10/2026)

| Teste | Depósito | Saque | Resultado |
|---|---|---|---|
| Spike (`cloak-spike.ts`), 2 USDC | [3hCHPhbA…](https://solscan.io/tx/3hCHPhbAoXJjQ327HTeR82aSyp2pcSeSHUxBcu9GRDDpTwmT8dnM1grLnNHq4J6kudDCay2yejHoHwwWSkkku25D) | [5TRuDWx1…](https://solscan.io/tx/5TRuDWx1Ep52zLY5Qead9FhxHsMwNrKYwtEjbhf6Cg6pDaUkNuzbg3sTRfhu8nSk9ZZv9ewXdUvyKSCu1pCcqV8u) | destino recebeu 1,544 USDC (taxa 0,456) |
| Módulo do navegador no Node (`cloak-web-flow.ts`), 1 USDC | [DcFyh9u9…](https://solscan.io/tx/DcFyh9u9b8TmXZBf8gway7DcG4kfCqHcvQpABmrb4bXE6ycQKDNHGJECKSdeZUHg9bhGvF8yqmc56UUzQQLtRyw) | [46ncAqcR…](https://solscan.io/tx/46ncAqcRoFTUgcACT7ptsamwQTJbMuDfvd4hKgL8V9QE3sceoreqGi4eMdHbPz2NkmF3HBvmSZxwKTF4skaFUZqw) | destino recebeu 0,547 USDC (taxa 0,453); depósito + saque em ~56 s; chaves derivadas iguais em duas assinaturas |

A transação de saque tem como pagador de taxa o relay do Cloak e não contém a carteira de origem (conferido nas contas da tx).

## Armadilhas conhecidas

- **Relatório incompleto.** O `scanTransactions` pula em silêncio o que o RPC recusa. Uma leitura chegou sem o depósito. A tela e o `cloak-report.ts` (`CLOAK_EXPECT`) repetem a leitura até aparecerem as transações conhecidas.
- **O saque só é reconhecido pela conta de destino.** O relatório lista todo saque do pool que chegou ao destino, inclusive de outras pessoas; use um destino dedicado, senão o saldo acumulado do relatório fica estranho (negativo).
- A doc `llms.txt` do Cloak mostra `@solana/web3.js`; o SDK 0.2.5 usa `@solana/kit`. O relay é fixo no build do SDK: não há como ensaiar num fork local (Surfpool não serve).
- Depósito mínimo de USDC: 1,00. Saque: 0,45 USDC + 0,3%, e o valor precisa passar da taxa.
- O Cloak é alfa, de código fechado e sem auditoria publicada: valores pequenos, tela limitada a 1.000 USDC por saque.

## Relatório do contador por linha de comando

```bash
cd scripts
SOLANA_RPC_URL=<mainnet> CLOAK_NK=<chave do contador, 64 hex> CLOAK_DESTINATION=<destino> \
  [CLOAK_EXPECT=<assinatura1,assinatura2>] npx tsx src/cloak-report.ts > relatorio.csv
```

## Material de entrega

**Checklist:** repositório público (ou acesso para os revisores) · assinatura(s) de tx da mainnet (tabela acima) · vídeo de até 2 min · texto de privacidade (até 300 palavras, abaixo).

### Texto de privacidade (PT, ~280 palavras)

**Solvers + Cloak: saque privado para criadores**

O Solvers é um marketplace de especialistas de IA. Quando um criador vende uma licença, o USDC cai direto na carteira dele, na blockchain. As vendas são públicas de propósito: dão confiança aos compradores. O problema vem depois. Quem abre o explorador vê o saldo acumulado do criador e para onde ele manda o dinheiro: uma exchange com cadastro, um fornecedor, outra carteira. Isso expõe o criador a golpes e extorsão e entrega custos e fornecedores aos concorrentes.

Com o Cloak, o criador clica em "Sacar em privado". O valor entra no pool blindado e sai para o endereço de destino numa transação enviada pelo relay do Cloak, que não contém a carteira de origem. No explorador aparecem um depósito e um saque, sem ligação entre eles.

**O que fica escondido:** a ligação entre a carteira de vendas e o destino, e o saldo que o criador guarda. **De quem:** concorrentes, clientes e qualquer pessoa com um explorador. **O que se ganha:** o criador decide quem enxerga. A "chave do contador" é só de leitura e gera o relatório completo (CSV) para o contador ou a Receita, sem dar acesso ao dinheiro. Privacidade que não impede a prestação de contas.

**O que não escondemos:** a receita (pública por design), o uso do Cloak, valor e horário (num pool pequeno podem sugerir a ligação) e a chave de visualização, que o Cloak recebe ao registrá-la. O Cloak está em alfa e sem auditoria publicada; por isso o recurso é opt-in e limitado a 1.000 USDC por saque.

Provas: dois ciclos reais de depósito e saque na mainnet, com links no repositório.

### Privacy text (EN, ~260 words) — for the main Colosseum submission

**Solvers + Cloak: private payouts for creators**

Solvers is a marketplace of AI specialists. When a creator sells a license, the USDC lands straight in their wallet on-chain. Sales are public on purpose: they build trust with buyers. The problem comes after. Anyone with an explorer sees the creator's accumulated balance and where the money goes: a KYC'd exchange, a supplier, another wallet. That exposes creators to scams and extortion and hands their costs and suppliers to competitors.

With Cloak, the creator clicks "Withdraw privately". The amount enters the shielded pool and leaves to the destination address in a transaction submitted by Cloak's relay, which does not contain the source wallet. The explorer shows a deposit and a withdrawal with nothing linking them.

**What stays hidden:** the link between the sales wallet and the destination, and the balance the creator holds. **From whom:** competitors, customers, anyone with an explorer. **What is gained:** the creator decides who can see. The "accountant key" is read-only and produces the full report (CSV) for an accountant or the tax authority, without giving access to the funds. Privacy that does not block accountability.

**What we do not hide:** revenue (public by design), the use of Cloak, amount and timing (in a small pool, similar values and times can hint at the link), and the viewing key, which Cloak receives when it is registered. Cloak is alpha with no published audit, so the feature is opt-in and capped at 1,000 USDC per withdrawal.

Proof: two real deposit-and-withdraw cycles on mainnet, linked in the repository.

### Roteiro do vídeo (≤ 2 min)

1. **0:00–0:15 — Problema.** Painel do criador com ganhos (rede de teste). "As vendas são públicas de propósito. Mas o saldo e o destino do dinheiro também ficam à vista de todos." Mostre a carteira no explorador.
2. **0:15–0:30 — Rede.** Aba **Saque privado**. Diga em uma frase: "O Solvers roda numa rede de testes; este recurso usa a rede real, com poucos dólares."
3. **0:30–1:15 — Saque.** Digite 1 USDC e o destino; mostre taxa e valor recebido; **Sacar em privado**; as etapas andando (~1 min). Mostre os dois links.
4. **1:15–1:40 — Prova.** Solscan do saque: sem a carteira de origem. Solscan do depósito e do destino: sem ligação.
5. **1:40–2:00 — Contador.** **Baixar relatório (CSV)** (use um relatório já gerado para não esperar). "O contador vê tudo; o público, nada. E o limite: a receita continua pública, o Cloak é alfa, comece pequeno."

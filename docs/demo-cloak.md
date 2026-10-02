# Demo do saque privado (Cloak): passo a passo

Mostra, em ~2 min, um criador tirando dinheiro para outro endereço **sem o explorador ligar os dois**. Roda na **rede real (mainnet)** com dinheiro de verdade (poucos dólares). O resto do Solvers continua na rede de teste.

## 1. Antes de começar (uma vez)

1. Use o **Edge deste computador**, no mesmo perfil de sempre. A carteira da demo fica guardada nele, em `localhost:3100`. **Não limpe os dados do navegador.**
2. A carteira da demo é `5tWCPjvj5HRZt98E6AuFSCeYMj2ZK6x5jQb6TfohiX58`. Precisa de **pelo menos 1,5 USDC e 0,005 SOL** na rede real (o mínimo do saque é 1 USDC). Se o saldo estiver abaixo, peça para eu reabastecer a partir da carteira descartável.
3. O destino da demo é um endereço novo e vazio, só para isto: `3BPaX7nSag3Q5daGsYkZBpqn8nfkPRfiSS5YcCmNEeQf`. Ele é novo de propósito: o relatório do contador lista tudo o que chegou ao destino, então um endereço limpo mostra só o saque da demo.

## 2. Ligar o ambiente (~1 min)

No terminal, na pasta do projeto, na branch `feat/cloak-privacy`:

```
git switch feat/cloak-privacy
pnpm install
bash scripts/cloak-demo.sh
```

- Espere aparecer **`Ready`**. O script sobe a API de mentira (porta 3018) e o site (porta 3100) e lê a chave do RPC de `apps/server/.env.devnet`.
- Se a chave estiver em outro lugar: `HELIUS_KEY=<chave> bash scripts/cloak-demo.sh`.
- Para parar tudo: `Ctrl+C` no terminal.

## 3. Roteiro da demo (o que clicar e o que dizer)

Abra <http://localhost:3100/criador/saque-privado>. A primeira abertura demora uns segundos (o site compila).

1. **Entrar.** Clique em **Entrar**. A carteira aparece no topo (`5tWC…iX58`).
   *Fale:* "Sou o criador. Minhas vendas caem nesta carteira e qualquer pessoa vê."
2. **Mostrar a tela.** Aponte o aviso **"Rede real · dinheiro de verdade"** e os saldos.
   *Fale:* "Aqui é a rede real. As vendas continuam públicas de propósito, é o que dá confiança ao comprador. O que eu quero proteger é o que faço com o dinheiro depois."
3. **Preencher.** Em **Valor** digite `1.5`. Em **Endereço de destino** cole `3BPaX7nSag3Q5daGsYkZBpqn8nfkPRfiSS5YcCmNEeQf`. Aparece o resumo: retira 1,50, taxa ~0,4545, destino recebe ~1,0455.
4. **Sacar.** Clique em **Sacar em privado**. As 4 etapas viram ✓ em ~1 min: *Preparando as suas chaves → Protegendo o valor → Enviando ao endereço de destino → Concluído*.
   *Fale durante a espera:* "A prova de que o dinheiro é meu é gerada aqui no navegador. As chaves vêm de uma assinatura da carteira, então não há nada para guardar."
   *Dica de vídeo:* corte ou acelere esse minuto na edição.
5. **Provar.** No **histórico** da própria tela, abra o link **saque** (Solscan) e depois o **depósito**. Mostre:
   - **Saque:** o assinante é o relay do Cloak e a sua carteira **não aparece** na transação.
   - **Depósito:** a sua carteira entrega o valor ao pool, sem destino à vista.
   *Fale:* "Quem olha de fora vê um depósito e um saque. Nada liga um ao outro."
6. **Chave do contador.** Volte à tela e clique em **Baixar relatório (CSV)**. Leva alguns minutos: se for filmar, comece a leitura **antes** de gravar, ou mostre o CSV já pronto (seção 5 abaixo).
   *Fale:* "Posso dar esta chave ao meu contador: ele vê o histórico dos saques e não consegue mexer no dinheiro. Eu escolho quem vê."
7. **Honestidade.** Abra **"O que isso esconde, e o que não esconde"**.
   *Fale:* "Não esconde as vendas, nem que usei o Cloak, nem valor e horário em um pool pequeno. É alfa: comece com valores pequenos."

## 4. Como verificar depois (links prontos)

| O quê | Link |
|---|---|
| Carteira do criador (demo) | <https://solscan.io/account/5tWCPjvj5HRZt98E6AuFSCeYMj2ZK6x5jQb6TfohiX58> |
| Destino da demo | <https://solscan.io/account/3BPaX7nSag3Q5daGsYkZBpqn8nfkPRfiSS5YcCmNEeQf> |

As transações da demo ao vivo aparecem no histórico da tela (links **depósito** e **saque**). Na página de cada transação confira:

1. **Result:** SUCCESS e Finalized.
2. **Saque → Signer:** é o relay do Cloak, não a carteira do criador.
3. **Saque → Transfer:** do pool para o destino, com o valor líquido e a taxa.
4. **Depósito → Signer:** a carteira do criador, transferindo ao pool do Cloak.

## 5. Se der algo errado: provas já prontas (02/10/2026)

Se a internet, o RPC ou o Cloak falharem na hora, use estas transações reais, já finalizadas. As capturas estão em [`cloak-provas/`](cloak-provas/).

| Teste | Depósito | Saque |
|---|---|---|
| **Demo gravada** (1,5 USDC; destino novo recebeu 1,0455) | [2Nxee79M…](https://solscan.io/tx/2Nxee79MY2QSuRHYyF3Xe6d9cwG7vdWxuLNqvMZXjPaicbHrjVqZwxbPmEtd1frDgYTGP2dLstzTkHzwjBJ6TnAm) | [56oD83Cx…](https://solscan.io/tx/56oD83CxfMYXmYkS4QFSq24Aj1s9bbMi1oWa78FW3izW1M2N1vZU1YpmbUiMtJa71suJ6oSYe5qSFLgtXLqEeTzY) |
| **Pela tela, no navegador** (1,5 USDC; destino recebeu 1,0455) | [4SsjRq7V…](https://solscan.io/tx/4SsjRq7VWCqnNjMrC3YHizARgkkJLfj3L7hdkxVeW6h6KgkKQHYByj75Dk2Z2pySaEjoUvr3CjWcCR9AP6bqUyG8) | [2uFKzi9t…](https://solscan.io/tx/2uFKzi9tT59dzmZunReyDVkdo9PPUiLH6RjfqAb2swfJMQRY3XEsTeeaJVu2Md746BbWvYHqVjk3eoJCgidYFKU6) |
| Módulo no Node (1 USDC; destino recebeu 0,547) | [DcFyh9u9…](https://solscan.io/tx/DcFyh9u9b8TmXZBf8gway7DcG4kfCqHcvQpABmrb4bXE6ycQKDNHGJECKSdeZUHg9bhGvF8yqmc56UUzQQLtRyw) | [46ncAqcR…](https://solscan.io/tx/46ncAqcRoFTUgcACT7ptsamwQTJbMuDfvd4hKgL8V9QE3sceoreqGi4eMdHbPz2NkmF3HBvmSZxwKTF4skaFUZqw) |
| Spike (2 USDC; destino recebeu 1,544) | [3hCHPhbA…](https://solscan.io/tx/3hCHPhbAoXJjQ327HTeR82aSyp2pcSeSHUxBcu9GRDDpTwmT8dnM1grLnNHq4J6kudDCay2yejHoHwwWSkkku25D) | [5TRuDWx1…](https://solscan.io/tx/5TRuDWx1Ep52zLY5Qead9FhxHsMwNrKYwtEjbhf6Cg6pDaUkNuzbg3sTRfhu8nSk9ZZv9ewXdUvyKSCu1pCcqV8u) |

Relatório da demo gravada (3 linhas: 2 depósitos da carteira e o saque ao destino novo): [`cloak-provas/07-relatorio-contador-demo.csv`](cloak-provas/07-relatorio-contador-demo.csv). Outro exemplo, baixado pela tela: [`cloak-provas/06-relatorio-contador-exemplo.csv`](cloak-provas/06-relatorio-contador-exemplo.csv) (lista também os saques antigos porque o destino foi reaproveitado; com o destino novo da demo, só aparece o da demo). Cada linha tem tipo (depósito/saque), valor, taxa, destinatário e assinatura.

## 6. Cuidados

- É dinheiro de verdade: cada saque custa **0,45 USDC + 0,3%** de taxa, e o mínimo é 1 USDC.
- Se a tela mostrar **"Saque pela metade"**, o depósito já foi: clique em **Concluir saque** e não tente de novo do zero.
- Esta branch **não vai para o `master`** sem decisão: o push no `master` publica sozinho. O recurso só existe com `NEXT_PUBLIC_CLOAK_ENABLED=1`.
- Detalhes técnicos, limites e o texto de privacidade: [`cloak-privacidade.md`](cloak-privacidade.md).

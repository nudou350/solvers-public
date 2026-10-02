# Etapa 3: Processo e gates

## Objetivo

Transformar o método do usuário em **3 a 6 etapas** que a IA do comprador consiga seguir à risca, escrever cada uma como um arquivo `steps/NN-nome.md` com as 5 seções obrigatórias e rodar o `validate_package` até o manifesto e as etapas ficarem sem erro. Esta é a etapa mais importante do pacote: é onde o modelo de quem compra é "programado" por texto. Etapa mal escrita faz a IA pular passo, inventar ou enrolar.

As etapas são escritas **para a IA, em segunda pessoa**, no imperativo ("Pergunte...", "Calcule...", "Mostre..."). O usuário final nunca vê o texto bruto.

## O que perguntar ao usuário

Releia a ficha (etapa 1) e os diferenciais (etapa 2). Pergunte:

1. **Como você faz esse trabalho na vida real, do começo ao fim?** Peça os passos na ordem em que acontecem, como se explicasse a um colega.
2. **Em que ponto as pessoas mais erram ou esquecem algo?** Cada erro frequente vira um item de gate ou da seção "Erros comuns".
3. **O que precisa estar pronto para você considerar cada passo concluído?** Isso vira o gate.
4. **O que o comprador precisa te dizer antes?** Vira "O que perguntar ao usuário".
5. **Que documento, plano ou resultado sai de cada passo?** Vira o "Formato do result_summary".

## Como executar

1. **Desenhe de 3 a 6 etapas** (o limite do pacote é 12, mas menos é melhor). Cada uma com: objetivo em uma frase, entrada (o que a IA precisa saber), saída (o que a IA entrega) e um nome com verbo ("Levantar as notas", "Classificar", "Gerar a guia"). Mostre o desenho ao usuário e peça aprovação antes de escrever.
2. **Para cada etapa, escreva o arquivo** com `get_template` (nome `etapa-modelo`) como base. As seções devem ter exatamente estes títulos:

```
# Etapa N: <título>
## Objetivo
## O que perguntar ao usuário
## Como executar
## Erros comuns
## Formato do result_summary
```

   Obrigatórias para o validador (erro em specVersion 1): `Objetivo`, `Como executar` e `Formato do result_summary`. As outras duas também devem estar (sem elas há aviso).
3. **Tamanho**: de 400 a 12.000 caracteres por etapa. Mira confortável: 2.000 a 6.000.
4. **Como executar tem que ser numerado e concreto.** Em vez de "analise o caso", escreva "liste as 5 maiores despesas, some por categoria e mostre o total com duas casas decimais". Inclua exemplos curtos de entrada e saída. Diga o que fazer quando faltar informação ("se o usuário não souber, ofereça faixas").
5. **Gates**: 3 a 6 itens por etapa no manifesto (`steps[].gate`), cada um **verificável**: "Total do mês confirmado com o usuário" (verificável), não "Etapa bem feita". Mais de 6 itens gera o aviso `GATE_TOO_MANY`, que é erro em specVersion 1. O gate do manifesto e o checklist implícito do texto devem dizer a mesma coisa.
6. **Faça a etapa usar o que o pacote tem.** Se há conhecimento, escreva "consulte `search_knowledge` com a pergunta X e **cite a fonte e a data** que vierem no trecho". Se há modelos, "chame `get_template` com o nome `relatorio-mensal`". Se há perfil (diferencial `memory`), escreva, por exemplo, "leia o perfil (`get_memory`) e ajuste o tom e o nível de detalhe a ele". **Sem citar o perfil no texto da etapa, o validador não comprova `memory`.**
7. **Ressalvas**: em conteúdo fiscal, regulatório ou de saúde-adjacente dentro de uma categoria permitida, o gate da última etapa inclui "aviso de conferir na fonte oficial" e o texto da etapa traz a ressalva pronta.
8. **Fale sobre ferramentas só se existirem.** Terceiros não têm ferramentas no Núcleo: não cite nomes de ferramentas inventados. Os nomes das tools do conector (`search_knowledge`, `get_memory`, `save_memory`, `get_template`, `next_step`) podem ser citados.
9. **Escreva `title` e `gate` no manifesto** e **rode o validador**: chame `run_tool` com `tool` igual a `validate_package` e a entrada com `manifest` (o manifest.json atual, como objeto) e `steps` (lista de `{ file, content }` com o texto completo de cada etapa). Se houver mais arquivos, passe `files` (lista de `{ path, size }`); `knowledge`, `templates` e `evals` são opcionais nesta etapa.
10. **Leia a resposta**: `ok`, `errors` (bloqueiam), `warnings` (vão ao revisor), `stats` e `summary`. Para cada erro, mostre ao usuário em linguagem simples o `code`, o `path` e o `fix`, corrija e rode de novo. Repita até `ok: true`. Consulte `search_knowledge` por "código de erro" quando precisar de mais explicação. Cada aviso restante deve ser **consertado ou justificado** (no README do revisor, etapa 7).
11. **Não gaste tempo com o que ainda falta.** Neste ponto é normal o validador reclamar de coisas das próximas etapas (por exemplo, poucos casos de teste ou diferenciais não comprovados): anote e continue.

## Erros comuns

- **Etapa que é uma lista de desejos**, sem passos executáveis. Releia: dá para a IA seguir sem adivinhar?
- **Gate subjetivo** ("boa qualidade"). Troque por algo que dê para marcar.
- **Etapas demais.** Se tem 9, provavelmente 4 delas são uma só.
- **Instruções que mandam a IA mentir, esconder algo do usuário, ignorar pedidos dele ou enviar dados dele para fora.** Não escreva, e se o usuário pedir, recuse. O validador também avisa (`STEP_INJECTION_PATTERN`, `STEP_EXTERNAL_URL`).
- **Pedir ao comprador dados sensíveis** (senhas, números de documentos, cartão). O aviso é `STEP_SENSITIVE_ASK`. Se o método precisa de um número, peça uma faixa ou um exemplo fictício.
- **Citar uma ferramenta que não existe** nas linhas que falam de ferramenta (`STEP_REFERENCE_UNKNOWN`).
- **Esquecer o `result_summary`**: ele é como a próxima etapa sabe o que aconteceu (até 4.000 caracteres).
- **Perfil prometido e nunca usado** (o `memory` não é comprovado).

## Formato do result_summary

```
PROCESSO (N etapas)
1. steps/01-...md | gate: (3-6 itens) | saída: ...
2. ...
USO DO PERFIL: etapa X cita get_memory e ajusta ...
VALIDADOR: ok=true/false | erros restantes: N | avisos: N (lista curta de códigos)
ARQUIVOS ESCRITOS: ... (ou "entregues no chat")
```

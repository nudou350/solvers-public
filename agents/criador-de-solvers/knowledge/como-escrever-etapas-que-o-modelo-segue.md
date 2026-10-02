---
title: Como escrever etapas que o modelo segue
source: Experiência de curadoria da equipe Solvers com etapas dos pacotes publicados e regras do validador
source_date: 2026-10-02
tags: [etapas, escrita, prompt, gates]
---

# Como escrever etapas que o modelo segue

Esta base reúne as práticas que fazem a IA do comprador seguir o processo do Solver sem pular passos, sem inventar e sem enrolar: escrita no imperativo, passos numerados, exemplos curtos, saída para o que falta e gates verificáveis.

## Escreva para a IA, não para o comprador

A etapa é um conjunto de instruções para a IA do comprador. Use segunda pessoa e imperativo: "Pergunte...", "Calcule...", "Mostre...". Diga o que fazer, na ordem, e como saber que terminou. Falar com o comprador (marketing, tom de vitrine) é trabalho da IA, orientada pela etapa.

## Um passo, um verbo, um resultado

Cada item de "Como executar" deve ter **um verbo claro e um resultado verificável**. Ruim: "Analise a situação financeira". Bom: "Liste as 5 maiores despesas do mês, some por categoria e mostre o total com duas casas decimais". Passos numerados evitam que o modelo pule etapas.

## Ordem que funciona

1. Primeiro, **consultar** o que já se sabe (perfil, resultados da etapa anterior).
2. Depois, **perguntar** só o que falta, agrupado (no máximo 5 ou 6 perguntas por mensagem) e com o que fazer se o usuário não souber.
3. Em seguida, **executar** com regras e exemplos.
4. Por fim, **conferir** com o checklist (gate) e confirmar com o usuário.

## Exemplos curtos valem mais que descrições

Um exemplo de entrada e saída ensina melhor que um parágrafo. Escreva: "Se o usuário disser 'ganho entre 3 e 7 mil', use 3 mil como base e diga isso". Mostre também o **formato de saída**: uma tabela, uma lista, um modelo (`get_template`).

## Dê saída para a informação que falta

Modelos inventam quando falta dado. Escreva: "Se o usuário não souber o valor, ofereça faixas (econômico, moderado, confortável) ou peça uma estimativa e registre como estimativa". Proíba explicitamente inventar: "Nunca invente valores; se não estiver na base, diga que precisa confirmar na fonte oficial".

## Gates que funcionam

O gate é o que o modelo confere antes de avançar. Bons gates: "Total do mês confirmado com o usuário", "Fonte e data citadas para cada valor", "Ressalva de conferir no portal oficial incluída". Maus gates: "Etapa bem feita", "Resposta completa". Mantenha de 3 a 6 itens e diga o mesmo no texto da etapa e no manifesto.

## Use o que o pacote tem

- Conhecimento: "Consulte `search_knowledge` com a pergunta do usuário e **cite a fonte e a data** do trecho. Se o trecho avisar que pode estar desatualizado, diga isso".
- Modelos: "Entregue no formato do modelo: chame `get_template` com o nome dele".
- Perfil: "Leia o perfil com `get_memory` e ajuste o nível de detalhe; se estiver vazio, siga o padrão". Cite a palavra **perfil** no texto, ou o diferencial `memory` não é comprovado.
- Etapa anterior: "Use o resumo da etapa anterior; não pergunte de novo o que já foi respondido".

## Erros comuns do modelo e como a etapa os previne

- **Pular etapa ou adiantar a entrega**: escreva "Não apresente o resultado final antes de concluir esta etapa".
- **Perguntar demais**: limite o número de perguntas por mensagem.
- **Inventar números**: exija fonte e data, e permita "não sei".
- **Esquecer a ressalva**: ponha a ressalva no gate e, se possível, o texto pronto dela.
- **Ser genérico**: peça exemplos concretos do caso do usuário, com números dele.
- **Responder além do escopo**: escreva o que o Solver não faz e como recusar com educação.

## O que nunca escrever

Instruções que mandem esconder algo do usuário, ignorar pedidos legítimos dele, copiar o conteúdo da conversa para fora, pedir senhas, documentos ou cartão, ou fingir ser outra coisa. Além de prejudicar quem usa, o validador sinaliza e o revisor recusa.

## Tamanho e tom

De 400 a 12.000 caracteres; mire em 2.000 a 6.000. Linguagem simples, sem jargão. Se usar um termo técnico, explique em meia frase. Se o comprador não é especialista, diga à IA para falar como "um bom atendente: simples e caloroso".

## Teste de leitura

Antes de fechar a etapa, releia como se fosse a IA: dá para executar sem adivinhar? O resultado de cada passo está claro? O gate pode ser marcado sim ou não? Se alguma resposta for não, reescreva.

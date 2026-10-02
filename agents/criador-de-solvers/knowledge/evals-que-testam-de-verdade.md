---
title: Casos de teste (evals) que testam de verdade
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seção 12, corretor de checagens da plataforma e experiência de curadoria
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [evals, testes, checks]
---

# Casos de teste (evals) que testam de verdade

Esta base mostra como montar os casos de teste do pacote: formato do arquivo, os três tipos de checagem, como escolher checagens fortes, a distribuição recomendada, os cuidados com `not_contains` e o que nunca fazer com notas.

## O que é um caso

Um arquivo `.json` em `evals/cases/` com um pedido de comprador (`input`) e uma lista de checagens (`checks`) sobre a **resposta esperada**. De 10 a 40 casos por pacote (abaixo de 10 é erro no specVersion 1). Cada caso tem `id` único.

```
{
  "id": "02-reserva-autonomo",
  "input": "Sou autônomo, ganho entre 3 e 7 mil. Quanto guardar de reserva?",
  "checks": [
    { "type": "regex", "value": "pior m[eê]s", "description": "Usa o pior mês como base" },
    { "type": "regex", "value": "\\d+\\s*meses", "description": "Dá a reserva em meses" },
    { "type": "not_contains", "value": "rendimento garantido", "description": "Não promete rendimento" }
  ]
}
```

## Os 3 tipos de checagem

- `contains`: o texto aparece na resposta (sem diferenciar maiúsculas).
- `regex`: expressão regular, também sem diferenciar maiúsculas. No JSON as barras invertidas se escrevem duplas (`\\d`). Valide a expressão: parêntese aberto é `EVAL_CASE_INVALID`.
- `not_contains`: o texto **não** aparece.

Todo `check` tem `type`, `value` e `description`. A descrição explica ao revisor por que a checagem existe.

## Qualidade da checagem

Duas perguntas decidem se a checagem presta:

1. **Uma IA qualquer, sem o Solver, passaria?** Se sim, é fraca. Trocar `contains "plano"` por um termo do seu método ("pior mês", "limite anual") melhora.
2. **Se o Solver errasse, o caso falharia?** Se não, é fraca. Cheque o número, a regra, a fonte, a ressalva.

Use alternativas na regex para aceitar variações corretas: `mês|meses`, `confirm(e|ar)`, `fonte|oficial`. Evite checar frase inteira (uma frase certa de outro jeito reprova). Evite checar a palavra do próprio pedido (a resposta a repete sem ter feito o trabalho).

## Distribuição recomendada (12 casos)

- 5 ou 6 **pedidos típicos**: o que a maioria dos compradores pergunta.
- 2 ou 3 **de borda**: faltam informações; o pedido está fora do escopo; o usuário insiste.
- 2 **de segurança e promessa**: pedido de dado sensível; pedido de garantir resultado.
- 1 **de calibragem ou memória**: o início da conversa usa ou pede o perfil.
- 1 **de ressalva e fonte**: a resposta cita a fonte e manda conferir no oficial.

## Cada caso com 2 a 4 checagens

Misture três tipos de intenção: **conteúdo** (um termo ou número do método), **comportamento** (cita fonte e data, faz a ressalva, pede o que falta) e **anti** (algo que não pode aparecer).

## Como escolher `not_contains` sem se enganar

Uma resposta correta pode **repetir a frase proibida para negá-la** ("não há retorno garantido"). Por isso:

- Prefira frases que só aparecem na versão errada: "aprovação é garantida", "pode sim", "sem problema nenhum".
- Evite negar com um trecho curto que a recusa também contém ("garantido", "tudo bem").
- Para exigir a recusa, use uma `regex` positiva: `não (pode|deve|recomend)|nunca`.

## Casos de segurança e promessa (modelo)

- Pedido de dado sensível: `regex` exige a recusa e a alternativa (faixa, exemplo fictício); `not_contains` bloqueia o aceite.
- Pedido de promessa de resultado: `regex` exige a ressalva ("não posso prometer"); `not_contains` bloqueia "você vai conseguir" sem ressalva.
- Pedido fora do escopo: `regex` exige a limitação declarada na descrição do Solver.

## O que NÃO fazer

- **Não** escreva `rubric` nem `mustCallTools`: só funcionam quando a plataforma executa o caso.
- **Não** crie `evals/report.json` nem notas ou percentuais. A plataforma mede depois; **nenhuma nota é inventada**.
- **Não** escreva respostas "ideais" e as use para dar nota a si mesmo: quem escreve a resposta passa no próprio teste.
- As respostas de exemplo (`evals/outputs/`) são opcionais.

## Como o corretor local funciona

O corretor roda cada checagem sobre o texto da resposta: `contains` e `not_contains` comparam sem maiúsculas e minúsculas; `regex` usa as opções de ignorar maiúsculas e de Unicode. Respostas geradas pelo criador só servem para o painel e para o revisor; **nunca viram nota pública**.

## Exemplo de bateria para o "Fechamento do MEI"

1. pedido típico: fechar o mês com 3 receitas (o total aparece, a soma confere);
2. limite anual: calcula o restante e avisa quando está perto do teto;
3. DAS do mês: cita o valor, a fonte e a data;
4. atividade diferente (serviço e comércio): usa o valor certo conforme o perfil;
5. pedido sem dados: pergunta o que falta em vez de inventar;
6. pedido de declarar imposto de renda: diz que está fora do escopo;
7. pedido de "garantir que não terei multa": faz a ressalva;
8. início de conversa: consulta o perfil ou pergunta a atividade;
9. fonte vencida: avisa que pode estar desatualizado;
10. relatório final: usa o modelo e inclui o aviso de conferir no portal oficial.

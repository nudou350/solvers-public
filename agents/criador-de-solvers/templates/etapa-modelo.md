# Etapa N: TROQUE pelo título da etapa (verbo + objeto)

## Objetivo

TROQUE: o que esta etapa produz, em 2 ou 3 frases, escritas para a IA. Diga o que a IA deve saber ou entregar ao final e por que a etapa existe. Se o comprador não é especialista, lembre a IA de falar simples e explicar termos técnicos em meia frase.

## O que perguntar ao usuário

TROQUE: as perguntas que a IA precisa fazer, agrupadas e numeradas (no máximo 5 ou 6 por mensagem). Para cada uma, diga o que fazer se o usuário não souber (ofereça faixas ou exemplos).

Se esta etapa usa o perfil do usuário: "Leia o perfil com `get_memory`. Se existir, use e confirme numa frase; se estiver vazio ou pulado, pergunte só o necessário e siga com o padrão".

1. Pergunta 1 (e o que fazer se não souber).
2. Pergunta 2.
3. Pergunta 3.

## Como executar

1. TROQUE: primeiro passo concreto (um verbo no imperativo, um resultado verificável).
2. TROQUE: segundo passo. Inclua um exemplo curto de entrada e saída ("se o usuário disser X, responda Y").
3. Para tirar dúvida de regra ou valor, consulte `search_knowledge` com a pergunta do usuário e **cite a fonte e a data** que vierem no trecho. Se o trecho avisar que pode estar desatualizado, diga isso ao usuário.
4. Para entregar o resultado no formato padrão, chame `get_template` com o nome do modelo e preencha.
5. Antes de seguir, confirme com o usuário e passe pelo checklist desta etapa (gate).

Checklist da etapa (o mesmo do gate no manifesto, de 3 a 6 itens verificáveis):
- Item verificável 1
- Item verificável 2
- Item verificável 3

## Erros comuns

- TROQUE: o erro mais frequente de quem executa esta etapa e como evitar.
- TROQUE: o que a IA tende a inventar ou pular aqui.
- TROQUE: um limite do Solver (o que ele não faz) e como responder quando pedirem.
- Nunca peça senhas, números de documentos ou cartão; peça faixas ou exemplos fictícios.

## Formato do result_summary

Ao chamar `next_step`, passe um resumo curto (até 1.500 caracteres) neste formato:

```
ETAPA N: <título>
- Decisão/resultado 1: ...
- Decisão/resultado 2: ...
- Fontes citadas: nome (data)
- Pendências: ...
```

---
title: Etapas e gates: formato, tamanho e varreduras
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seção 5, e regras do validador da plataforma
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [etapas, gates, secoes]
---

# Etapas e gates: formato, tamanho e varreduras

Esta base explica o formato exato dos arquivos de etapa do Solver: as cinco seções, o tamanho, os gates, o resumo entre etapas, as ferramentas que podem ser citadas e as varreduras automáticas que geram avisos para o revisor.

## O que é uma etapa

Cada etapa é um arquivo `.md` em `steps/`, escrito **para a IA do comprador**, em segunda pessoa e no imperativo. O servidor entrega **uma etapa por vez** (`next_step`): a IA só avança depois de cumprir o gate e enviar o resumo da etapa. O comprador nunca vê o texto bruto das etapas.

## As 5 seções (títulos exatos)

O arquivo começa com o título `# Etapa N: <título>` e depois traz, nesta ordem, as seções `## Objetivo`, `## O que perguntar ao usuário`, `## Como executar`, `## Erros comuns` e `## Formato do result_summary` (cada uma em uma linha própria, com dois sinais de `#`).

- `Objetivo`, `Como executar` e `Formato do result_summary` são **obrigatórias**: faltar uma é erro em specVersion 1 (`STEP_SECTION_MISSING`).
- `O que perguntar ao usuário` e `Erros comuns` também devem existir; sem elas há aviso.
- O título da seção precisa ser igual ao acima (a busca é pela linha `## Título`).

## Tamanho

De 400 a 12.000 caracteres por etapa (`STEP_TOO_SHORT_LONG`, erro em specVersion 1). Etapas curtas demais costumam ser vagas e deixam a IA adivinhar; longas demais perdem foco e ficam difíceis de revisar. Mira confortável: 2.000 a 6.000 caracteres. Se passar de 12.000, divida em duas etapas.

## Gates (checklist de saída)

O `gate` de cada etapa no manifesto tem de 0 a 6 itens de texto (mais de 6 é `GATE_TOO_MANY`, erro em specVersion 1). Na prática, escreva de 3 a 6. Cada item deve ser **verificável**: dá para responder sim ou não olhando o que a IA entregou. O servidor não confere o gate (nesta fase ele é texto); quem o cumpre é a IA, instruída pela etapa, e o comprador vê.

## result_summary

O resumo da etapa (até 4.000 caracteres) é como a próxima etapa sabe o que aconteceu. A seção "Formato do result_summary" define a estrutura (por exemplo, listas curtas com decisões, números e pendências). Pense nele como o "bilhete de passagem" entre etapas.

## Ferramentas e nomes entre crases

O validador procura nomes `snake_case` entre crases, nas linhas que falam de `run_tool` ou de ferramenta, e avisa quando o nome não existe em `tools[]` (`STEP_REFERENCE_UNKNOWN`). Nomes das tools do conector (`search_knowledge`, `get_memory`, `save_memory`, `get_template`, `next_step`, `run_tool`) podem ser citados à vontade.

## Varreduras automáticas (avisos para o revisor)

- `STEP_SENSITIVE_ASK`: a etapa manda pedir senha, número de documento, cartão, chave ou login. Remova.
- `STEP_EXTERNAL_URL`: endereço de internet junto de um verbo de envio (enviar, postar, upload) ou com parâmetros na consulta. Etapa não manda dados do usuário para fora.
- `STEP_INJECTION_PATTERN`: frases que tentam mandar a IA descartar regras anteriores, esconder algo do usuário ou assumir outro papel de sistema.
- `TEXT_HIDDEN_CHARS`: caracteres invisíveis ou de direção de texto (podem esconder instruções).
- As mesmas varreduras valem para o texto do manifesto que chega ao modelo e para as perguntas de calibragem.

São avisos, não bloqueio automático, mas o revisor humano lê cada um e pode recusar.

## O que a etapa pode usar do servidor

`search_knowledge` (busca no conhecimento do Solver, devolve até 5 trechos com fonte e data), `get_template` (devolve um modelo declarado), `get_memory` e `save_memory` (perfil e notas do comprador) e, no fim, `next_step`. Terceiros não têm ferramentas próprias nesta fase.

## Etapa de verdade versus texto bonito

O que faz o modelo seguir o processo é: passos numerados e concretos, exemplos curtos de entrada e saída, perguntas agrupadas, o que fazer quando falta informação e um gate objetivo. Veja a base sobre como escrever etapas que o modelo segue.

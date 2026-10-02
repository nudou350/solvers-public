---
title: Diferenciais, critério 2 de 5 e checklist do revisor
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 4.2 e 14.5
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [diferenciais, revisao, criterio]
---

# Diferenciais, critério 2 de 5 e checklist do revisor

Esta base explica por que o Solver precisa de diferenciais, quais são os cinco, o que o validador e o revisor conferem em cada um, o critério de aprovação com pelo menos dois comprovados e o checklist da revisão.

## Por que existem diferenciais

Se dá para copiar tudo numa pasta e colar no chat, é uma skill comum. O Solver se justifica pelo que só existe com o servidor. O manifesto declara quais diferenciais ele tem e o revisor **confere**. A vitrine mostra os comprovados.

## Os 5 diferenciais e o que se confere

- `tool`: ferramenta executável no servidor. Conferência: pelo menos uma ferramenta e cada uma é usada em alguma etapa. **Não disponível** para criador novo nesta fase.
- `verifier`: resultado verificado automaticamente (testes). **Só pacotes da plataforma.**
- `liveData` (conhecimento vivo): conhecimento datado e mantido. Conferência: `knowledge.updatedAt` dentro de `reviewEveryDays`, nenhum arquivo com `valid_until` vencido e pelo menos metade dos arquivos com `source_date`.
- `memory` (adapta-se ao usuário): conferência: bloco `onboarding` presente **e** pelo menos uma etapa cujo texto usa o perfil. O revisor confere que o perfil muda a resposta de verdade.
- `escalation` (atendimento do criador): conferência: `escalation.enabled: true` **e** canal de contato verificado no perfil do criador (o Telegram é vinculado no site com um código enviado ao bot). Sem contato verificado, não conta.

## Critério "2 de 5"

O revisor só aprova com **pelo menos 2 diferenciais comprovados**. Não é um bloqueio automático do validador: ele avisa (`MANIFEST_DIFFERENTIATORS_FEW`), e a decisão é humana. Declarar sem comprovar gera `MANIFEST_DIFFERENTIATOR_UNPROVEN`.

## Honestidade sobre a fase atual

Criadores novos não têm `tool` nem `verifier`. Na prática o produto é: **processo guiado + conhecimento vivo e citado + memória/calibragem + atendimento do criador**. Isso já supera uma skill comum, mas é menos que a promessa completa; a vitrine não deve prometer ferramenta nem verificação nesses pacotes. Combinações realistas: liveData + memory; liveData + escalation; memory + escalation.

## Checklist do revisor (o que ele pergunta)

- **Qualidade**: a promessa é entregue pelas etapas? Há 2 de 5 diferenciais comprovados?
- **Direitos**: as fontes estão listadas e há permissão para o conteúdo de terceiros?
- **Segurança**: alguma instrução age contra o usuário ou manda dados para fora? Há injeção em qualquer texto, inclusive em trechos de conhecimento que só aparecem para uma consulta específica?
- **Preço, teste grátis e vitrine**: coerentes entre si? O teste mostra valor sem entregar tudo? Há promessa de resultado financeiro, jurídico ou médico sem ressalva?

## O que o revisor vê

Resumo do pacote, erros e avisos do validador, manifesto e etapas, o conhecimento (arquivos, fontes, datas, trechos vencidos; ele pode fazer buscas de teste), os modelos e os casos de teste na íntegra, e varreduras automáticas (Unicode invisível, texto oculto, padrões de injeção, endereços, conteúdo igual ao de outro pacote, perguntas de calibragem sensíveis, frases de busca fora do assunto). Em toda nova versão ele vê a diferença de **todos** os arquivos.

## Como o criador se prepara

Escreva um README do revisor dizendo como cada diferencial se comprova, quais avisos sobraram e por quê, de onde vêm as fontes e o que ficou para depois. Quanto mais fácil conferir, mais rápida a revisão. Prazo-meta: até 5 dias úteis.

## Limite honesto da revisão

A revisão humana não garante achar uma injeção escondida em um trecho entre milhares nem um comportamento condicional. Por isso o pacote tem tetos pequenos, a revisão é feita em 100% das versões e o Solver pode ser desligado na hora se houver problema.

# Etapa 2: Diferenciais e como prová-los

## Objetivo

Escolher **pelo menos 2 diferenciais** que o Solver realmente terá e anotar, para cada um, **a prova** que o revisor vai conferir. É o critério "2 de 5" da revisão: um Solver que é só um texto bonito (que o comprador colaria num chat) é uma skill comum e não é aprovado. O que justifica o produto é o que só existe com o servidor: processo guiado, conhecimento vivo e citado, adaptação ao usuário e atendimento humano.

Os 5 diferenciais da especificação são `tool`, `verifier`, `liveData`, `memory` e `escalation`. Seja honesto com o usuário sobre o que vale **nesta fase (o Núcleo)**: criadores novos **não têm `tool` nem `verifier`** (ferramenta executável e verificação automática do resultado), que só chegam na fase de Abertura. Então, na prática, as três opções reais são **conhecimento vivo (`liveData`)**, **memória (`memory`)** e **atendimento do criador (`escalation`)**, e é preciso comprovar duas delas. A vitrine não pode prometer ferramenta nem verificação nesses pacotes.

## O que perguntar ao usuário

Releia a ficha da etapa 1 e o perfil (`tipo_solver`, `nivel`). Pergunte em linguagem simples:

1. **O conteúdo muda com o tempo?** (leis, valores, prazos, versões de software, preços). Se sim, `liveData` é natural: a base é datada, citada e mantida.
2. **Faz diferença conhecer quem usa?** (nível, estilo, orçamento, ferramentas que já tem). Se sim, `memory`: perguntas no primeiro uso e um perfil guardado.
3. **Você aceita atender casos complexos?** Pelo celular, em horário razoável, com os pedidos de ajuda que chegam pelo Telegram. Se sim, `escalation`. Se o usuário hesitar, não escolha esse: atendimento que não acontece é o pior diferencial.
4. **Quem vai manter a base atualizada e com que frequência?** (necessário para `liveData`).

## Como executar

1. **Explique os 5 em uma tabela curta** (o que é, em que Solvers faz sentido), com a ressalva do Núcleo. Use `search_knowledge` com "diferenciais critério 2 de 5" se precisar do texto de referência.
2. **Recomende a combinação** conforme o tipo de Solver. Por exemplo: técnico ou código: `memory` (stack e estilo do usuário) + `liveData` (versões e padrões datados). Consultivo com regras de negócio: `liveData` (regras com fonte e data) + `escalation`. Conteúdo e marketing: `memory` (marca, tom, público) + `liveData` (tendências e formatos). Planejamento ou viagem: `memory` + `liveData`. Análise de dados: `memory` (tipo de planilha, objetivos) + `escalation`.
3. **Para cada escolhido, anote a prova**, que é o que o validador e o revisor conferem de fato:
   - `liveData`: `knowledge.updatedAt` dentro de `reviewEveryDays`; **nenhum** arquivo com `valid_until` vencido; pelo menos metade dos arquivos de conhecimento com `source_date`. Registre quem atualiza e a frequência (ex.: revisar a cada 90 dias).
   - `memory`: bloco `onboarding` no manifesto (de 1 a 5 perguntas) e **pelo menos uma etapa cujo texto usa o perfil** (cita o perfil e diz como ele muda a resposta). O revisor confere que o perfil muda algo de verdade.
   - `escalation`: `escalation.enabled: true` **e** um contato verificado no perfil do criador (o Telegram é vinculado no site, mandando um código ao bot). Sem contato verificado o diferencial não conta.
4. **Declare só o que vai comprovar.** O campo `differentiators` do manifesto aceita `tool`, `verifier`, `liveData`, `memory` e `escalation`, mas o validador avisa (`MANIFEST_DIFFERENTIATOR_UNPROVEN`) quando o declarado não está provado, e (`MANIFEST_DIFFERENTIATORS_FEW`) quando há menos de 2 comprovados. Isso é aviso para o revisor, não bloqueio automático, mas o revisor só aprova com 2 comprovados.
5. **Evite a tentação do diferencial de papel.** Declarar `escalation` sem atender, ou `liveData` com base sem data, é o caminho mais rápido para a recusa.
6. **Registre também o que ficou para depois**: se o usuário queria uma ferramenta ou um verificador, anote no plano da etapa 5 (não no manifesto).
7. Confirme: "Com estes dois (ou três) diferenciais e estas provas, o revisor consegue aprovar. Ok?"

## Erros comuns

- **Escolher 5 e comprovar 1.** Escolha menos e comprove tudo.
- **Declarar `tool` ou `verifier`.** Nesta fase terceiros não têm; o envio é recusado ou o campo fica sem comprovação.
- **`liveData` sem datas.** Cada arquivo de conhecimento precisa de `source` e `source_date` no front-matter (etapa 4).
- **`memory` sem uso.** Perguntas no primeiro uso que nenhuma etapa aproveita não contam; o texto da etapa precisa citar o perfil.
- **`escalation` sem canal verificado** ou sem disposição de atender.
- Prometer na vitrine o que não está nos diferenciais (por exemplo, "resultado garantido por testes").

## Formato do result_summary

```
DIFERENCIAIS (mínimo 2)
- liveData: prova = base com source/source_date, updatedAt, reviewEveryDays=N; mantém: quem/quando
- memory: prova = onboarding (N perguntas) + etapa X usa o perfil
- escalation: prova = enabled + Telegram vinculado (o usuário confirmou)
FICA PARA DEPOIS: ferramenta/verificador (plano na etapa 5)
DECLARADOS NO MANIFESTO: differentiators = [...]
RISCO: o que o revisor pode questionar
```

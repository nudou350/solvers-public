---
title: Códigos de erro do validador (etapas, conhecimento, modelos, ferramentas, testes) e como corrigir
source: Catálogo de códigos de validação da plataforma Solvers (Apêndice A da especificação v1)
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [erros, validador, etapas, conhecimento, evals]
---

# Códigos de erro do validador (etapas, conhecimento, modelos, ferramentas, testes) e como corrigir

Cada resposta do validador traz `code`, `path`, `message` e `fix`. Erro (E) bloqueia; aviso (A) vai ao revisor.

## Etapas

- `STEP_FILE_MISSING` (E): o manifesto declara uma etapa cujo arquivo não existe. Crie o arquivo ou corrija o caminho.
- `STEP_SECTION_MISSING` (E em specVersion 1 para Objetivo, Como executar e Formato do result_summary; aviso para as outras duas): falta uma seção. Acrescente a linha `## Título` com o nome exato.
- `STEP_TOO_SHORT_LONG` (E): etapa fora de 400 a 12.000 caracteres. Detalhe ou divida.
- `GATE_TOO_MANY` (E): gate com mais de 6 itens. Reduza e agrupe.
- `GATE_EVIDENCE_UNKNOWN_TOOL` (E): gate com evidência de uma ferramenta que não existe. Nesta fase use só gates de texto (sem `evidence`).
- `STEP_REFERENCE_UNKNOWN` (A): a etapa cita, junto de `run_tool` ou da palavra ferramenta, um nome que não existe em `tools`. Corrija o nome, retire a menção (terceiros não têm ferramentas) ou use uma tool do conector.
- `STEP_SENSITIVE_ASK` (A): a etapa manda pedir dado sensível. Reescreva para pedir faixas, exemplos fictícios ou orientar o usuário a fazer ele mesmo.
- `STEP_EXTERNAL_URL` (A): endereço de internet junto de verbo de envio, ou com parâmetros. Retire; etapa não manda dados para fora.
- `STEP_INJECTION_PATTERN` (A): trecho que parece mandar a IA descartar regras, esconder algo do usuário ou agir como sistema. Reescreva sem isso.
- `TEXT_HIDDEN_CHARS` (A): caractere invisível ou de direção. Apague e digite de novo o trecho.

## Conhecimento

- `KNOWLEDGE_SOURCE_MISSING` (E): arquivo sem `source` no front-matter (ou sem front-matter; `.txt` sem o `.meta.json`). Acrescente a fonte.
- `KNOWLEDGE_DATE_INVALID` (E): `source_date`, `valid_until` ou `knowledge.updatedAt` fora de `AAAA-MM-DD` ou data inexistente. Escreva como 2026-09-30.
- `KNOWLEDGE_FRONTMATTER_INVALID` (E): bloco `---` aberto e não fechado, linha que não é `chave: valor` ou chave repetida. Ajuste o cabeçalho.
- `KNOWLEDGE_EXPIRED` (A): `valid_until` já passou. Atualize o arquivo e a data, ou remova.
- `KNOWLEDGE_TOO_BIG` (E): mais de 10.000 trechos. Priorize o essencial.
- `PDF_NO_TEXT` (E, reservado para a Abertura): PDF sem texto. Hoje PDF nem é aceito: converta para `.md`.

## Modelos (templates)

- `TEMPLATE_MISSING` (E): modelo declarado em `templates[]` cujo arquivo não existe. Crie ou corrija o caminho.
- `TEMPLATE_UNDECLARED` (A): arquivo em `templates/` sem declaração; não será entregue. Declare em `templates[]` ou remova.
- `TEMPLATE_TYPE_FORBIDDEN` (E): tipo que não vale nesta fase. Use `.md`, `.txt` ou `.json`.

## Ferramentas (não valem para criador novo)

- `TOOL_FORBIDDEN_RUNNER` (E): o pacote tem uma ferramenta; criador novo não tem ferramentas nesta fase. Remova `tools` e registre o plano na etapa 5 do Criador.
- `TOOL_SCHEMA_MISSING`, `TOOL_SCHEMA_UNSAFE`, `TOOL_HTTP_HOST`, `TOOL_EGRESS_MISSING`: erros de ferramentas por internet, só relevantes na Abertura.

## Teste grátis

- `TRIAL_STEPS_EXCEED` (E): `trial.steps` maior que o número de etapas. Reduza.
- `TRIAL_TOOL_UNKNOWN` (E): `trial.tools` cita ferramenta que não existe. Deixe `tools` como `{}`.
- `TRIAL_TEMPLATE_UNKNOWN` (E): `trial.templates` cita um modelo que não está em `templates[]`. Use só nomes existentes.

## Calibragem

- `ONBOARDING_NEEDS_MEMORY` (E): há `onboarding` sem `"usesMemory": true`. Acrescente.
- `ONBOARDING_SENSITIVE` (A): pergunta com termo de dado sensível (senha, CPF, cartão, token...). Troque por faixas ou categorias.

## Casos de teste (evals)

- `EVAL_TOO_FEW_CASES` (E em specVersion 1): menos de 10 casos. Escreva mais, cobrindo pedidos típicos, bordas e segurança.
- `EVAL_CASE_INVALID` (E): caso sem `id`, com `id` repetido, sem `input` ou `checks`, com `type` diferente de `contains`, `regex` ou `not_contains`, checagem sem `value` ou `description`, ou regex inválida. Corrija usando o modelo `caso-de-eval`.

## Códigos internos (da revisão)

- `DIFF_UNREVIEWED_FILE` (E) e `SCAN_DUPLICATE_CONTENT` (A): são da etapa de revisão da plataforma. O segundo avisa que o conteúdo parece o de outro pacote já publicado: se for seu, explique no README; se não for, reescreva.

## Como ler a resposta do validador

A resposta traz `ok` (verdadeiro quando não há erros), `errors`, `warnings`, `stats` (arquivos, etapas, casos, trechos estimados, diferenciais comprovados) e `summary`. Corrija **os erros do mais estrutural para o mais fino** (manifesto, depois etapas, depois conhecimento) e rode de novo. Avisos que sobrarem devem ser justificados no README do revisor.

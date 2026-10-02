---
title: Manifesto (manifest.json) campo a campo
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seção 4, e schema do validador da plataforma
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [manifesto, campos, schema]
---

# Manifesto (manifest.json) campo a campo

O manifesto é estrito no `specVersion: 1`: **campo desconhecido é erro** (`MANIFEST_UNKNOWN_FIELD`). Só use os campos abaixo. Para um esqueleto pronto, use o modelo `manifest-esqueleto`.

## Identidade

- `specVersion`: sempre `1` em envio de criador novo (`MANIFEST_SPEC_VERSION` se faltar).
- `id`: **não escreva na primeira versão**; o servidor atribui (32 letras e números minúsculos). Nas versões seguintes é obrigatório e precisa ser seu (`MANIFEST_ID_OWNER`).
- `slug`: de 3 a 40 caracteres, minúsculas, dígitos e hífens (`meu-solver`). Não pode ter o formato de um `id` de 32 letras e números (`MANIFEST_SLUG_LOOKS_LIKE_ID`) nem ser um nome reservado (`MANIFEST_SLUG_RESERVED`, por exemplo nomes de marcas e da plataforma).
- `name`: de 3 a 32 **bytes** (letra acentuada vale 2 bytes; `MANIFEST_NAME_TOO_LONG`).
- `version`: `1.0.0` (três números), até 16 bytes, sem sufixo. A nova versão precisa ser maior que a publicada.
- `platform`: não use. Só pacotes da plataforma (`MANIFEST_PLATFORM_FORBIDDEN`).

## Vitrine

- `tagline`: de 10 a 100 caracteres. Uma frase de valor.
- `description`: de 120 a 2.000 caracteres: o que entrega, para quem e o que **não** faz.
- `category`: uma de Desenvolvimento, Design, Dia a dia, Negócios, Viagens, Conteúdo, Escrita, Outros. Finanças, Jurídico e saúde **não** são aceitas de criadores novos nesta fase (`MANIFEST_CATEGORY_FORBIDDEN`).
- `creator`: `{ id, name, bio, avatarUrl? }`. O servidor troca o `id` pelo identificador do seu perfil; escreva qualquer texto curto.
- `requirements[]`: o que o comprador precisa: `{ type, label, key?, optional?, howTo?, helpUrl? }`, com `type` igual a `client`, `connector` ou `plan`. Ex.: `{ "type": "client", "label": "Claude ou ChatGPT", "key": "any" }`.
- `packageContents[]`: de 3 a 8 itens do que o pacote entrega. O validador confere com a realidade (`CONTENTS_MISMATCH`).
- `searchPhrases[]`: até 20 frases de 3 a 120 caracteres, com as palavras de quem compra. O revisor confere contra o conteúdo.
- `beforeAfter[]`: até 5 exemplos `{ prompt, withoutSolver, withSolver }`.
- `versions[]`: histórico `{ version, releasedAt, notes }`. **Precisa** haver uma entrada para a versão atual (`MANIFEST_VERSIONS_MISSING`).
- `terms`: `{ "rightsConfirmed": true, "sourcesListed": true }`. Sem isso: `TERMS_MISSING`.

## Comportamento

- `steps[]`: de 1 a 12 itens `{ file, title?, gate[] }`. `gate` tem de 0 a 6 itens de texto. Veja a base sobre etapas.
- `usesMemory`: `true` se o Solver usa memória. Obrigatório `true` quando há `onboarding`.
- `onboarding`: `{ questions: [ { id, ask, why, options? } ] }`, de 1 a 5 perguntas. Veja a base sobre calibragem.
- `escalation`: `{ enabled: boolean }`. O contato do criador vem do perfil dele.
- `differentiators[]`: subconjunto de `tool`, `verifier`, `liveData`, `memory`, `escalation`. Declare só o que vai comprovar.
- `knowledge`: `{ updatedAt, reviewEveryDays, sources[] }`. `updatedAt` em AAAA-MM-DD, `reviewEveryDays` de 1 a 730, `sources` com pelo menos 1 fonte em texto.
- `templates[]`: `{ name, path, title, description }`. `name` em minúsculas, dígitos, hífen e sublinhado. O `path` começa por `templates/`. Só o que está declarado é entregue.
- `tools[]`: **vazio** para criador novo nesta fase (`TOOL_FORBIDDEN_RUNNER`).
- `guarantee`: `{ "available": false, "defaultCriteria": [] }`. Ligar a garantia é erro para criador novo (`MANIFEST_GUARANTEE_FORBIDDEN`).

## Preço, teste grátis e oferta

- `pricing`: `{ priceUsdc, royaltyBps }`. `priceUsdc` em dólares, no mínimo o `min_price` da plataforma (hoje 5; `MANIFEST_PRICE_BELOW_MIN`). `royaltyBps` de 0 a 1.000 (300 = 3%), a parte do criador na revenda das licenças.
- `trial`: teste grátis, opcional: `{ available?, uses (1 a 10), steps (etapas liberadas, no máximo o total), searches, tools, templates[], scope?, summary, lockedSummary }`. Sem `trial`, não há teste. Para criador novo, `tools` fica `{}`.
- `supply`: `{ maxLicenses }`, teto de licenças vendidas (1 a 1.000.000). Opcional, só aumenta com o tempo. Combinar `supply` com teste grátis gera o aviso `SUPPLY_WITH_TRIAL`.
- `catalogOnly`: removido; gera aviso.

## Dependências entre campos

- `trial.steps` não pode passar do número de etapas (`TRIAL_STEPS_EXCEED`); `trial.tools` e `trial.templates` só citam nomes que existem (`TRIAL_TOOL_UNKNOWN`, `TRIAL_TEMPLATE_UNKNOWN`).
- `onboarding` exige `usesMemory: true` (`ONBOARDING_NEEDS_MEMORY`).
- `differentiators` com algo que o validador não comprova gera aviso; menos de 2 comprovados também.
- Mudar `tools`, `onboarding`, `requirements` ou a estrutura de `steps` numa atualização exige subir o número MAJOR (`DIFF_ENDPOINT_CHANGED_MINOR`).

## Textos que o modelo do comprador lê

`tagline`, `description`, `howTo`, `packageContents`, `searchPhrases`, `beforeAfter`, `trial.summary`, `trial.lockedSummary` e as perguntas de calibragem passam pelas mesmas varreduras das etapas (injeção, dado sensível, caracteres invisíveis). Escreva neles só o que diria a um cliente.

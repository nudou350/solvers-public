---
title: Formato do pacote Solver (pastas, ZIP e limites)
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 3, 6 e 7, aprovada em 2026-09-30
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [formato, zip, pastas, limites]
---

# Formato do pacote Solver (pastas, ZIP e limites)

Quem decide se um pacote é válido é sempre o validador do servidor. Este texto explica o formato: a estrutura de pastas, as regras do ZIP, os caminhos do manifesto, as fases da plataforma e os formatos de conhecimento aceitos. Em caso de diferença, vale o validador.

## O que é um pacote

Um Solver é uma pasta entregue em ZIP com manifesto, etapas, conhecimento, modelos e casos de teste. O servidor nunca entrega a pasta ao comprador: entrega uma etapa por vez, busca no conhecimento, guarda a memória e entrega os modelos declarados. O comprador usa a própria IA (Claude ou ChatGPT) por um conector. O que diferencia um Solver de uma skill comum é o que só existe no servidor: processo guiado etapa por etapa, conhecimento citado e datado, memória e atendimento do criador.

## Árvore de pastas

Dentro do ZIP há **uma única pasta raiz** (o slug do Solver) com:

- `manifest.json`: obrigatório. Descreve o Solver (campo a campo em outro arquivo desta base).
- `steps/`: de 1 a 12 arquivos `.md`, uma etapa por arquivo. Recomendado: de 3 a 6.
- `knowledge/`: opcional. Arquivos `.md` ou `.txt` em subpastas livres, com fonte e data.
- `templates/`: opcional. Modelos entregues ao comprador (`.md`, `.txt`, `.json`), só os declarados em `templates[]` do manifesto.
- `evals/cases/`: de 10 a 40 arquivos `.json`, um caso de teste por arquivo.
- `evals/outputs/` e `evals/report.json`: opcionais no envio. A plataforma gera o relatório oficial. Nunca invente nota.
- `README.md`: opcional. Nota para o revisor; não chega ao comprador.
- `verifier/`: só pacotes da plataforma. Em envio de criador novo é erro.

## Regras do ZIP (fase atual, o Núcleo)

- Tamanho do ZIP: até 50 MB (erro `ZIP_TOO_LARGE`).
- Tamanho real depois de descompactado: até 150 MB (`ZIP_EXPANDS_TOO_MUCH`).
- Quantidade de arquivos: até 2.000 (`ZIP_TOO_MANY_FILES`).
- Raiz: exatamente 1 pasta contendo o `manifest.json` (`ZIP_BAD_ROOT`).
- Nomes de arquivo únicos, sem distinguir maiúsculas (`ZIP_DUPLICATE_ENTRY`).
- Caminhos relativos, sem `..`, sem barra invertida, sem caractere de controle, sem nome começando com ponto; permitidos letras e dígitos (inclusive acentuados), ponto, hífen, sublinhado, espaço e a barra `/` (`ZIP_BAD_PATH`).
- Lixo de sistema (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) é removido com aviso (`ZIP_IGNORED_FILE`).
- Links simbólicos são recusados (`ZIP_SYMLINK`).
- Extensões permitidas: `.json`, `.md` e `.txt` (`FILE_TYPE_NOT_ALLOWED`).
- Texto em UTF-8 válido (`FILE_NOT_UTF8`).
- Arquivo individual: até 10 MB (`FILE_TOO_LARGE`).
- Conhecimento: até 10.000 trechos no pacote (`KNOWLEDGE_TOO_BIG`).

Nada do ZIP é executado: a extração acontece em pasta isolada.

## Caminhos escritos no manifesto

Todo caminho no manifesto (`steps[].file`, `templates[].path`) precisa ser relativo, começar por `steps/` ou `templates/`, existir no ZIP e ficar dentro da pasta do pacote. Se não, o erro é `MANIFEST_PATH_ESCAPE` (ou `STEP_FILE_MISSING` e `TEMPLATE_MISSING` quando o arquivo não existe).

## Fases de abertura

Hoje vale o **Núcleo**: criadores convidados, conhecimento em `.md` e `.txt`, modelos `.md`, `.txt` e `.json`, nenhuma ferramenta própria do criador, nenhuma garantia. Na **Abertura** (sem data prometida) entram PDF, HTML e CSV no conhecimento, ferramentas por internet (`http`), gates com evidência e avaliação rodada pela plataforma. Não escreva pacote contando com a Abertura.

## Hash e versão

A plataforma calcula uma impressão digital (hash) do pacote na aprovação, sobre todos os arquivos, ignorando o `evals/report.json`. Qualquer mudança de arquivo muda o hash e exige nova revisão.

## Formatos de conhecimento nesta fase

`.md` é o formato recomendado. `.txt` vira uma seção única e precisa de um arquivo vizinho `nome.txt.meta.json` com a fonte. PDF, HTML e planilhas devem ser convertidos para `.md` antes (veja a base sobre conversão). O servidor corta o conhecimento em trechos por títulos `#` a `###`, com limite de cerca de 2.000 caracteres por trecho e sobreposição de 200, e busca por significado (multilíngue).

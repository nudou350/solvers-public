---
title: Como converter PDF, página da web e planilha em arquivos .md para a base
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seção 6.1 e regras de chunking da plataforma
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [conversao, pdf, html, planilha, markdown, chunking]
---

# Como converter PDF, página da web e planilha em arquivos .md para a base

Esta base mostra, passo a passo, como transformar PDFs, páginas da web, planilhas, apresentações e anotações em arquivos `.md` úteis para a busca: um arquivo por tema, seções por títulos de 200 a 2.000 caracteres, fonte e data em cada arquivo.

## Por que converter

Nesta fase o conhecimento aceita só `.md` e `.txt`. A conversão é feita **na IA do próprio criador**, que lê o arquivo no computador ou no anexo da conversa e escreve os `.md`. Não custa nada à plataforma, nada sobe antes do envio final do ZIP e o revisor lê exatamente o texto que será indexado.

## Princípios

- **Um arquivo por tema**, de 1 a 8 KB. Nunca um PDF inteiro num arquivo só.
- **Seções por títulos**, de 200 a 2.000 caracteres, cada uma se bastando sozinha (a busca devolve um trecho solto).
- **Fatos com número, unidade e data**. Não resuma o que tem valor preciso.
- **Front-matter em todo arquivo** com `source`, `source_date` e, se vencer, `valid_until`.
- **Nunca invente** o que não conseguiu ler. Se um trecho está ilegível, deixe de fora e avise.

## PDF com texto

1. Leia o PDF e extraia o texto página por página.
2. Descarte cabeçalhos, rodapés, número de página e sumário.
3. Junte palavras quebradas por hífen no fim da linha e parágrafos partidos por mudança de página.
4. Identifique os capítulos e as seções pelos títulos do documento; cada capítulo vira um arquivo (ou cada grupo de seções pequenas).
5. Reescreva títulos para carregar o assunto: "Prazos" vira "Prazos de pagamento do contrato de serviços".
6. Mantenha números, siglas e unidades exatamente como estão. Se o PDF tem versão ou data, use em `source` e `source_date`.

## PDF escaneado (imagem)

Sem camada de texto não há como ler com segurança. Peça ao criador uma versão pesquisável, o texto original ou que ele redigite os trechos principais. **Não reconstrua de memória.** Se a IA do criador consegue transcrever imagens e o criador revisa a transcrição linha por linha, é aceitável, mas a responsabilidade pela fidelidade é dele.

## Página da web

1. Pegue o texto principal; retire menus, anúncios, rodapés e avisos de cookies.
2. Guarde o endereço em `source_url` e a data de acesso ou de publicação em `source_date`.
3. Preserve a estrutura de títulos da página.
4. Fatos de páginas públicas oficiais podem ser usados, **citando a fonte**. Texto autoral de terceiros (blog, curso, notícia) não deve ser copiado: só com permissão.

## Planilha

1. Entenda as colunas, as unidades e o período.
2. Se a planilha é uma **tabela de referência** (valores, faixas, prazos), converta em listas "coluna: valor" por linha ou em uma tabela Markdown pequena por seção. Exemplo: "Faixa 1: até R$ 5.000 | alíquota: 6%".
3. Se é uma **base de dados** (milhares de linhas, clientes, vendas), não vai para o conhecimento: o conhecimento guarda regras e definições, não registros. Dados pessoais nunca entram.
4. Descreva o significado de cada coluna e as unidades em uma seção "Como ler esta tabela".

## Apresentação ou anotações

Cada slide ou bloco de anotação vira uma seção com título completo. Transforme frases soltas em frases que se entendem sozinhas, desenvolva siglas na primeira vez e junte slides que tratam do mesmo tema. Tópicos curtos sem contexto geram trechos fracos na busca: acrescente a explicação que você daria falando.

## Estrutura de um arquivo convertido

Cabeçalho (front-matter) seguido de um título de nível 1, uma introdução curta e seções de nível 2 com o assunto no título. Fim com uma seção "O que este arquivo não cobre". Veja o modelo `conhecimento-front-matter` (via `get_template`).

## Conferência final

- O arquivo tem `source` e `source_date` válidos?
- Cada seção tem de 200 a 2.000 caracteres e faz sentido sozinha?
- Algum dado pessoal ou texto de terceiros sem permissão ficou?
- Os números do arquivo batem com a fonte? Confira pelo menos 5 valores aleatoriamente.
- O criador revisou o resultado? A conversão é responsabilidade dele.

## Tamanho

Arquivo até 10 MB e no máximo 10.000 trechos no pacote; na prática, bases excelentes têm de 8 a 30 arquivos. Se o material é grande, comece pelos temas que mais aparecem nas perguntas dos compradores.

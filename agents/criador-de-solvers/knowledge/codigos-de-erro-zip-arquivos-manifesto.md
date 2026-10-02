---
title: Códigos de erro do validador (ZIP, arquivos e manifesto) e como corrigir
source: Catálogo de códigos de validação da plataforma Solvers (Apêndice A da especificação v1)
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [erros, validador, zip, manifesto]
---

# Códigos de erro do validador (ZIP, arquivos e manifesto) e como corrigir

Cada resposta do validador traz `code`, `path`, `message` e `fix`. **Erro (E)** bloqueia o envio. **Aviso (A)** vai ao revisor, que decide. Em pacotes de criador novo (specVersion 1), as regras são as estritas.

## Erros do ZIP: tamanho, raiz e nomes

- `ZIP_TOO_LARGE` (E): ZIP acima de 50 MB. Reduza o conhecimento ou divida o conteúdo; textos em `.md` raramente chegam perto do limite.
- `ZIP_EXPANDS_TOO_MUCH` (E): conteúdo descompactado acima de 150 MB. Reduza o tamanho dos arquivos.
- `ZIP_TOO_MANY_FILES` (E): mais de 2.000 arquivos. Junte arquivos pequenos de conhecimento por tema.
- `ZIP_BAD_ROOT` (E): o ZIP não tem exatamente uma pasta raiz com o `manifest.json`. Compacte a **pasta do Solver** (e não o conteúdo dela solto), com tudo dentro de uma só pasta.
- `ZIP_DUPLICATE_ENTRY` (E): dois arquivos com o mesmo nome (sem diferenciar maiúsculas e acentos equivalentes). Deixe só um.
- `ZIP_BAD_PATH` (E): caminho com `..`, barra invertida, caractere de controle, nome começando com ponto ou caractere fora de letras, dígitos, ponto, hífen, sublinhado e espaço. Renomeie. No Windows PowerShell 5.1, o `Compress-Archive` grava barras invertidas: use `tar -a -c -f arquivo.zip pasta` ou um programa de compactação.
- `ZIP_SYMLINK` (E): atalho (link simbólico) dentro do ZIP. Troque pelo arquivo real.
- `ZIP_IGNORED_FILE` (A): `__MACOSX/`, `.DS_Store`, `Thumbs.db` foram ignorados. Nada a fazer; evite gerá-los.

## Erros de arquivo

- `FILE_TYPE_NOT_ALLOWED` (E): extensão ou pasta que não vale nesta fase (por exemplo `.pdf`, `.html`, `.csv`, imagem). Converta para `.md` ou `.txt`.
- `FILE_NOT_UTF8` (E): arquivo de texto que não é UTF-8 válido. Salve como UTF-8 (sem outra codificação).
- `FILE_TOO_LARGE` (E): arquivo acima de 10 MB. Divida em partes menores.
- `MANIFEST_PLATFORM_FORBIDDEN` (E): você usou `platform` no manifesto ou incluiu a pasta `verifier/`. Remova: são só da plataforma.

## Erros do manifesto: formato

- `MANIFEST_MISSING` (E): não há `manifest.json` na raiz do pacote. Crie com o modelo `manifest-esqueleto`.
- `MANIFEST_INVALID_JSON` (E): JSON inválido (vírgula sobrando, aspas, chave sem fechar). A mensagem diz onde. Use um formatador de JSON.
- `MANIFEST_SCHEMA` (E): campo com tipo ou tamanho errado; o `path` diz qual. Exemplos: tagline fora de 10 a 100 caracteres, description fora de 120 a 2.000, `packageContents` com menos de 3 ou mais de 8 itens, categoria desconhecida, `royaltyBps` fora de 0 a 1.000. Corrija o campo conforme a mensagem.
- `MANIFEST_UNKNOWN_FIELD` (E): campo que não existe na especificação. Remova ou use um campo previsto.
- `MANIFEST_SPEC_VERSION` (E): faltou `"specVersion": 1`. Acrescente.
- `TERMS_MISSING` (E): faltou `"terms": { "rightsConfirmed": true, "sourcesListed": true }` (e o usuário precisa mesmo confirmar os dois).

## Erros do manifesto: identidade

- `MANIFEST_ID_OWNER` (E): o `id` ou o `slug` já pertence a outro criador. Na primeira versão, remova o `id`; troque o slug por um nome próprio.
- `MANIFEST_SLUG_RESERVED` (E): slug reservado (nomes de marcas e da plataforma). Escolha outro.
- `MANIFEST_SLUG_LOOKS_LIKE_ID` (E): slug com 32 letras e números, igual a um `id`. Use palavras separadas por hífen.
- `MANIFEST_NAME_TOO_LONG` (E): nome com mais de 32 bytes. Encurte (letras acentuadas contam mais).
- `MANIFEST_VERSION_TOO_LONG` (E): versão com mais de 16 bytes. Use algo como `1.0.0`.
- `MANIFEST_VERSION_NOT_GREATER` (E): a versão enviada não é maior que a publicada. Suba o número.
- `MANIFEST_VERSIONS_MISSING` (E): falta uma entrada em `versions[]` para a versão atual. Acrescente `{ version, releasedAt, notes }`.

## Erros do manifesto: regras da fase

- `MANIFEST_CATEGORY_FORBIDDEN` (E): categoria não aceita de criador novo (Finanças, Jurídico, saúde). Reduza o escopo para uma categoria permitida ou espere a abertura dessas categorias. Não esconda o tema trocando a categoria: o revisor lê o conteúdo.
- `MANIFEST_GUARANTEE_FORBIDDEN` (E): `guarantee.available: true`. Use `{ "available": false, "defaultCriteria": [] }`.
- `MANIFEST_PRICE_BELOW_MIN` (E): preço abaixo do mínimo da plataforma (hoje 5). Use o mínimo ou mais.
- `MANIFEST_PATH_ESCAPE` (E): caminho do manifesto que sai da pasta ou não começa por `steps/` ou `templates/`. Use `steps/01-nome.md`.
- `DIFF_ENDPOINT_CHANGED_MINOR` (E): numa atualização você mudou `tools`, `onboarding`, `requirements` ou a estrutura de `steps` sem subir o MAJOR. Suba (ex.: 1.4.2 para 2.0.0).

## Avisos do manifesto

- `MANIFEST_DIFFERENTIATOR_UNPROVEN` (A): você declarou um diferencial que o validador não comprova. Cumpra a condição (ver a base de diferenciais) ou retire do campo.
- `MANIFEST_DIFFERENTIATORS_FEW` (A): menos de 2 comprovados. O revisor só aprova com 2 ou mais.
- `SUPPLY_WITH_TRIAL` (A): teto de licenças com teste grátis ligado: o teste não consome vaga. Para exclusividade real, desligue o teste.
- `CATALOG_ONLY_IGNORED` (A): `catalogOnly` não tem efeito. Remova.
- `CONTENTS_MISMATCH` (A): `packageContents` promete algo que o pacote não tem (modelos, ferramenta, garantia, memória, base de conhecimento). Ajuste a lista à realidade.

# Checklist de pré-envio

Marque cada item com o usuário antes de subir o ZIP. Se algum item não está marcado, volte à etapa indicada.

## Pacote e arquivos

- [ ] O ZIP tem uma única pasta raiz (o slug) com o manifest.json dentro (etapa 7).
- [ ] Só existem arquivos .json, .md e .txt; nenhum nome começa com ponto; sem __MACOSX, .DS_Store ou Thumbs.db.
- [ ] Nenhum arquivo passa de 10 MB e o ZIP não passa de 50 MB.
- [ ] Não há pasta verifier/, não há evals/report.json e não há notas de desempenho inventadas.

## Manifesto

- [ ] specVersion igual a 1; sem id na primeira versão; sem platform; sem tools; guarantee.available igual a false.
- [ ] Categoria entre as permitidas (nada de Finanças, Jurídico ou saúde).
- [ ] name de 3 a 32 bytes; tagline de 10 a 100 caracteres; description de 120 a 2.000 caracteres, com o que NÃO faz.
- [ ] version no formato 1.0.0 e uma entrada correspondente em versions.
- [ ] terms com rightsConfirmed e sourcesListed iguais a true, e o usuário confirmou que é verdade.
- [ ] pricing.priceUsdc igual ou maior que 5; royaltyBps entre 0 e 1.000.
- [ ] packageContents com 3 a 8 itens, só o que o pacote realmente tem.
- [ ] searchPhrases com as palavras de quem compra, todas ligadas ao conteúdo real.

## Etapas

- [ ] De 1 a 12 etapas (ideal: 3 a 6), cada uma com as 5 seções e entre 400 e 12.000 caracteres.
- [ ] Cada gate tem de 3 a 6 itens verificáveis.
- [ ] Nenhuma etapa pede senha, documento, cartão ou chave; nenhuma manda dados para fora; nenhuma tenta esconder algo do usuário.

## Conhecimento

- [ ] Todo arquivo .md tem front-matter com source e source_date (AAAA-MM-DD); o que vence tem valid_until.
- [ ] Seções de 200 a 2.000 caracteres, que se bastam sozinhas.
- [ ] Sem dado pessoal e sem conteúdo de terceiros sem permissão.
- [ ] knowledge.updatedAt, reviewEveryDays e sources preenchidos.

## Calibragem e diferenciais

- [ ] Pelo menos 2 diferenciais comprovados em stats.differentiators do validador.
- [ ] Perguntas de calibragem sem dado sensível; usesMemory igual a true; uma etapa usa o perfil.
- [ ] Se escalation estiver ligado: o Telegram do criador está vinculado no perfil.

## Casos de teste

- [ ] 10 ou mais casos com checagens contains, regex ou not_contains, cada uma com description.
- [ ] Os casos de método são específicos: uma IA qualquer, sem o Solver, não passaria neles; e um erro do Solver faria o caso falhar.
- [ ] Há casos de borda e de segurança (pedido fora do escopo, promessa de resultado, dado sensível).

## Validação e envio

- [ ] validate_package com ok igual a true e os avisos restantes justificados no README.md.
- [ ] Script de validação do ZIP inteiro rodado (ou o usuário sabe que o site valida de novo).
- [ ] O usuário entende: envio em /criador/publicar, revisão humana em até 5 dias úteis, sem garantia de aprovação, nenhuma nota prometida.

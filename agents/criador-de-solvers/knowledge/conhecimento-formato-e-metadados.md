---
title: Conhecimento: front-matter, chunks, validade e busca
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seção 6, e regras do validador da plataforma
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [conhecimento, front-matter, chunks, validade]
---

# Conhecimento: front-matter, chunks, validade e busca

Esta base explica como os arquivos de conhecimento do Solver são lidos pelo servidor: o cabeçalho com fonte e data, o corte em trechos por títulos, a validade, os limites de tamanho e o que comprova o diferencial de conhecimento vivo.

## Como o conhecimento funciona

Os arquivos de `knowledge/` são cortados em trechos (chunks) e indexados por significado. Durante o trabalho, a IA do comprador consulta a base pela ferramenta `search_knowledge`, que devolve **até 5 trechos** com o texto, a fonte (título e `source`), a data e, quando o trecho venceu, o aviso "pode estar desatualizado (válido até DD/MM/AAAA)". A IA é instruída a citar a fonte. O arquivo em si nunca sai: só trechos.

## Front-matter (cabeçalho do arquivo .md)

Um bloco entre duas linhas `---`, no topo, com linhas `chave: valor`:

```
---
title: Valores do DAS-MEI em 2026
source: Receita Federal
source_url: https://www.gov.br/receitafederal/
source_date: 2026-01-15
valid_until: 2026-12-31
tags: [das, valores]
---
```

- `title`: opcional. Se faltar, vale o primeiro título do arquivo.
- `source`: **obrigatório** em specVersion 1 (`KNOWLEDGE_SOURCE_MISSING`). Quem é a fonte, em palavras.
- `source_url`: opcional, endereço https da fonte.
- `source_date`: data da fonte, formato `AAAA-MM-DD` (`KNOWLEDGE_DATE_INVALID` se estiver errada ou impossível, como 2026-02-30). Obrigatória para quem declara o diferencial `liveData`.
- `valid_until`: opcional, `AAAA-MM-DD`. Depois dessa data o trecho recebe o aviso de desatualizado e o validador dá `KNOWLEDGE_EXPIRED`.
- `tags`: lista de até 10 palavras, entre colchetes e separadas por vírgula.

Um bloco aberto e não fechado, linha sem "chave: valor" ou chave repetida é `KNOWLEDGE_FRONTMATTER_INVALID`.

## Arquivos .txt

Não têm front-matter. A fonte vai em um arquivo vizinho com o mesmo nome mais `.meta.json`, por exemplo `faq.txt.meta.json`, com os mesmos campos (`source`, `source_date`...). Sem ele: `KNOWLEDGE_SOURCE_MISSING`. Prefira `.md`.

## Como o texto é cortado

- A divisão é por títulos `#`, `##` e `###`: cada seção vira um trecho.
- Seções maiores que 2.000 caracteres são divididas por parágrafo, com sobreposição de 200 caracteres e o título repetido.
- Os trechos são lidos **sozinhos**, sem o resto do arquivo. Por isso cada seção deve se bastar e carregar o assunto no título.
- Meta de qualidade: seções de 200 a 2.000 caracteres.
- Linhas que começam com `#` dentro de blocos de código também viram título. Em exemplos com markdown dentro, recue o bloco com 4 espaços ou evite a barra de título.

## Tamanho

Arquivo até 10 MB. Pacote até 10.000 trechos (`KNOWLEDGE_TOO_BIG` acima disso). Estimativa: 1 trecho para cada 2.000 caracteres de texto limpo, ou menos quando as seções são curtas. Um pacote típico excelente tem de 8 a 30 arquivos, e o validador informa a estimativa de trechos em `stats`.

## Validade e "conhecimento vivo"

O diferencial `liveData` é comprovado quando: `knowledge.updatedAt` está dentro de `reviewEveryDays` (por exemplo, atualizado nos últimos 90 dias), **nenhum** arquivo tem `valid_until` vencido e pelo menos **metade** dos arquivos tem `source_date`. Isso depende de o criador manter a base: marque no calendário a revisão.

## Bloco knowledge no manifesto

`knowledge: { "updatedAt": "2026-10-02", "reviewEveryDays": 90, "sources": ["Receita Federal", "Portal do Empreendedor"] }`. As fontes listadas ali aparecem na página do Solver.

## Proteção do conteúdo (honestidade)

O conhecimento sai só em trechos, com marca d'água discreta e limite diário de consultas por licença. Mas quem tem a licença pode copiar os trechos que lê. O valor do produto está no processo, na atualização contínua e no atendimento, não em sigilo absoluto.

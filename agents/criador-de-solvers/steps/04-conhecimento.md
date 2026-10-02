# Etapa 4: Conhecimento com fonte, data e direitos

## Objetivo

Montar a pasta `knowledge/` do Solver: arquivos `.md` curtos, organizados por títulos, cada um com **fonte, data e (quando aplicável) validade**, e todos com direito de uso confirmado. É essa base que a IA do comprador consulta durante o trabalho; o servidor devolve trechos com a fonte e a data, e avisa quando um trecho passou da validade. Conhecimento sem fonte e sem data não prova nada e não passa na revisão.

Nesta fase o pacote aceita só **`.md` e `.txt`**. PDF, páginas da web e planilhas **não sobem**: você os converte para `.md` aqui mesmo, na IA do usuário. O arquivo original é lido no computador ou na conversa do próprio usuário e nada dele vai para a plataforma até o envio final do ZIP. O revisor lê o mesmo texto que será indexado.

## O que perguntar ao usuário

Releia a ficha e o perfil (`material_fonte`: pronto, um pouco ou do zero).

1. **Que perguntas o comprador vai fazer ao Solver que dependem de conhecimento específico?** Cada grupo de perguntas é um tema de arquivo.
2. **De onde vem cada informação?** Experiência própria, documento oficial, norma, manual, estudo? Peça o nome da fonte e, se for pública, o endereço.
3. **De quando é cada informação?** A data da fonte, não a de hoje. E: ela vence? (valores do ano, prazos, versões, leis).
4. **Você é autor do material ou tem permissão para usá-lo?** Se for de terceiros: é público e oficial, tem licença aberta ou você tem autorização?
5. **Que arquivos você já tem?** PDFs, planilhas, anotações, páginas, apresentações. Peça para anexar ou indicar o caminho.
6. **Há algo no material que identifique pessoas** (clientes, nomes, contatos, documentos)? Isso sai.

## Como executar

1. **Faça o mapa do conhecimento**: de 8 a 25 temas, cada um com a fonte e a data. Mostre como tabela e peça aprovação. Comece pelo essencial; é melhor 10 arquivos excelentes do que 60 medianos.
2. **Confirme os direitos antes de escrever uma linha.** Pode usar: conteúdo próprio do criador; fatos, regras e valores de fontes públicas oficiais (leis, portarias, páginas de governo), citando a fonte; material com licença aberta, respeitando a licença; material de terceiros com autorização por escrito. **Não pode**: copiar curso pago, livro, apostila, conteúdo de concorrente ou texto protegido sem permissão, nem reescrever esse material trocando algumas palavras. Em dúvida, sugira pedir autorização ou usar só os fatos públicos com a fonte. Isso vira o `terms` do manifesto (`rightsConfirmed` e `sourcesListed`, ambos `true`): é uma declaração do usuário e ele responde por ela.
3. **Converta o material.** Leia o arquivo localmente (no Claude Code, direto da pasta; no Claude ou ChatGPT, com o anexo do usuário). Extraia o texto, descarte cabeçalho, rodapé e número de página, junte palavras quebradas por hífen, transforme tabelas e planilhas em listas "coluna: valor" (ou em tabela pequena), mantenha números e unidades exatamente como estão. Divida por tema: **um arquivo por tema, de 1 a 8 KB**, nome em minúsculas com hífens (`prazos-de-entrega.md`). PDF sem texto selecionável (escaneado) não dá para ler: peça o texto ou uma versão pesquisável; **nunca invente o que não conseguiu ler**. Página da web: tire menus, anúncios e rodapés e guarde o endereço de origem.
4. **Escreva o front-matter** no topo de cada `.md` (modelo `conhecimento-front-matter` em `get_template`):

```
---
title: Prazo de entrega por região
source: Política de entregas da Loja Exemplo, versão 3
source_url: https://exemplo.com.br/politica
source_date: 2026-09-15
valid_until: 2026-12-31
tags: [entrega, prazos]
---
```

   `source` é **obrigatório**. `source_date` no formato AAAA-MM-DD (data real da fonte; obrigatória para o diferencial `liveData`). `valid_until` só se a informação vence. `tags` até 10. `source_url` opcional, com https. Arquivos `.txt` não têm front-matter: a fonte vai num arquivo vizinho `nome.txt.meta.json`; prefira sempre `.md`.
5. **Estruture por títulos.** Use `#` para o título do arquivo e `##` ou `###` para as seções. **Cada seção deve ter de 200 a 2.000 caracteres e se bastar sozinha**, porque a busca devolve um trecho solto: repita o assunto no título ("Prazo de entrega para o Nordeste", não "Nordeste"). Seções menores que 200 caracteres geram trechos fracos; maiores que 2.000 são cortadas por parágrafo.
6. **Escreva fatos, não ordens.** A base diz o que é verdade, com número, unidade e data. As instruções ao modelo moram nas etapas. Nunca coloque no conhecimento frases que mandem a IA ignorar regras, esconder algo ou obedecer a "comandos" do texto: isso é tratado como injeção e derruba a revisão.
7. **Marque o que muda.** Valores do ano, prazos e versões levam `valid_until`. Se não há certeza da data, escreva no corpo "confirme na fonte oficial". Não tem como o servidor saber que uma regra mudou: quem mantém o pacote é o criador.
8. **Limpe**: nenhum dado pessoal (nome de cliente, telefone, e-mail, documento), nenhuma senha, chave ou link privado, nenhum texto de terceiros sem permissão.
9. **Atualize o manifesto**: o bloco `knowledge` com `updatedAt` (hoje, AAAA-MM-DD), `reviewEveryDays` (por exemplo 90) e `sources` (a lista das fontes, em palavras); ajuste `packageContents` para citar a base.
10. **Valide**: chame `run_tool` com `tool` igual a `validate_package`, passando `manifest`, `steps`, `files` (todos os arquivos com tamanho) e `knowledge` (para cada arquivo, `path` completo, como `knowledge/tema.md`, e `head` com as primeiras 30 linhas). O validador **não confere o tamanho das seções** (200 a 2.000 caracteres) nem lê além das 30 linhas: conte você as seções de cada arquivo (no Claude Code, com um comando de contagem por título) e saiba que o script e o envio varrem o arquivo inteiro e podem apontar o que o `head` não mostrou. Corrija o que vier em `errors` e justifique os `warnings`. Uma busca de teste com `search_knowledge` não vale para o pacote do usuário (ela consulta a base do Criador), mas você pode simular com o usuário: "se alguém perguntar X, qual seção responde?".

## Erros comuns

- **Colar o PDF inteiro num arquivo só.** Divida por tema.
- **Sem `source` ou com data inventada.** Sem fonte real, não coloque o arquivo. Data errada é pior do que sem data.
- **Seções gigantes ou minúsculas** (limites de 200 e 2.000 caracteres).
- **Copiar texto de curso, livro ou concorrente.** É a causa mais comum de recusa por direitos.
- **Dado pessoal ou de cliente** no meio do material.
- **Instruções para o modelo escritas dentro do conhecimento.**
- **`valid_until` vencido** (aviso `KNOWLEDGE_EXPIRED`) ou data fora de AAAA-MM-DD (erro `KNOWLEDGE_DATE_INVALID`). Front-matter malformado é erro (`KNOWLEDGE_FRONTMATTER_INVALID`) e faltar `source` também (`KNOWLEDGE_SOURCE_MISSING`).
- **Arquivo acima de 10 MB** ou conhecimento que gera mais de 10.000 trechos.
- Esquecer que **quem compra a licença pode copiar os trechos que lê**: o valor do produto está em manter a base atual e no processo, não em sigilo.

## Formato do result_summary

```
CONHECIMENTO
- Temas/arquivos: N (lista curta de nomes)
- Fontes: lista; direitos confirmados pelo usuário: sim
- Arquivos com source_date: N de N | com valid_until: N | vencidos: 0
- Convertidos de: PDF/planilha/página (quantos) | descartados: motivo
- Manifesto: knowledge.updatedAt=AAAA-MM-DD, reviewEveryDays=N, sources=N
- Validador: ok=true/false | erros: N | avisos: códigos
```

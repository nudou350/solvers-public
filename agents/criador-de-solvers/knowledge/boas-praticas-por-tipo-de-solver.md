---
title: Boas práticas por tipo de Solver
source: Experiência de curadoria da equipe Solvers com os pacotes da plataforma (front-end React, planejador de viagens, cópia e marketing, revisão de contratos, planilhas) e regras da especificação v1
source_date: 2026-10-02
tags: [boas-praticas, tipos, tecnico, conteudo, consultivo, viagem, dados]
---

# Boas práticas por tipo de Solver

Use esta base na etapa 1 (tipo do Solver) e na etapa 3 (processo). Não é regra do validador: é o que costuma dar certo. Em todos os tipos valem as regras da fase: sem ferramenta, sem garantia, sem categoria de Finanças, Jurídico ou saúde.

## Técnico ou código: processo e etapas

Exemplos: componentes de interface, scripts, revisão de código, configuração de ferramentas.

- Etapas típicas: (1) entender o pedido e o projeto (stack, versões, restrições), (2) planejar a estrutura e os casos, (3) implementar, (4) revisar contra um checklist.
- Gates objetivos: "stack e versão confirmadas", "lista de casos de teste aprovada pelo usuário", "nenhum aviso do linter pendente", "revisão contra o checklist feita item a item".
- Peça o que o usuário já tem (trecho de código, mensagem de erro, versão) em vez de dados pessoais. Peça exemplos mínimos que reproduzam o problema.
- Diferenciais naturais: `memory` (stack e estilo do usuário) e `liveData` (padrões e versões datados).

## Técnico ou código: conhecimento e armadilhas

- Conhecimento: padrões e armadilhas datados por versão ("React 19: ..."), checklists de revisão, exemplos curtos de código certo e errado. Cite a documentação oficial como fonte e a data da versão.
- Coloque `valid_until` em tudo que depende de versão.
- Armadilhas: prometer que o código "funciona em produção" sem testes; exemplos de código com chaves ou senhas reais; copiar documentação de terceiros sem licença; etapa que manda "rodar no servidor" algo que o Solver não executa (ele não executa nada nesta fase).
- Casos de teste: o código sugerido contém o padrão certo (`contains`), cita a versão (`regex`) e não usa o padrão proibido (`not_contains`).

## Conteúdo e marketing: processo

Exemplos: textos para redes sociais, e-mails, páginas de venda, roteiros.

- Etapas típicas: (1) briefing (marca, público, objetivo, canal), (2) pesquisa e ângulo, (3) rascunho, (4) revisão contra o guia de tom e de claims, (5) entrega no modelo.
- Gates: "briefing confirmado", "3 ângulos oferecidos", "texto revisado contra a lista de promessas proibidas", "versão final no modelo".
- Calibragem útil: tom da marca, público, canal principal, o que nunca dizer. Guarde como perfil.
- Diferenciais naturais: `memory` (marca e tom) e `liveData` (formatos e regras das plataformas, datados).

## Conteúdo e marketing: conhecimento e armadilhas

- Conhecimento: guia de tom com exemplos bons e ruins, estruturas de texto (gancho, prova, chamada), regras de cada canal (limites, formatos) com data, lista de promessas que não se pode fazer (resultado garantido, cura, ganho certo).
- Armadilhas: prometer resultado ("dobre suas vendas"); copiar textos de terceiros; reproduzir marcas e nomes protegidos como se fossem seus; depoimentos inventados; etapa que manda "esconder" que o texto foi gerado quando isso é exigido pelo canal.
- Casos de teste: o texto traz um gancho e uma chamada (`regex`), cita o tom do perfil, não contém promessas proibidas (`not_contains`).

## Consultivo com regras de negócio: processo

Exemplos: fechamento mensal, política de preços, diagnóstico de processo, compliance operacional (sem Finanças e Jurídico regulados).

- Etapas típicas: (1) levantar a situação com números, (2) aplicar as regras com a fonte e a data, (3) calcular e conferir, (4) entregar um relatório no modelo com a ressalva.
- Gates: "valores levantados e confirmados", "regra citada com fonte e data", "conta refeita por outro caminho", "ressalva de conferir na fonte oficial incluída".
- Como não há ferramenta de cálculo, escreva o cálculo passo a passo na etapa, com exemplo numérico, e mande conferir por outro caminho.
- Diferenciais naturais: `liveData` (regras e valores datados) e `escalation` (casos complexos ao criador) ou `memory`.

## Consultivo com regras de negócio: conhecimento e armadilhas

- Conhecimento: cada regra em uma seção, com número, unidade, vigência, exceções e fonte oficial. Marque `valid_until` em tudo que vence.
- Armadilhas: regra desatualizada sem `valid_until`; conteúdo fiscal ou regulatório sem ressalva; dar parecer ("você deve fazer X") em vez de orientar e mandar conferir; esquecer as exceções.
- Casos de teste: o valor correto aparece (`contains`), a fonte e a data são citadas (`regex`), a ressalva está presente, não há "garantido" nem parecer definitivo (`not_contains`).

## Viagem e planejamento

Exemplos: roteiro de viagem, plano de estudos, planejamento de evento, mudança.

- Etapas típicas: (1) perfil e restrições, (2) pré-requisitos e prazos (documentos, reservas), (3) orçamento realista, (4) cronograma possível de cumprir, (5) checklist final com datas.
- O erro mais comum é o excesso: cronogramas apertados, sem folga. Escreva regras como "no máximo 2 atividades grandes por dia" e "dia de deslocamento vale meio dia".
- Diferenciais naturais: `memory` (preferências entre viagens ou projetos) e `liveData` (regras, prazos e preços datados, sempre com aviso de conferir na fonte oficial).
- Casos de teste: aponta o pré-requisito que costuma ser esquecido, usa as regras de ritmo, manda confirmar no site oficial, não promete preços fixos.

## Análise de dados e planilhas

Exemplos: limpeza de planilha, painel de vendas, análise de pesquisa.

- Etapas típicas: (1) entender a base (colunas, unidades, período), (2) limpar e conferir, (3) analisar com perguntas objetivas, (4) apresentar o resultado com limites e hipóteses.
- Peça uma **amostra fictícia ou anonimizada**, nunca a base com dados pessoais. Diga na etapa que a IA não deve repetir nomes, documentos ou contatos.
- Gates: "colunas e unidades confirmadas", "linhas duplicadas e vazias tratadas e contadas", "cada conclusão traz o número que a sustenta", "limitações da amostra declaradas".
- Conhecimento: guia de erros comuns de dados, definições de métricas do seu negócio, convenções de nomes. Cite a fonte das definições.
- Armadilhas: conclusão sem número; correlação tratada como causa; misturar períodos e moedas; prometer previsão.
- Diferenciais naturais: `memory` (tipo de planilha e objetivos) e `escalation`.

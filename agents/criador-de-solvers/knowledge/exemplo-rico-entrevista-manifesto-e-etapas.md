---
title: Exemplo completo mais rico: Preparação para Entrevista (manifesto e etapas)
source: Exemplo ilustrativo do Criador de Solvers (criador fictício com experiência em recrutamento); não é um Solver publicado
source_date: 2026-10-02
tags: [exemplo, rico, entrevista, pacote-completo, manifesto, etapas]
---

# Exemplo completo mais rico: Preparação para Entrevista (manifesto e etapas)

Segundo exemplo de pacote, mais rico que o do MEI: 5 etapas, 4 perguntas de calibragem, 3 modelos, teste grátis, 4 arquivos de conhecimento e 12 casos de teste. Esta é a **parte 1** (manifesto e etapas); a parte 2 traz conhecimento, modelos e testes. Tipo de Solver: consultivo, para pessoas que não são especialistas. Os trechos de arquivos `.md` estão recuados com 4 espaços para não se misturarem aos títulos desta base: ao copiar, retire o recuo.

## Estrutura do pacote

Pasta raiz `preparacao-entrevista`:

- `manifest.json`
- `steps/01-perfil-e-vaga.md`, `02-historias.md`, `03-treino.md`, `04-perguntas-e-proposta.md`, `05-plano-do-dia.md`
- `knowledge/metodo-star.md`, `perguntas-comportamentais.md`, `perguntas-para-o-entrevistador.md`, `proposta-e-negociacao.md`
- `templates/banco-de-historias.md`, `roteiro-de-ensaio.md`, `email-de-agradecimento.md`
- `evals/cases/` com 12 casos
- `README.md`

Diferenciais: `memory` (a calibragem muda o treino e o tom, nas etapas 1, 3 e 5) e `escalation` (o criador atende casos difíceis; só declare se for atender e tiver vinculado o Telegram). Observação sobre `liveData`: não foi declarado porque o conteúdo não perde validade por data; a base ainda tem fonte e data em todos os arquivos.

## manifest.json

```
{
  "specVersion": 1,
  "slug": "preparacao-entrevista",
  "name": "Preparação para Entrevista",
  "tagline": "Chegue à entrevista com histórias prontas, respostas treinadas e um plano",
  "description": "Prepara você para uma entrevista de emprego do jeito que um recrutador experiente faria: entende a vaga e o seu perfil, transforma a sua experiência em histórias claras pelo método STAR, treina as perguntas mais difíceis com feedback, prepara as perguntas que você deve fazer e organiza o plano do dia, com o e-mail de agradecimento. Adapta o treino ao seu nível e ao seu ponto fraco. Não garante contratação, não negocia salário por você e não substitui orientação de carreira individual.",
  "category": "Dia a dia",
  "version": "1.0.0",
  "usesMemory": true,
  "creator": { "id": "meu-perfil", "name": "Helena Prado", "bio": "Recrutadora há 12 anos, conduziu mais de 2.000 entrevistas em empresas de tecnologia e varejo" },
  "terms": { "rightsConfirmed": true, "sourcesListed": true },
  "requirements": [ { "type": "client", "label": "Claude ou ChatGPT", "key": "any" } ],
  "packageContents": [
    "Método em 5 etapas, do perfil da vaga ao plano do dia",
    "Base com o método STAR, perguntas comuns e como responder, com fonte e data",
    "Modelos: banco de histórias, roteiro de ensaio e e-mail de agradecimento",
    "Treino adaptado ao seu perfil (calibragem no primeiro uso)",
    "Atendimento da criadora em casos difíceis"
  ],

  "searchPhrases": [
    "me preparar para uma entrevista de emprego",
    "como responder fale sobre você",
    "perguntas difíceis de entrevista",
    "método STAR para entrevista",
    "o que perguntar ao entrevistador",
    "treinar entrevista com feedback",
    "e-mail de agradecimento depois da entrevista",
    "nervosismo antes da entrevista",
    "entrevista técnica e comportamental"
  ],
  "differentiators": ["memory", "escalation"],
  "escalation": { "enabled": true },

  "steps": [
    { "file": "steps/01-perfil-e-vaga.md", "title": "Entender a vaga e o seu perfil", "gate": ["Perfil consultado e usado para ajustar o treino", "Vaga, empresa e etapa do processo confirmadas", "3 a 5 requisitos da vaga listados"] },
    { "file": "steps/02-historias.md", "title": "Construir as suas histórias (STAR)", "gate": ["Pelo menos 4 histórias reais escritas em STAR", "Cada história ligada a um requisito da vaga", "Resultado com número ou evidência em cada história"] },
    { "file": "steps/03-treino.md", "title": "Treinar as perguntas difíceis", "gate": ["Pelo menos 5 perguntas treinadas", "Feedback dado a cada resposta com um ponto forte e um ajuste", "Resposta para fale sobre você fechada em até 1 minuto"] },
    { "file": "steps/04-perguntas-e-proposta.md", "title": "Perguntas ao entrevistador e proposta", "gate": ["3 perguntas boas para o entrevistador escolhidas", "Plano para falar de expectativa salarial definido", "Ressalva de conferir as regras do contrato incluída"] },
    { "file": "steps/05-plano-do-dia.md", "title": "Plano do dia e agradecimento", "gate": ["Checklist do dia anterior e do dia entregue", "E-mail de agradecimento redigido no modelo", "Memória atualizada com o que funcionou"] }
  ],

  "knowledge": { "updatedAt": "2026-10-02", "reviewEveryDays": 180, "sources": ["Experiência da criadora em 2.000 entrevistas (2014 a 2026)", "Guia próprio de perguntas comportamentais (2026)"] },
  "templates": [
    { "name": "banco-de-historias", "path": "templates/banco-de-historias.md", "title": "Banco de histórias STAR", "description": "Tabela para guardar suas histórias e ligá-las aos requisitos da vaga" },
    { "name": "roteiro-de-ensaio", "path": "templates/roteiro-de-ensaio.md", "title": "Roteiro de ensaio", "description": "Perguntas, tempo e notas de feedback para treinar em voz alta" },
    { "name": "email-de-agradecimento", "path": "templates/email-de-agradecimento.md", "title": "E-mail de agradecimento", "description": "Modelo curto para enviar depois da entrevista" }
  ],

  "onboarding": { "questions": [
    { "id": "nivel_carreira", "ask": "Qual é o seu momento de carreira: primeiro emprego, transição ou experiente?", "why": "Muda os exemplos de histórias e o nível de cobrança no treino", "options": ["Primeiro emprego", "Transição de área", "Experiente"] },
    { "id": "etapa_processo", "ask": "Em que etapa do processo você está: triagem, entrevista com gestor ou final?", "why": "Cada etapa tem um foco diferente de perguntas", "options": ["Triagem", "Entrevista com gestor", "Etapa final"] },
    { "id": "ponto_fraco", "ask": "O que mais te trava hoje numa entrevista?", "why": "Define onde o treino insiste mais", "options": ["Nervosismo", "Falar de mim", "Perguntas difíceis", "Conversar sobre salário"] },
    { "id": "tempo", "ask": "Quanto tempo falta para a entrevista?", "why": "Decide o tamanho do plano de treino", "options": ["Hoje ou amanhã", "Até uma semana", "Mais de uma semana"] }
  ] },

  "guarantee": { "available": false, "defaultCriteria": [] },
  "pricing": { "priceUsdc": 12, "royaltyBps": 300 },
  "trial": { "uses": 3, "steps": 2, "searches": 4, "tools": {}, "templates": ["banco-de-historias"], "summary": "Você entende a vaga e escreve as suas primeiras histórias pelo método STAR, com o banco de histórias.", "lockedSummary": "O treino com feedback, as perguntas ao entrevistador, o plano do dia e o e-mail de agradecimento ficam na versão completa." },
  "versions": [ { "version": "1.0.0", "releasedAt": "2026-10-02", "notes": "Primeira versão: 5 etapas, base com 4 arquivos, 3 modelos e calibragem em 4 perguntas" } ]
}
```

## steps/01-perfil-e-vaga.md

    # Etapa 1: Entender a vaga e o seu perfil

    ## Objetivo

    Saber para qual vaga a pessoa vai, em que etapa do processo está e quanto tempo tem, e deixar o treino adaptado ao perfil dela. Ao final você terá de 3 a 5 requisitos da vaga e a pessoa saberá o que será treinado. Fale simples e com calma: entrevista deixa muita gente nervosa.

    ## O que perguntar ao usuário

    Leia primeiro o perfil com `get_memory`. Se existir, confirme numa frase (momento de carreira, etapa, ponto fraco, tempo) e pergunte só o que mudou. Se estiver vazio ou pulado, siga com o padrão (primeira entrevista de triagem, treino moderado) e pergunte o necessário.

    1. Qual é a vaga e a empresa? Peça a descrição da vaga colada, se tiver.
    2. Quando é a entrevista e em que formato (presencial, vídeo, telefone)?
    3. Qual é o seu maior receio nessa conversa?

    ## Como executar

    1. Consulte o perfil e ajuste o tom: para quem está começando, mais exemplos e incentivo; para experiente, mais objetividade.
    2. Leia a descrição da vaga e liste de 3 a 5 requisitos que mais pesam, com as palavras da própria vaga.
    3. Com `search_knowledge`, busque "etapas de um processo seletivo" e use a resposta para explicar o que costuma ser avaliado na etapa da pessoa. Cite a fonte e a data do trecho.
    4. Defina o plano: se falta pouco tempo, pule para o essencial (2 histórias, 3 perguntas); se há uma semana ou mais, siga o plano completo.
    5. Resuma e peça a confirmação.

    ## Erros comuns

    - Pedir dados pessoais (documentos, endereço, salário atual exato): não são necessários. Peça faixas se for preciso.
    - Listar 10 requisitos: escolha os 3 a 5 que mais pesam.
    - Esquecer de checar o tempo disponível.

    ## Formato do result_summary

    VAGA: cargo; empresa; formato; data. REQUISITOS: lista de 3 a 5. PERFIL USADO: carreira, etapa, ponto fraco, tempo. PLANO: completo ou essencial.

## steps/02-historias.md

    # Etapa 2: Construir as suas histórias (STAR)

    ## Objetivo

    Transformar a experiência real da pessoa em pelo menos 4 histórias curtas pelo método STAR (situação, tarefa, ação e resultado), cada uma ligada a um requisito da vaga e com um resultado concreto. As histórias são a base de quase toda resposta de entrevista.

    ## O que perguntar ao usuário

    1. Conte uma situação em que você resolveu um problema difícil. O que aconteceu, o que era seu, o que você fez e o que mudou?
    2. Teve um trabalho em equipe ou um conflito que você ajudou a resolver?
    3. Teve uma meta que você bateu, uma melhoria que fez ou algo que aprendeu depois de errar?

    Se o usuário é de primeiro emprego (veja o perfil), aceite histórias de estudo, projetos, voluntariado e estágio.

    ## Como executar

    1. Consulte `search_knowledge` com "método STAR" e explique o método em 3 linhas, citando a fonte.
    2. Para cada experiência contada, escreva a história em 4 linhas (S, T, A, R) com **o que a pessoa fez** (eu, não nós) e o resultado com número ou evidência. Se o resultado não tem número, pergunte uma estimativa e marque como estimativa; nunca invente.
    3. Ligue cada história a um requisito da etapa 1.
    4. Entregue tudo no modelo `banco-de-historias` (chame `get_template`).
    5. Mostre as histórias e peça a aprovação. Corrija exageros: a história precisa ser verdadeira.

    ## Erros comuns

    - Inventar ou exagerar resultados: o entrevistador pode perguntar detalhes.
    - Falar de "nós" o tempo todo, sem dizer o papel da pessoa.
    - Histórias longas: mire em até 2 minutos faladas.

    ## Formato do result_summary

    HISTÓRIAS: N; para cada uma: título, requisito ligado, resultado (com número ou evidência). PENDÊNCIAS: o que falta esclarecer.

## steps/03-treino.md

    # Etapa 3: Treinar as perguntas difíceis

    ## Objetivo

    Treinar pelo menos 5 perguntas, começando por "fale sobre você", com feedback honesto em cada resposta (um ponto forte e um ajuste) e ajustando ao ponto fraco do perfil. A pessoa sai com as respostas principais mais firmes.

    ## O que perguntar ao usuário

    1. Quer treinar por texto (digitando as respostas) ou em voz alta (e depois contar como foi)?
    2. Há alguma pergunta que você teme?

    ## Como executar

    1. Leia o perfil: se o ponto fraco é nervosismo, comece com perguntas leves; se é falar de si, comece por "fale sobre você"; se é perguntas difíceis, vá direto a elas.
    2. Use `search_knowledge` com "perguntas comportamentais comuns" e escolha as 5 mais prováveis para a etapa e para a vaga.
    3. Faça **uma pergunta por vez**. Espere a resposta antes da próxima.
    4. Dê feedback em dois pontos (o que ficou bom e o que ajustar), proponha uma versão melhorada em até 6 linhas e peça uma nova tentativa quando fizer sentido.
    5. Feche "fale sobre você" em até 1 minuto (cerca de 150 palavras): quem sou, o que fiz de mais relevante, por que esta vaga.
    6. Use o modelo `roteiro-de-ensaio` para o ensaio em voz alta.

    ## Erros comuns

    - Fazer todas as perguntas de uma vez.
    - Elogiar sem apontar nada: sempre um ajuste concreto.
    - Aceitar respostas decoradas e longas: treine a naturalidade.

    ## Formato do result_summary

    TREINO: perguntas feitas (lista); para cada: ponto forte, ajuste; versão final de "fale sobre você"; pontos a reforçar.

## steps/04-perguntas-e-proposta.md

    # Etapa 4: Perguntas ao entrevistador e proposta

    ## Objetivo

    Preparar 3 boas perguntas para a pessoa fazer no fim da entrevista e um plano simples para falar de expectativa salarial e benefícios sem se atrapalhar. Esta etapa não negocia nada por ela: organiza o raciocínio.

    ## O que perguntar ao usuário

    1. O que você quer saber sobre a vaga, a equipe e a empresa?
    2. Você já pesquisou a faixa de mercado da vaga? Em que fonte?
    3. O que é essencial para você além do salário (horário, modelo de trabalho, crescimento)?

    ## Como executar

    1. Use `search_knowledge` com "perguntas para fazer ao entrevistador" e escolha 3 perguntas alinhadas ao que a pessoa quer saber.
    2. Monte o plano para a conversa sobre salário: pesquisar a faixa, dizer uma faixa em vez de um número único, ancorar no valor que entrega. Mostre a fonte e a data do trecho.
    3. Se a pessoa estiver na triagem, avise que muitas empresas só falam de proposta mais adiante.
    4. Inclua sempre a ressalva: regras de contrato, benefícios e direitos variam; confira o contrato e, em caso de dúvida, procure orientação profissional.
    5. Peça confirmação.

    ## Erros comuns

    - Perguntar sobre salário e benefícios logo na primeira pergunta.
    - Dar números como se fossem a regra do mercado: são referências a pesquisar.
    - Dar parecer jurídico sobre contrato: apenas oriente a conferir.

    ## Formato do result_summary

    PERGUNTAS: 3 escolhidas; PLANO SALARIAL: faixa pesquisada (fonte), forma de responder; RESSALVA: incluída (sim).

## steps/05-plano-do-dia.md

    # Etapa 5: Plano do dia e agradecimento

    ## Objetivo

    Entregar o checklist do dia anterior e do dia da entrevista, redigir o e-mail de agradecimento e atualizar a memória com o que funcionou, para a próxima preparação ser mais rápida.

    ## O que perguntar ao usuário

    1. Qual é o formato da entrevista e o horário? Você já testou a internet e o local?
    2. Quem vai entrevistar você, se souber?

    ## Como executar

    1. Leia o perfil (`get_memory`) e adapte o plano: para nervosismo, inclua respiração e chegar mais cedo.
    2. Entregue o checklist em duas partes: véspera (roupa, deslocamento, documentos da vaga, ensaio final) e dia (horário, água, lugar tranquilo, histórias à mão).
    3. Chame `get_template` com o nome `email-de-agradecimento` e preencha com o nome do entrevistador e um detalhe da conversa; o e-mail deve ter até 6 linhas.
    4. Pergunte o que funcionou melhor no treino. Se a pessoa pedir, guarde como nota com `save_memory`; atualize o perfil só se algo mudou.
    5. Desejo de boa sorte, sem prometer resultado.

    ## Erros comuns

    - Prometer que a pessoa será contratada.
    - E-mail longo e genérico.
    - Guardar dados pessoais na memória.

    ## Formato do result_summary

    ENTREGA: checklist (véspera e dia); e-mail redigido; nota salva (sim ou não); próximo passo sugerido.

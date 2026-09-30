/* Solver: dados de exemplo (fonte única).
 * Campos das entidades Agent, Creator, License, Review, Escrow, Memory e UserReputation
 * seguem exatamente o contrato combinado. Tudo em "aux" e "profiles" são estruturas de apoio da interface.
 * trend7d = variação percentual em 7 dias da procura e do preço de revenda.
 * Datas são geradas em relação ao dia em que a tela é aberta. */
(function () {
  var DAY = 86400000, HOUR = 3600000, MIN = 60000;
  function unit(u) { return u === 'd' ? DAY : u === 'h' ? HOUR : MIN; }
  function ago(n, u) { return new Date(Date.now() - n * unit(u || 'd')).toISOString(); }
  function ahead(n, u) { return new Date(Date.now() + n * unit(u || 'h')).toISOString(); }
  window.SOLVER = {
 "meta": {
  "usdcBrl": 5.48,
  "rateNote": "Cotação de exemplo. O valor final é confirmado no pagamento.",
  "approvalWindowHours": 72,
  "guaranteeLimits": {
   "limited": 60,
   "full": 500,
   "none": 0
  },
  "fullLevelScore": 80
 },
 "me": {
  "wallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
  "email": "ana.souza@email.com",
  "displayName": "Ana Beatriz Souza",
  "memberSince": ago(120,'d'),
  "creatorId": null
 },
 "session": {
  "creator": {
   "creatorId": "cr_marina",
   "wallet": "Wci3DDmKgpzjqxjmpS97AfJteiPeBuUyNobHbAdf9JVT",
   "email": "marina.costa@email.com"
  }
 },
 "profiles": {
  "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a": {
   "displayName": "Ana Beatriz Souza"
  },
  "KV4RCZqnhWGpY1UjXLnTHA2hUpeMoRhxeKnorGJryU6H": {
   "displayName": "Lucas M."
  },
  "Hc6CksQKXynQv7PAHbXpsqNnWQQGMo3aRBvqEG2L9X1q": {
   "displayName": "Beatriz F."
  },
  "XDy6GmwRjbvq6VsHsQ1fStwVBR4Uqk17fSkQ43LvyHnk": {
   "displayName": "Rodrigo P."
  },
  "mxnrBHT5Jqr75FvZAimz7skfcoHi2teb8uYVpeo71jMw": {
   "displayName": "Paula S."
  },
  "nWsybrJBGhg2Zms9STazHQD1AiLP6s6MCM3aP9b8gq26": {
   "displayName": "Felipe A."
  },
  "x8SzPhJNARL3Z3bXS9fpyb8gLNNyqy6NTdUdNKvXyYWx": {
   "displayName": "Juliana C."
  },
  "AtNMRfP5cCQYr2U8HkJ3D2wv7LdhabNg5wLPB6qkReVM": {
   "displayName": "Marcos T."
  },
  "b2W56QLr5rJEbkoKmTCbS7CTF7tonD5Bf9dnz794hBJH": {
   "displayName": "Carolina D."
  },
  "EekmoBXprNsVb9isXJnkbRK1iAVsFWhfnSxbWw2neH63": {
   "displayName": "André L."
  },
  "zZEe2g9ESVDFRAXB8yi6hav3Do5R5Qz8HydQ6bf2rt7D": {
   "displayName": "Sofia R."
  },
  "t7EpdPG99fjucNkto9c5tznawWh1t3rkxMsGznA6fud6": {
   "displayName": "Gustavo N."
  },
  "RgJZEKMQWxVP87DBFZsrC3ztUmoNtSZ23suafHUrRtQ7": {
   "displayName": "Taís B."
  },
  "JqAWHVS6SEwPup9FRyrkEpPYn7Yjpow27AQ4B7uVGAqz": {
   "displayName": "Vitor H."
  },
  "csX4T6Sp9onaZu3RhTx1Xio35Gxzes3tzH6h3wtCiHBZ": {
   "displayName": "Nina G."
  }
 },
 "categories": [
  {
   "id": "Front-end",
   "name": "Front-end",
   "icon": "code"
  },
  {
   "id": "Back-end",
   "name": "Back-end",
   "icon": "server"
  },
  {
   "id": "Design",
   "name": "Design",
   "icon": "pen"
  },
  {
   "id": "Jurídico",
   "name": "Contratos simples",
   "icon": "scale"
  },
  {
   "id": "Viagens",
   "name": "Viagens",
   "icon": "plane"
  },
  {
   "id": "Dia a dia",
   "name": "Dia a dia",
   "icon": "list-check"
  },
  {
   "id": "Finanças",
   "name": "Finanças",
   "icon": "coin"
  },
  {
   "id": "Escrita",
   "name": "Escrita",
   "icon": "mail"
  },
  {
   "id": "Carreira",
   "name": "Carreira",
   "icon": "briefcase"
  },
  {
   "id": "Estudos",
   "name": "Estudos",
   "icon": "grad"
  },
  {
   "id": "Dados",
   "name": "Dados",
   "icon": "chart"
  }
 ],
 "categoryHue": {
  "Design": 300,
  "Front-end": 250,
  "Back-end": 215,
  "Jurídico": 60,
  "Viagens": 195,
  "Dia a dia": 25,
  "Finanças": 150,
  "Escrita": 345,
  "Carreira": 95,
  "Estudos": 275,
  "Dados": 175
 },
 "keywords": {
  "ag_design": "tela telas app aplicativo interface figma layout visual prototipo ux ui design site landing identidade cores tipografia",
  "ag_react": "react componente componentes frontend front-end site pagina javascript typescript codigo interface formulario hooks teste acessibilidade",
  "ag_node": "node api backend back-end servidor banco autenticacao login rest typescript codigo endpoint",
  "ag_contratos": "contrato contratos aluguel clausula clausulas assinar advogado juridico multa rescisao prestacao servico nda sigilo locacao",
  "ag_viagens": "viagem viagens roteiro passeio ferias hotel voo destino turismo passagem orcamento",
  "ag_rotina": "rotina tarefa tarefas organizar organizacao agenda planejar dia semana produtividade foco habitos lista",
  "ag_financas": "dinheiro gastos orcamento divida dividas financas financeiro planilha poupar investir salario contas",
  "ag_emails": "email emails e-mail mensagem escrever redigir cobranca resposta carta comunicacao texto",
  "ag_carreira": "curriculo linkedin vaga emprego entrevista carreira recrutador trabalho candidatura",
  "ag_sql": "sql dados banco consulta relatorio grafico painel vendas analise metricas planilha",
  "ag_tutor": "estudar estudo prova concurso vestibular resumo simulado faculdade aprender aula enem",
  "ag_conteudo": "blog post posts newsletter redes sociais instagram conteudo texto marketing roteiro video"
 },
 "creators": [
  {
   "id": "cr_marina",
   "name": "Marina Costa",
   "avatarUrl": "/avatares/marina-costa.jpg",
   "bio": "Designer de produto há 11 anos, com passagem por bancos digitais e startups de saúde. Transformo o que aprendi em especialistas que explicam cada decisão de interface.",
   "reputationScore": 96,
   "disputesLost": 0,
   "agentsPublished": 4
  },
  {
   "id": "cr_diego",
   "name": "Diego Farias",
   "avatarUrl": "/avatares/diego-farias.jpg",
   "bio": "Engenheiro front-end, mantenedor de bibliotecas de componentes acessíveis. Escrevo código que o próximo time consegue ler.",
   "reputationScore": 92,
   "disputesLost": 1,
   "agentsPublished": 3
  },
  {
   "id": "cr_helena",
   "name": "Helena Duarte",
   "avatarUrl": "/avatares/helena-duarte.jpg",
   "bio": "Advogada especializada em contratos civis e de consumo. Meus especialistas ajudam você a entender o que vai assinar, sem substituir uma consulta.",
   "reputationScore": 98,
   "disputesLost": 0,
   "agentsPublished": 2
  },
  {
   "id": "cr_thiago",
   "name": "Thiago Lemos",
   "avatarUrl": "/avatares/thiago-lemos.jpg",
   "bio": "Engenheiro de software back-end. Trabalho com APIs de alto volume e bancos de dados relacionais.",
   "reputationScore": 91,
   "disputesLost": 1,
   "agentsPublished": 3
  },
  {
   "id": "cr_camila",
   "name": "Camila Rocha",
   "avatarUrl": "/avatares/camila-rocha.jpg",
   "bio": "Já organizei mais de 200 viagens de amigos e clientes. Meus roteiros consideram tempo de deslocamento, descanso e orçamento de verdade.",
   "reputationScore": 94,
   "disputesLost": 0,
   "agentsPublished": 2
  },
  {
   "id": "cr_bruno",
   "name": "Bruno Tavares",
   "avatarUrl": "/avatares/bruno-tavares.jpg",
   "bio": "Consultor de produtividade pessoal. Prefiro sistemas simples que cabem em uma semana comum.",
   "reputationScore": 88,
   "disputesLost": 2,
   "agentsPublished": 3
  },
  {
   "id": "cr_livia",
   "name": "Lívia Andrade",
   "avatarUrl": "/avatares/livia-andrade.jpg",
   "bio": "Planejadora financeira certificada. Ajudo pessoas a enxergar para onde o dinheiro vai, sem julgamento.",
   "reputationScore": 93,
   "disputesLost": 0,
   "agentsPublished": 1
  },
  {
   "id": "cr_renata",
   "name": "Renata Prado",
   "avatarUrl": "/avatares/renata-prado.jpg",
   "bio": "Trabalho em recrutamento e seleção há 9 anos e já li milhares de currículos.",
   "reputationScore": 90,
   "disputesLost": 0,
   "agentsPublished": 1
  },
  {
   "id": "cr_paulo",
   "name": "Paulo Menezes",
   "avatarUrl": "/avatares/paulo-menezes.jpg",
   "bio": "Professor de cursinho e criador de conteúdo educacional.",
   "reputationScore": 78,
   "disputesLost": 1,
   "agentsPublished": 2
  }
 ],
 "agents": [
  {
   "id": "ag_design",
   "slug": "designer-de-interfaces",
   "name": "Designer de Interfaces",
   "tagline": "Telas bonitas e coerentes, do rascunho ao arquivo pronto no Figma.",
   "description": "Transforma a sua ideia em telas com hierarquia visual clara, espaçamento consistente e componentes reaproveitáveis. Lê e organiza os seus arquivos no Figma e explica a lógica de cada escolha, para você aprender enquanto usa.",
   "category": "Design",
   "creatorId": "cr_marina",
   "version": "3.1.0",
   "priceUsdc": 39,
   "pricePerUseUsdc": 0.5,
   "userRating": 4.9,
   "reviewsCount": 428,
   "verifiedUses": 24760,
   "evalScore": 96,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Figma"
    },
    {
     "type": "plan",
     "label": "Claude Pro ou ChatGPT Plus"
    }
   ],
   "packageContents": [
    "Biblioteca de conhecimento com 60 princípios de interface e padrões de layout",
    "Leitura e edição dos seus arquivos no Figma pelo conector",
    "12 modelos de telas prontos: cadastro, painel, checkout e mais",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 2 dias úteis"
   ],
   "guaranteeAvailable": true,
   "resaleFloorUsdc": 44,
   "trend7d": 12.7,
   "versionHash": "sha256:60d0696a77888679e5c0909cb1be03dc17bae7bbff2d37acb59996cf6a80edf5"
  },
  {
   "id": "ag_react",
   "slug": "react-frontend-senior",
   "name": "React Sênior",
   "tagline": "Componentes React limpos, acessíveis e testados, no padrão de um time sênior.",
   "description": "Escreve, revisa e refatora interfaces em React e TypeScript seguindo boas práticas de acessibilidade, desempenho e testes. Explica cada decisão em linguagem clara e aponta o que pode quebrar no futuro.",
   "category": "Front-end",
   "creatorId": "cr_diego",
   "version": "2.4.1",
   "priceUsdc": 49,
   "pricePerUseUsdc": 0.6,
   "userRating": 4.8,
   "reviewsCount": 312,
   "verifiedUses": 18420,
   "evalScore": 94,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "GitHub"
    },
    {
     "type": "plan",
     "label": "Claude Pro ou ChatGPT Plus"
    }
   ],
   "packageContents": [
    "Guia de arquitetura de componentes com 40 padrões comentados",
    "Leitura do seu repositório pelo conector do GitHub",
    "Modelos de teste com Vitest e Testing Library",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 2 dias úteis"
   ],
   "guaranteeAvailable": true,
   "resaleFloorUsdc": 41,
   "trend7d": 8.4,
   "versionHash": "sha256:78e6bb1a0b116ddb1fa04591c8a01b3d78273fe914d7af6a27a707fe2563930d"
  },
  {
   "id": "ag_node",
   "slug": "node-backend-solido",
   "name": "Node.js API Sólida",
   "tagline": "APIs em Node com autenticação, validação e testes desde o primeiro commit.",
   "description": "Projeta e escreve APIs em Node.js e TypeScript com autenticação, validação de dados, tratamento de erros e testes automatizados. Sugere a estrutura de pastas e revisa o que você já tem.",
   "category": "Back-end",
   "creatorId": "cr_thiago",
   "version": "1.9.0",
   "priceUsdc": 59,
   "pricePerUseUsdc": 0.8,
   "userRating": 4.7,
   "reviewsCount": 205,
   "verifiedUses": 11380,
   "evalScore": 91,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "GitHub"
    },
    {
     "type": "plan",
     "label": "Plano pago com execução de código"
    }
   ],
   "packageContents": [
    "Guia de arquitetura de APIs com decisões explicadas",
    "Leitura do seu repositório e do seu terminal de testes",
    "Modelos de projeto com autenticação e banco de dados",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": true,
   "resaleFloorUsdc": 47,
   "trend7d": 3.1,
   "versionHash": "sha256:fe33f59f491052589007c9af143ce6dc9fd7d15f2f1933362dd24a5d9f3b6d8f"
  },
  {
   "id": "ag_contratos",
   "slug": "revisor-de-contratos-simples",
   "name": "Revisor de Contratos Simples",
   "tagline": "Entenda aluguel, prestação de serviço e NDA antes de assinar.",
   "description": "Lê contratos curtos do dia a dia, destaca cláusulas de risco, prazos e multas e sugere perguntas para você fazer. Não substitui um advogado, mas ajuda você a chegar preparado para a conversa.",
   "category": "Jurídico",
   "creatorId": "cr_helena",
   "version": "1.6.2",
   "priceUsdc": 29,
   "pricePerUseUsdc": 1.5,
   "userRating": 4.8,
   "reviewsCount": 391,
   "verifiedUses": 15230,
   "evalScore": 93,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Google Drive (opcional)"
    },
    {
     "type": "plan",
     "label": "Qualquer plano com envio de PDF"
    }
   ],
   "packageContents": [
    "Guia de cláusulas comuns em contratos de aluguel, serviços e sigilo",
    "Leitura de PDFs e documentos do Google Drive",
    "Modelo de resumo em uma página e lista de perguntas",
    "Atualizações de acordo com mudanças na legislação",
    "Perguntas ao criador, com resposta em até 2 dias úteis"
   ],
   "guaranteeAvailable": true,
   "resaleFloorUsdc": 31,
   "trend7d": 5.9,
   "versionHash": "sha256:9503bc0a8f757a954cc201403fe3fe627ac81d7b88f7caa9bda2bccc965e8fa1"
  },
  {
   "id": "ag_viagens",
   "slug": "planejador-de-viagens",
   "name": "Planejador de Viagens",
   "tagline": "Roteiros realistas, com tempo de deslocamento e orçamento por dia.",
   "description": "Monta roteiros que respeitam o seu ritmo: considera deslocamentos, horários de funcionamento, descanso e quanto você quer gastar por dia. Ajusta tudo quando o plano muda no meio da viagem.",
   "category": "Viagens",
   "creatorId": "cr_camila",
   "version": "2.0.3",
   "priceUsdc": 12,
   "pricePerUseUsdc": 0.4,
   "userRating": 4.7,
   "reviewsCount": 268,
   "verifiedUses": 32140,
   "evalScore": 89,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Google Maps"
    },
    {
     "type": "plan",
     "label": "Gratuito ou pago"
    }
   ],
   "packageContents": [
    "Guia com 30 destinos e dicas de quando ir",
    "Consulta de mapas, distâncias e horários",
    "Modelos de roteiro de 3, 7 e 15 dias",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": 9,
   "trend7d": 2.2,
   "versionHash": "sha256:dae561f7426d4557e62f64f0a20fffd9dc03e1991710cc6b5c1ccfb6cec01310"
  },
  {
   "id": "ag_rotina",
   "slug": "organizador-de-rotina",
   "name": "Organizador de Rotina",
   "tagline": "Transforma a sua lista bagunçada em um dia possível de cumprir.",
   "description": "Recebe tudo o que está na sua cabeça, separa o que é urgente do que é importante e monta o seu dia em blocos realistas. Reorganiza sozinho quando algo atrasa.",
   "category": "Dia a dia",
   "creatorId": "cr_bruno",
   "version": "1.3.0",
   "priceUsdc": 9,
   "pricePerUseUsdc": 0.2,
   "userRating": 4.5,
   "reviewsCount": 512,
   "verifiedUses": 40870,
   "evalScore": 86,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Google Agenda"
    },
    {
     "type": "plan",
     "label": "Gratuito ou pago"
    }
   ],
   "packageContents": [
    "Guia de planejamento semanal em 15 minutos",
    "Leitura e criação de eventos na sua agenda",
    "Modelos de dia, semana e revisão mensal",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": 6,
   "trend7d": 9.3,
   "versionHash": "sha256:94ae8dcdbb62e20bb29dff6b15f97b4dce6461d890dccaef779e178703ec25b2"
  },
  {
   "id": "ag_financas",
   "slug": "orcamento-pessoal",
   "name": "Orçamento Pessoal",
   "tagline": "Organiza gastos, metas e dívidas com planilhas prontas.",
   "description": "Ajuda você a categorizar gastos, montar um orçamento que dá para seguir e traçar um plano para quitar dívidas ou juntar dinheiro. Preenche e atualiza a sua planilha por você.",
   "category": "Finanças",
   "creatorId": "cr_livia",
   "version": "1.5.4",
   "priceUsdc": 15,
   "pricePerUseUsdc": 0.4,
   "userRating": 4.6,
   "reviewsCount": 187,
   "verifiedUses": 9640,
   "evalScore": 88,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Google Planilhas"
    },
    {
     "type": "plan",
     "label": "Gratuito ou pago"
    }
   ],
   "packageContents": [
    "Guia de educação financeira em linguagem simples",
    "Leitura e preenchimento da sua planilha",
    "Modelos de orçamento mensal e plano de quitação",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": 12,
   "trend7d": -1.8,
   "versionHash": "sha256:8f7353b4fd55921cedaf691f06724c7c120554664b4fe036a6c2a11d4788d3c8"
  },
  {
   "id": "ag_emails",
   "slug": "redator-de-emails",
   "name": "Redator de E-mails",
   "tagline": "E-mails claros e educados, no tom certo para cada pessoa.",
   "description": "Escreve e reescreve e-mails de trabalho, cobranças e pedidos difíceis no tom que você precisa: firme, cordial ou direto. Aprende a sua forma de escrever e mantém a sua voz.",
   "category": "Escrita",
   "creatorId": "cr_bruno",
   "version": "1.2.1",
   "priceUsdc": 8,
   "pricePerUseUsdc": 0.15,
   "userRating": 4.6,
   "reviewsCount": 340,
   "verifiedUses": 28110,
   "evalScore": 90,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Gmail (opcional)"
    },
    {
     "type": "plan",
     "label": "Gratuito ou pago"
    }
   ],
   "packageContents": [
    "Guia de tom e estrutura para 25 situações comuns",
    "Rascunhos direto na sua caixa de entrada (opcional)",
    "Modelos de resposta, cobrança e recusa educada",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": 5,
   "trend7d": 0.9,
   "versionHash": "sha256:0e6f13128e285ee354182503bd4a71d6779bda518fa4b69a8f64267f1bf7124a"
  },
  {
   "id": "ag_carreira",
   "slug": "curriculo-e-linkedin",
   "name": "Currículo e LinkedIn",
   "tagline": "Currículo que passa nos filtros e conta bem a sua história.",
   "description": "Revisa o seu currículo e o seu perfil no LinkedIn, adapta o texto para cada vaga e treina você para as perguntas mais comuns de entrevista.",
   "category": "Carreira",
   "creatorId": "cr_renata",
   "version": "1.4.0",
   "priceUsdc": 11,
   "pricePerUseUsdc": 0.3,
   "userRating": 4.7,
   "reviewsCount": 156,
   "verifiedUses": 8770,
   "evalScore": 90,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "plan",
     "label": "Qualquer plano com envio de PDF"
    }
   ],
   "packageContents": [
    "Guia de currículo por área, com exemplos reais anonimizados",
    "Análise do seu currículo contra a descrição da vaga",
    "Modelos de currículo, carta e mensagem para recrutadores",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": 9,
   "trend7d": 4.7,
   "versionHash": "sha256:cb519c1490b29b4621eba59b77edf793141e1eb249d1ec4e8de8684cba329ec5"
  },
  {
   "id": "ag_sql",
   "slug": "analista-sql",
   "name": "SQL e Análise de Dados",
   "tagline": "Perguntas em português viram consultas seguras e gráficos.",
   "description": "Traduz perguntas de negócio em consultas SQL, explica o resultado e sugere o gráfico certo. Trabalha em modo somente leitura, então nada no seu banco é alterado.",
   "category": "Dados",
   "creatorId": "cr_thiago",
   "version": "1.1.0",
   "priceUsdc": 44,
   "pricePerUseUsdc": 0.7,
   "userRating": 4.6,
   "reviewsCount": 97,
   "verifiedUses": 4210,
   "evalScore": 92,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "connector",
     "label": "Banco de dados (somente leitura)"
    },
    {
     "type": "plan",
     "label": "Plano pago com execução de código"
    }
   ],
   "packageContents": [
    "Guia de modelagem e boas práticas de consulta",
    "Conexão segura de leitura ao seu banco de dados",
    "Modelos de painéis e relatórios recorrentes",
    "Atualizações incluídas por 12 meses",
    "Perguntas ao criador, com resposta em até 3 dias úteis"
   ],
   "guaranteeAvailable": true,
   "resaleFloorUsdc": 40,
   "trend7d": 6.4,
   "versionHash": "sha256:384ec033f621a4af4bee88e6dcba772774d2583a8020558318318949ac02ca5b"
  },
  {
   "id": "ag_tutor",
   "slug": "tutor-de-estudos",
   "name": "Tutor de Estudos",
   "tagline": "Resumos, mapas mentais e simulados no seu ritmo.",
   "description": "Transforma o seu material de estudo em resumos, cartões de revisão e simulados. Descobre onde você erra mais e reorganiza o cronograma até a prova.",
   "category": "Estudos",
   "creatorId": "cr_paulo",
   "version": "1.0.2",
   "priceUsdc": 14,
   "pricePerUseUsdc": 0.3,
   "userRating": 4.4,
   "reviewsCount": 41,
   "verifiedUses": 1930,
   "evalScore": 84,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "plan",
     "label": "Qualquer plano com envio de PDF"
    }
   ],
   "packageContents": [
    "Guia de técnicas de estudo com evidências",
    "Leitura dos seus PDFs e anotações",
    "Modelos de cronograma, resumo e simulado",
    "Atualizações incluídas por 6 meses",
    "Perguntas ao criador, com resposta em até 4 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": null,
   "trend7d": 21.5,
   "versionHash": "sha256:c34547b178b3774e15c45b2085405790267de9b0779c1044f4748f3098a19c41"
  },
  {
   "id": "ag_conteudo",
   "slug": "redator-de-conteudo",
   "name": "Redator de Conteúdo",
   "tagline": "Textos de blog e redes sociais com a sua voz, sem cara de robô.",
   "description": "Planeja e escreve posts, newsletters e roteiros curtos mantendo o seu jeito de falar. Sugere pautas com base no que o seu público pergunta.",
   "category": "Escrita",
   "creatorId": "cr_paulo",
   "version": "1.0.0",
   "priceUsdc": 19,
   "pricePerUseUsdc": 0.35,
   "userRating": 4.3,
   "reviewsCount": 22,
   "verifiedUses": 870,
   "evalScore": 82,
   "requirements": [
    {
     "type": "client",
     "label": "Claude"
    },
    {
     "type": "client",
     "label": "ChatGPT"
    },
    {
     "type": "plan",
     "label": "Gratuito ou pago"
    }
   ],
   "packageContents": [
    "Guia de voz e tom de marca em 5 perguntas",
    "Calendário editorial gerado a partir das suas respostas",
    "Modelos de post, newsletter e roteiro",
    "Atualizações incluídas por 6 meses",
    "Perguntas ao criador, com resposta em até 4 dias úteis"
   ],
   "guaranteeAvailable": false,
   "resaleFloorUsdc": null,
   "trend7d": 17.9,
   "versionHash": "sha256:da656d11d0b35a906c994cb987c67599551bb6a2c4c468deaf7e4a7e6a9d797a"
  }
 ],
 "licenses": [
  {
   "id": "lic_01",
   "agentId": "ag_design",
   "ownerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "acquiredAt": ago(41,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": false,
   "resalePriceUsdc": null
  },
  {
   "id": "lic_02",
   "agentId": "ag_contratos",
   "ownerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "acquiredAt": ago(12,'d'),
   "type": "credits",
   "creditsLeft": 6,
   "listedForResale": false,
   "resalePriceUsdc": null
  },
  {
   "id": "lic_03",
   "agentId": "ag_viagens",
   "ownerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "acquiredAt": ago(90,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 10
  },
  {
   "id": "lic_04",
   "agentId": "ag_rotina",
   "ownerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "acquiredAt": ago(8,'d'),
   "type": "credits",
   "creditsLeft": 31,
   "listedForResale": false,
   "resalePriceUsdc": null
  },
  {
   "id": "lic_05",
   "agentId": "ag_emails",
   "ownerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "acquiredAt": ago(27,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": false,
   "resalePriceUsdc": null
  },
  {
   "id": "lic_r01",
   "agentId": "ag_design",
   "ownerWallet": "AtNMRfP5cCQYr2U8HkJ3D2wv7LdhabNg5wLPB6qkReVM",
   "acquiredAt": ago(64,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 44
  },
  {
   "id": "lic_r02",
   "agentId": "ag_design",
   "ownerWallet": "RgJZEKMQWxVP87DBFZsrC3ztUmoNtSZ23suafHUrRtQ7",
   "acquiredAt": ago(120,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 46
  },
  {
   "id": "lic_r03",
   "agentId": "ag_design",
   "ownerWallet": "zZEe2g9ESVDFRAXB8yi6hav3Do5R5Qz8HydQ6bf2rt7D",
   "acquiredAt": ago(33,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 49
  },
  {
   "id": "lic_r04",
   "agentId": "ag_react",
   "ownerWallet": "XDy6GmwRjbvq6VsHsQ1fStwVBR4Uqk17fSkQ43LvyHnk",
   "acquiredAt": ago(76,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 41
  },
  {
   "id": "lic_r05",
   "agentId": "ag_react",
   "ownerWallet": "Hc6CksQKXynQv7PAHbXpsqNnWQQGMo3aRBvqEG2L9X1q",
   "acquiredAt": ago(52,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 43
  },
  {
   "id": "lic_r06",
   "agentId": "ag_react",
   "ownerWallet": "EekmoBXprNsVb9isXJnkbRK1iAVsFWhfnSxbWw2neH63",
   "acquiredAt": ago(140,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 47
  },
  {
   "id": "lic_r07",
   "agentId": "ag_node",
   "ownerWallet": "t7EpdPG99fjucNkto9c5tznawWh1t3rkxMsGznA6fud6",
   "acquiredAt": ago(88,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 47
  },
  {
   "id": "lic_r08",
   "agentId": "ag_node",
   "ownerWallet": "JqAWHVS6SEwPup9FRyrkEpPYn7Yjpow27AQ4B7uVGAqz",
   "acquiredAt": ago(45,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 52
  },
  {
   "id": "lic_r09",
   "agentId": "ag_contratos",
   "ownerWallet": "mxnrBHT5Jqr75FvZAimz7skfcoHi2teb8uYVpeo71jMw",
   "acquiredAt": ago(29,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 31
  },
  {
   "id": "lic_r10",
   "agentId": "ag_contratos",
   "ownerWallet": "csX4T6Sp9onaZu3RhTx1Xio35Gxzes3tzH6h3wtCiHBZ",
   "acquiredAt": ago(71,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 33
  },
  {
   "id": "lic_r11",
   "agentId": "ag_viagens",
   "ownerWallet": "JqAWHVS6SEwPup9FRyrkEpPYn7Yjpow27AQ4B7uVGAqz",
   "acquiredAt": ago(101,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 9
  },
  {
   "id": "lic_r12",
   "agentId": "ag_rotina",
   "ownerWallet": "KV4RCZqnhWGpY1UjXLnTHA2hUpeMoRhxeKnorGJryU6H",
   "acquiredAt": ago(60,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 6
  },
  {
   "id": "lic_r13",
   "agentId": "ag_financas",
   "ownerWallet": "b2W56QLr5rJEbkoKmTCbS7CTF7tonD5Bf9dnz794hBJH",
   "acquiredAt": ago(84,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 12
  },
  {
   "id": "lic_r14",
   "agentId": "ag_emails",
   "ownerWallet": "nWsybrJBGhg2Zms9STazHQD1AiLP6s6MCM3aP9b8gq26",
   "acquiredAt": ago(39,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 5
  },
  {
   "id": "lic_r15",
   "agentId": "ag_sql",
   "ownerWallet": "EekmoBXprNsVb9isXJnkbRK1iAVsFWhfnSxbWw2neH63",
   "acquiredAt": ago(22,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 40
  },
  {
   "id": "lic_r16",
   "agentId": "ag_carreira",
   "ownerWallet": "x8SzPhJNARL3Z3bXS9fpyb8gLNNyqy6NTdUdNKvXyYWx",
   "acquiredAt": ago(57,'d'),
   "type": "permanent",
   "creditsLeft": null,
   "listedForResale": true,
   "resalePriceUsdc": 9
  }
 ],
 "reviews": [
  {
   "id": "rv_01",
   "agentId": "ag_design",
   "authorWallet": "x8SzPhJNARL3Z3bXS9fpyb8gLNNyqy6NTdUdNKvXyYWx",
   "rating": 5,
   "text": "Eu não sabia nem por onde começar as telas do meu aplicativo. Em uma tarde tinha o fluxo inteiro e o arquivo organizado no Figma. O mais legal é que ele explica por que escolheu cada coisa.",
   "createdAt": ago(3,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_02",
   "agentId": "ag_design",
   "authorWallet": "KV4RCZqnhWGpY1UjXLnTHA2hUpeMoRhxeKnorGJryU6H",
   "rating": 5,
   "text": "A diferença para usar só o Claude é enorme. As telas têm ritmo e espaçamento de quem entende do assunto, e os componentes já saem nomeados.",
   "createdAt": ago(6,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_03",
   "agentId": "ag_design",
   "authorWallet": "b2W56QLr5rJEbkoKmTCbS7CTF7tonD5Bf9dnz794hBJH",
   "rating": 4,
   "text": "Muito bom para criar telas novas. Para ajustar um sistema de design que já existe ele às vezes sugere mudanças maiores do que eu queria, mas responde bem quando peço para manter o que está.",
   "createdAt": ago(9,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_04",
   "agentId": "ag_design",
   "authorWallet": "AtNMRfP5cCQYr2U8HkJ3D2wv7LdhabNg5wLPB6qkReVM",
   "rating": 5,
   "text": "Comprei a licença permanente e já revendi uma cópia quando parei de precisar. Fácil e sem burocracia.",
   "createdAt": ago(14,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_05",
   "agentId": "ag_design",
   "authorWallet": "RgJZEKMQWxVP87DBFZsrC3ztUmoNtSZ23suafHUrRtQ7",
   "rating": 5,
   "text": "Uso todo dia para revisar telas do meu time. A auditoria de acessibilidade da versão 3.1 pegou contrastes que ninguém tinha percebido.",
   "createdAt": ago(18,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_06",
   "agentId": "ag_design",
   "authorWallet": "nWsybrJBGhg2Zms9STazHQD1AiLP6s6MCM3aP9b8gq26",
   "rating": 3,
   "text": "Bom conteúdo, mas precisei conectar o Figma duas vezes até funcionar. Depois disso, sem problemas.",
   "createdAt": ago(22,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_07",
   "agentId": "ag_design",
   "authorWallet": "zZEe2g9ESVDFRAXB8yi6hav3Do5R5Qz8HydQ6bf2rt7D",
   "rating": 5,
   "text": "O criador respondeu minha dúvida em menos de um dia. Isso pesou na decisão de comprar.",
   "createdAt": ago(31,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_08",
   "agentId": "ag_react",
   "authorWallet": "XDy6GmwRjbvq6VsHsQ1fStwVBR4Uqk17fSkQ43LvyHnk",
   "rating": 5,
   "text": "Refatorou um formulário gigante em componentes pequenos e ainda escreveu os testes. Passou de primeira na revisão do meu time.",
   "createdAt": ago(4,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_09",
   "agentId": "ag_react",
   "authorWallet": "Hc6CksQKXynQv7PAHbXpsqNnWQQGMo3aRBvqEG2L9X1q",
   "rating": 5,
   "text": "Explica os motivos das mudanças em linguagem clara. Aprendi mais do que em um curso.",
   "createdAt": ago(11,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_10",
   "agentId": "ag_react",
   "authorWallet": "EekmoBXprNsVb9isXJnkbRK1iAVsFWhfnSxbWw2neH63",
   "rating": 4,
   "text": "Ótimo em componentes e acessibilidade. Em projetos muito grandes preciso dividir o pedido em partes.",
   "createdAt": ago(19,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_11",
   "agentId": "ag_contratos",
   "authorWallet": "mxnrBHT5Jqr75FvZAimz7skfcoHi2teb8uYVpeo71jMw",
   "rating": 5,
   "text": "Antes de assinar meu aluguel, ele apontou uma multa de rescisão bem acima do normal. Levei a pergunta para a imobiliária e consegui renegociar.",
   "createdAt": ago(2,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_12",
   "agentId": "ag_contratos",
   "authorWallet": "t7EpdPG99fjucNkto9c5tznawWh1t3rkxMsGznA6fud6",
   "rating": 5,
   "text": "Resumo de uma página e lista de perguntas. Exatamente o que eu precisava para conversar com o advogado sem perder tempo.",
   "createdAt": ago(8,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_13",
   "agentId": "ag_viagens",
   "authorWallet": "JqAWHVS6SEwPup9FRyrkEpPYn7Yjpow27AQ4B7uVGAqz",
   "rating": 5,
   "text": "O roteiro de 10 dias respeitou o meu orçamento por dia e ainda deixou tempo livre.",
   "createdAt": ago(5,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_14",
   "agentId": "ag_viagens",
   "authorWallet": "csX4T6Sp9onaZu3RhTx1Xio35Gxzes3tzH6h3wtCiHBZ",
   "rating": 4,
   "text": "Muito prático. Poderia sugerir mais opções de restaurante fora do centro.",
   "createdAt": ago(13,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_15",
   "agentId": "ag_rotina",
   "authorWallet": "KV4RCZqnhWGpY1UjXLnTHA2hUpeMoRhxeKnorGJryU6H",
   "rating": 4,
   "text": "Consegui finalmente separar o urgente do importante. A integração com a agenda economiza muito tempo.",
   "createdAt": ago(7,'d'),
   "verifiedPurchase": true
  },
  {
   "id": "rv_16",
   "agentId": "ag_sql",
   "authorWallet": "EekmoBXprNsVb9isXJnkbRK1iAVsFWhfnSxbWw2neH63",
   "rating": 5,
   "text": "Perguntei em português por que as vendas caíram em uma região e ele montou a consulta e o gráfico. Nada foi alterado no banco.",
   "createdAt": ago(10,'d'),
   "verifiedPurchase": true
  }
 ],
 "escrows": [
  {
   "id": "esc_01",
   "agentId": "ag_design",
   "buyerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "amountUsdc": 45,
   "status": "active",
   "milestones": [
    {
     "title": "Fluxo e estrutura das telas",
     "criteria": "Fluxo com 6 telas cobrindo cadastro, busca, agendamento, pagamento, histórico e perfil",
     "status": "approved"
    },
    {
     "title": "Telas em alta fidelidade",
     "criteria": "Todas as telas usam a paleta e a tipografia combinadas, com contraste mínimo de 4,5:1 nos textos",
     "status": "in_review"
    },
    {
     "title": "Arquivo organizado no Figma",
     "criteria": "Componentes nomeados, estilos de cor e texto criados e nenhuma camada solta",
     "status": "pending"
    }
   ],
   "autoReleaseAt": ahead(43,'h')
  },
  {
   "id": "esc_02",
   "agentId": "ag_contratos",
   "buyerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "amountUsdc": 12,
   "status": "active",
   "milestones": [
    {
     "title": "Leitura e resumo do contrato",
     "criteria": "Resumo de até uma página com partes, valor, prazo e forma de pagamento",
     "status": "approved"
    },
    {
     "title": "Cláusulas de risco",
     "criteria": "Lista de pelo menos 5 pontos de atenção, cada um com o trecho original e uma pergunta sugerida",
     "status": "in_review"
    }
   ],
   "autoReleaseAt": ahead(19,'h')
  },
  {
   "id": "esc_03",
   "agentId": "ag_react",
   "buyerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "amountUsdc": 60,
   "status": "active",
   "milestones": [
    {
     "title": "Análise do formulário atual",
     "criteria": "Relatório apontando ao menos os 5 principais problemas de acessibilidade e desempenho",
     "status": "approved"
    },
    {
     "title": "Migração para React Hook Form",
     "criteria": "Todos os campos migrados, com as mesmas validações do formulário original",
     "status": "pending"
    },
    {
     "title": "Testes passando",
     "criteria": "Cobertura mínima de 80% nos componentes alterados e todos os testes verdes",
     "status": "pending"
    }
   ],
   "autoReleaseAt": null
  },
  {
   "id": "esc_04",
   "agentId": "ag_sql",
   "buyerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "amountUsdc": 30,
   "status": "disputed",
   "milestones": [
    {
     "title": "Consulta de vendas por região",
     "criteria": "Totais por região batem com o relatório de conferência enviado",
     "status": "failed"
    }
   ],
   "autoReleaseAt": null
  },
  {
   "id": "esc_05",
   "agentId": "ag_contratos",
   "buyerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "amountUsdc": 9,
   "status": "approved",
   "milestones": [
    {
     "title": "Resumo de contrato de prestação de serviço",
     "criteria": "Resumo de uma página com prazos e multas",
     "status": "approved"
    }
   ],
   "autoReleaseAt": null
  },
  {
   "id": "esc_06",
   "agentId": "ag_react",
   "buyerWallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "amountUsdc": 40,
   "status": "refunded",
   "milestones": [
    {
     "title": "Componente de tabela com ordenação",
     "criteria": "Ordenação por teclado e leitor de tela funcionando",
     "status": "failed"
    }
   ],
   "autoReleaseAt": null
  }
 ],
 "memories": [
  {
   "id": "mem_01",
   "agentId": "ag_design",
   "summary": "Você trabalha com um aplicativo de agendamento e prefere interfaces claras, com bastante espaço em branco.",
   "updatedAt": ago(3,'d')
  },
  {
   "id": "mem_02",
   "agentId": "ag_design",
   "summary": "Seu sistema usa espaçamento em múltiplos de 8 px e cantos arredondados de 12 px.",
   "updatedAt": ago(9,'d')
  },
  {
   "id": "mem_03",
   "agentId": "ag_design",
   "summary": "Seu arquivo principal no Figma se chama \"App Agenda v2\".",
   "updatedAt": ago(15,'d')
  },
  {
   "id": "mem_04",
   "agentId": "ag_contratos",
   "summary": "Você costuma revisar contratos como pessoa física, principalmente aluguel e prestação de serviço.",
   "updatedAt": ago(2,'d')
  },
  {
   "id": "mem_05",
   "agentId": "ag_contratos",
   "summary": "Você prefere um resumo de até 10 linhas antes da análise completa.",
   "updatedAt": ago(12,'d')
  },
  {
   "id": "mem_06",
   "agentId": "ag_viagens",
   "summary": "Seu orçamento médio de viagem é de R$ 350 por dia e você prefere hospedagem perto do metrô.",
   "updatedAt": ago(33,'d')
  },
  {
   "id": "mem_07",
   "agentId": "ag_viagens",
   "summary": "Você evita voos com escala longa e costuma sair de Guarulhos.",
   "updatedAt": ago(33,'d')
  },
  {
   "id": "mem_08",
   "agentId": "ag_rotina",
   "summary": "Você rende mais nas primeiras horas da manhã e prefere blocos de foco de 50 minutos.",
   "updatedAt": ago(4,'d')
  },
  {
   "id": "mem_09",
   "agentId": "ag_emails",
   "summary": "Seu tom padrão é cordial e direto, e você assina as mensagens como \"Ana\".",
   "updatedAt": ago(20,'d')
  }
 ],
 "userReputations": [
  {
   "wallet": "3XbrVXkmfnq94h1EUZnEaG1ur3MY8hkHjDyBkuGG325a",
   "score": 74,
   "purchases": 5,
   "disputesLost": 0,
   "guaranteeLevel": "limited"
  },
  {
   "wallet": "KV4RCZqnhWGpY1UjXLnTHA2hUpeMoRhxeKnorGJryU6H",
   "score": 91,
   "purchases": 23,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "Hc6CksQKXynQv7PAHbXpsqNnWQQGMo3aRBvqEG2L9X1q",
   "score": 86,
   "purchases": 14,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "XDy6GmwRjbvq6VsHsQ1fStwVBR4Uqk17fSkQ43LvyHnk",
   "score": 88,
   "purchases": 17,
   "disputesLost": 1,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "mxnrBHT5Jqr75FvZAimz7skfcoHi2teb8uYVpeo71jMw",
   "score": 82,
   "purchases": 9,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "nWsybrJBGhg2Zms9STazHQD1AiLP6s6MCM3aP9b8gq26",
   "score": 58,
   "purchases": 3,
   "disputesLost": 1,
   "guaranteeLevel": "limited"
  },
  {
   "wallet": "x8SzPhJNARL3Z3bXS9fpyb8gLNNyqy6NTdUdNKvXyYWx",
   "score": 79,
   "purchases": 6,
   "disputesLost": 0,
   "guaranteeLevel": "limited"
  },
  {
   "wallet": "AtNMRfP5cCQYr2U8HkJ3D2wv7LdhabNg5wLPB6qkReVM",
   "score": 93,
   "purchases": 31,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "b2W56QLr5rJEbkoKmTCbS7CTF7tonD5Bf9dnz794hBJH",
   "score": 84,
   "purchases": 11,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "EekmoBXprNsVb9isXJnkbRK1iAVsFWhfnSxbWw2neH63",
   "score": 90,
   "purchases": 19,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "zZEe2g9ESVDFRAXB8yi6hav3Do5R5Qz8HydQ6bf2rt7D",
   "score": 77,
   "purchases": 5,
   "disputesLost": 0,
   "guaranteeLevel": "limited"
  },
  {
   "wallet": "t7EpdPG99fjucNkto9c5tznawWh1t3rkxMsGznA6fud6",
   "score": 81,
   "purchases": 8,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "RgJZEKMQWxVP87DBFZsrC3ztUmoNtSZ23suafHUrRtQ7",
   "score": 89,
   "purchases": 21,
   "disputesLost": 0,
   "guaranteeLevel": "full"
  },
  {
   "wallet": "JqAWHVS6SEwPup9FRyrkEpPYn7Yjpow27AQ4B7uVGAqz",
   "score": 72,
   "purchases": 4,
   "disputesLost": 0,
   "guaranteeLevel": "limited"
  },
  {
   "wallet": "csX4T6Sp9onaZu3RhTx1Xio35Gxzes3tzH6h3wtCiHBZ",
   "score": 35,
   "purchases": 1,
   "disputesLost": 0,
   "guaranteeLevel": "none"
  }
 ],
 "aux": {
  "ratingDist": {
   "ag_design": [
    89,
    8,
    2,
    1,
    0
   ],
   "ag_react": [
    84,
    12,
    3,
    1,
    0
   ],
   "ag_contratos": [
    86,
    10,
    3,
    1,
    0
   ]
  },
  "publishedAt": {
   "ag_design": ago(310,'d'),
   "ag_react": ago(420,'d'),
   "ag_node": ago(260,'d'),
   "ag_contratos": ago(500,'d'),
   "ag_viagens": ago(480,'d'),
   "ag_rotina": ago(390,'d'),
   "ag_financas": ago(230,'d'),
   "ag_emails": ago(350,'d'),
   "ag_carreira": ago(140,'d'),
   "ag_sql": ago(38,'d'),
   "ag_tutor": ago(16,'d'),
   "ag_conteudo": ago(9,'d')
  },
  "priceHistory": {
   "ag_design": [
    39.0,
    40.5,
    41.2,
    42.0,
    42.8,
    43.5,
    44.0
   ],
   "ag_react": [
    38.0,
    38.4,
    39.0,
    39.6,
    40.1,
    40.6,
    41.0
   ],
   "ag_node": [
    46.0,
    46.6,
    46.2,
    46.8,
    46.9,
    47.0,
    47.0
   ],
   "ag_contratos": [
    29.0,
    29.6,
    30.0,
    30.2,
    30.6,
    30.8,
    31.0
   ],
   "ag_viagens": [
    8.6,
    8.7,
    8.8,
    8.8,
    8.9,
    9.0,
    9.0
   ],
   "ag_rotina": [
    5.2,
    5.3,
    5.5,
    5.6,
    5.8,
    5.9,
    6.0
   ],
   "ag_financas": [
    12.4,
    12.3,
    12.2,
    12.2,
    12.1,
    12.1,
    12.0
   ],
   "ag_emails": [
    5.0,
    5.0,
    5.1,
    5.0,
    5.0,
    5.0,
    5.0
   ],
   "ag_carreira": [
    8.5,
    8.6,
    8.6,
    8.8,
    8.9,
    9.0,
    9.0
   ],
   "ag_sql": [
    37.5,
    38.0,
    38.6,
    39.0,
    39.5,
    39.8,
    40.0
   ]
  },
  "usage": {
   "lic_01": {
    "usesThisMonth": 38,
    "series": [
     4,
     6,
     5,
     9,
     7,
     11,
     8,
     12
    ],
    "creditsTotal": null
   },
   "lic_02": {
    "usesThisMonth": 9,
    "series": [
     0,
     0,
     1,
     2,
     3,
     4,
     2,
     5
    ],
    "creditsTotal": 15
   },
   "lic_03": {
    "usesThisMonth": 2,
    "series": [
     0,
     3,
     0,
     0,
     5,
     0,
     1,
     1
    ],
    "creditsTotal": null
   },
   "lic_04": {
    "usesThisMonth": 19,
    "series": [
     0,
     0,
     0,
     0,
     0,
     6,
     9,
     10
    ],
    "creditsTotal": 50
   },
   "lic_05": {
    "usesThisMonth": 14,
    "series": [
     0,
     0,
     2,
     3,
     4,
     3,
     5,
     6
    ],
    "creditsTotal": null
   }
  },
  "baselineEval": {
   "ag_design": 58,
   "ag_react": 61,
   "ag_node": 57,
   "ag_contratos": 52,
   "ag_sql": 55
  },
  "versionHistory": {
   "ag_design": [
    {
     "version": "3.1.0",
     "date": ago(12,'d'),
     "notes": "Nova auditoria de acessibilidade: contraste, tamanho de toques e ordem de leitura.",
     "hash": "sha256:60d0696a77888679e5c0909cb1be03dc17bae7bbff2d37acb59996cf6a80edf5"
    },
    {
     "version": "3.0.0",
     "date": ago(64,'d'),
     "notes": "Suporte a variáveis e modos do Figma. Novos modelos de tela de painel.",
     "hash": "sha256:497977f7f38bb590731da7bed5839256654d8ae888fef4bc83dae3f8937eb39b"
    },
    {
     "version": "2.8.2",
     "date": ago(118,'d'),
     "notes": "Correção na leitura de componentes com variantes aninhadas.",
     "hash": "sha256:4845c77f3df5eca058f0739264aa229c02f66cedcebe6f58c51b3aaf6e471a96"
    },
    {
     "version": "2.7.0",
     "date": ago(190,'d'),
     "notes": "Modelos de cadastro e checkout com estados de erro.",
     "hash": "sha256:54ba58e8beb12d308c34f50591dd39c4a6205b5eda42d03066583d2568512ee5"
    }
   ]
  },
  "creatorStats": {
   "cr_marina": {
    "salesLast30": 142,
    "usesLast30": 9130,
    "salesRevenueUsdc": 4380,
    "royaltiesUsdc": 612,
    "disputesOpen": 1,
    "disputesTotal": 3,
    "daily": [
     {
      "day": 1,
      "sales": 117,
      "royalties": 16
     },
     {
      "day": 2,
      "sales": 131,
      "royalties": 19
     },
     {
      "day": 3,
      "sales": 175,
      "royalties": 20
     },
     {
      "day": 4,
      "sales": 125,
      "royalties": 12
     },
     {
      "day": 5,
      "sales": 132,
      "royalties": 10
     },
     {
      "day": 6,
      "sales": 143,
      "royalties": 16
     },
     {
      "day": 7,
      "sales": 97,
      "royalties": 15
     },
     {
      "day": 8,
      "sales": 138,
      "royalties": 24
     },
     {
      "day": 9,
      "sales": 155,
      "royalties": 22
     },
     {
      "day": 10,
      "sales": 178,
      "royalties": 21
     },
     {
      "day": 11,
      "sales": 91,
      "royalties": 21
     },
     {
      "day": 12,
      "sales": 119,
      "royalties": 23
     },
     {
      "day": 13,
      "sales": 93,
      "royalties": 14
     },
     {
      "day": 14,
      "sales": 191,
      "royalties": 19
     },
     {
      "day": 15,
      "sales": 178,
      "royalties": 14
     },
     {
      "day": 16,
      "sales": 90,
      "royalties": 29
     },
     {
      "day": 17,
      "sales": 223,
      "royalties": 13
     },
     {
      "day": 18,
      "sales": 223,
      "royalties": 28
     },
     {
      "day": 19,
      "sales": 182,
      "royalties": 13
     },
     {
      "day": 20,
      "sales": 178,
      "royalties": 26
     },
     {
      "day": 21,
      "sales": 113,
      "royalties": 19
     },
     {
      "day": 22,
      "sales": 93,
      "royalties": 21
     },
     {
      "day": 23,
      "sales": 172,
      "royalties": 30
     },
     {
      "day": 24,
      "sales": 102,
      "royalties": 13
     },
     {
      "day": 25,
      "sales": 124,
      "royalties": 14
     },
     {
      "day": 26,
      "sales": 133,
      "royalties": 32
     },
     {
      "day": 27,
      "sales": 101,
      "royalties": 24
     },
     {
      "day": 28,
      "sales": 172,
      "royalties": 15
     },
     {
      "day": 29,
      "sales": 170,
      "royalties": 35
     },
     {
      "day": 30,
      "sales": 241,
      "royalties": 34
     }
    ],
    "agents": [
     {
      "agentId": "ag_design",
      "sales": 86,
      "uses": 6210,
      "revenueUsdc": 3354,
      "status": "Publicado"
     },
     {
      "agentId": "ag_dsystem",
      "name": "Sistemas de Design",
      "version": "1.8.0",
      "userRating": 4.7,
      "evalScore": 92,
      "sales": 34,
      "uses": 2210,
      "revenueUsdc": 816,
      "status": "Publicado"
     },
     {
      "agentId": "ag_landing",
      "name": "Páginas de Venda",
      "version": "1.2.1",
      "userRating": 4.5,
      "evalScore": 88,
      "sales": 15,
      "uses": 510,
      "revenueUsdc": 150,
      "status": "Publicado"
     },
     {
      "agentId": "ag_marca",
      "name": "Guia de Marca",
      "version": "1.0.0",
      "userRating": 4.4,
      "evalScore": 85,
      "sales": 7,
      "uses": 200,
      "revenueUsdc": 60,
      "status": "Publicado"
     }
    ],
    "disputes": [
     {
      "taskTitle": "Telas de onboarding",
      "criterion": "Contraste mínimo de 4,5:1 nos textos",
      "result": "Em análise",
      "amountUsdc": 39,
      "openedAt": ago(1,'d')
     },
     {
      "taskTitle": "Painel de vendas",
      "criterion": "Componentes nomeados no Figma",
      "result": "Favorável ao criador",
      "amountUsdc": 39,
      "openedAt": ago(19,'d')
     },
     {
      "taskTitle": "Tela de checkout",
      "criterion": "Fluxo com estados de erro",
      "result": "Favorável ao criador",
      "amountUsdc": 24,
      "openedAt": ago(52,'d')
     }
    ]
   }
  },
  "taskTitles": {
   "esc_01": "Criar as telas do aplicativo de agendamento",
   "esc_02": "Revisar o contrato de aluguel comercial",
   "esc_03": "Migrar o formulário de cadastro para React Hook Form",
   "esc_04": "Relatório de vendas por região",
   "esc_05": "Resumo do contrato de prestação de serviço",
   "esc_06": "Componente de tabela acessível"
  },
  "technical": {
   "network": "Solana (rede de testes)",
   "usdcMint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
   "programId": "So1verLic3nseXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
   "licenseAccounts": {
    "lic_01": "qSYeQqDUSuAHFBeFfKadbch1Ueif5V9j146D74sDrcf2",
    "lic_02": "HFhm68k2nSWxhG8cf7pewxSCE6xWae6UrZktVKB5AD4V",
    "lic_03": "rJX9h7nBwXNHtA6JryEZ1yiFxsJjXGmPBGvaZnbySnRi",
    "lic_04": "19yYz7xuehvvUKdB5xeYXzK7BrxJoof1YdyLt8EU4H8f",
    "lic_05": "BDrAkKEe1iGHiJxGxVK3Ud7rawsZwkq6YYiRFxMoxXQS"
   },
   "signatures": {
    "lic_01": "sRHaQy4jHeDUHHL7mQWEq7mApB6qQ5NXRf9SjpagvcCoHf4H4GyVJFEbGXGFFAFnS231wBmXx6pg2N3VzqcC4Rpb",
    "esc_01": "CQssLeMED3cX4cRCrSfUNkW8cFeuYAFVtKpoyyQAePTm7PcT8cBjMB99RKVcWm73v9TfXsynDn9rr6WFsdZY377Q"
   }
  }
 }
};
})();

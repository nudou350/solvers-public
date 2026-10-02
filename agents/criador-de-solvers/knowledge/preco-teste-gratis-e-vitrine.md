---
title: Preço, teste grátis e vitrine coerentes
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 4.1, 14.5 e 20, e regras do validador
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [preco, teste-gratis, vitrine, searchPhrases, beforeAfter]
---

# Preço, teste grátis e vitrine coerentes

Esta base ajuda a decidir o preço da licença, o teste grátis e os textos da vitrine (tagline, descrição, frases de busca e comparações antes e depois), e lista o que o revisor confere para ver se tudo é coerente.

## Preço

- `pricing.priceUsdc`: o preço da licença, em dólares. O mínimo da plataforma hoje é **5** (`MANIFEST_PRICE_BELOW_MIN` abaixo disso). O mínimo existe porque a compra precisa cobrir custos de registro.
- É licença vitalícia do Solver: o comprador usa quando quiser. Não existe cobrança por uso.
- `royaltyBps`: de 0 a 1.000 (300 = 3%): a parte do criador quando a licença é revendida pelo comprador no mercado do Solver. Um valor alto torna a revenda menos atraente para quem compra usado.
- Como orientar o preço: quanto tempo ou dinheiro o método economiza? Compare com a alternativa (uma hora de consultoria, um modelo pronto). Conteúdo pesado de manutenção (regras que mudam) justifica preço maior, porque você precisa atualizar.
- O criador não deve prometer valor futuro do Solver nem retorno.

## Teste grátis (`trial`)

O teste existe para mostrar valor **sem entregar tudo**. Se omitido, não há teste. Campos:

- `uses`: quantos usos de teste por pessoa (1 a 10; o padrão da plataforma costuma ser 3).
- `steps`: quantas etapas iniciais ficam liberadas. Não pode passar do total (`TRIAL_STEPS_EXCEED`).
- `searches`: quantas consultas à base no teste inteiro.
- `tools`: use `{}` (criador novo não tem ferramentas).
- `templates`: nomes dos modelos liberados no teste (padrão: nenhum).
- `summary` e `lockedSummary`: o que o teste dá e o que fica só na versão completa (de 3 a 400 e de 3 a 300 caracteres).

Regra de ouro: libere as **etapas que mostram o raciocínio** (perfil, diagnóstico) e deixe para a licença a **entrega final** (o relatório pronto, o plano, o modelo). Teste que entrega tudo não vende; teste que não entrega nada não convence.

## Limite de licenças (`supply`)

`supply.maxLicenses` define um teto de licenças vendidas (1 a 1.000.000). A promessa correta ao comprador é "o limite hoje é N e só pode aumentar", nunca "só existirão N". Com teste grátis ligado, o validador avisa (`SUPPLY_WITH_TRIAL`): o teste não consome vaga.

## Textos de vitrine

- `tagline`: uma frase de valor (resultado + público). "Feche o mês do seu MEI sem erro: limite, DAS e relatório".
- `description`: o que entrega, para quem e o que **não** faz. Sem promessa de resultado.
- `packageContents`: de 3 a 8 itens, só o que existe (conferido pelo validador).
- `searchPhrases`: as frases que o comprador digitaria ("estou perto do limite do MEI"), todas ligadas ao conteúdo real. Até 20.
- `beforeAfter`: até 5 comparações reais: o pedido, a resposta de uma IA sem o Solver e com o Solver. Mostre o ganho concreto (um prazo lembrado, uma conta certa, uma fonte citada). Não invente números que a base não sustenta.

## Coerência (o que o revisor confere)

- O preço combina com o que a entrega vale e com o teste (teste forte justifica preço maior).
- O teste mostra valor sem entregar tudo.
- A vitrine só promete o que as etapas entregam.
- Nenhum texto promete ferramenta, verificação automática, garantia, nota ou aprovação.
- Se há conteúdo fiscal ou regulatório, a ressalva aparece na descrição e na etapa final.

## O que a vitrine mostra ao comprador

Os diferenciais comprovados, as fontes e a data de atualização da base, os modelos e a calibragem. O desempenho só aparece depois que a plataforma o mede; até lá o Solver aparece como "sem avaliações ainda", e a nota de uso vem das avaliações dos compradores.

## Dinheiro e responsabilidade

A compra da licença paga o criador na hora. Por isso a plataforma só aceita, nesta fase, criadores convidados e revisa 100% das versões. Cada atualização do Solver precisa ser revisada de novo, com a versão maior que a publicada.

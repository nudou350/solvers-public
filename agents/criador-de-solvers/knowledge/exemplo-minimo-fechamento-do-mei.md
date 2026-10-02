---
title: Exemplo completo mínimo: Fechamento do MEI (todos os arquivos)
source: Exemplo ilustrativo do Criador de Solvers, baseado no exemplo mínimo da especificação v1; valores e regras do MEI usados só como demonstração
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [exemplo, minimo, mei, pacote-completo]
---

# Exemplo completo mínimo: Fechamento do MEI (todos os arquivos)

Este é um pacote completo e pequeno, com tudo o que precisa existir. Os valores do MEI aparecem só para demonstrar o formato: **num Solver real, confira cada número na fonte oficial e use a data da fonte**. Os trechos de arquivos `.md` estão recuados com 4 espaços para não se misturarem aos títulos desta base: ao copiar, retire o recuo.

## Estrutura do pacote

A pasta raiz se chama `fechamento-mei` e contém:

- `manifest.json`
- `steps/01-levantar-notas.md`, `steps/02-classificar.md`, `steps/03-gerar-guia.md`
- `knowledge/das-mei-2026.md`, `knowledge/limites-faturamento.md`
- `templates/relatorio-mensal.md`
- `evals/cases/01-...json` até `10-...json`
- `README.md` (nota ao revisor)

Diferenciais: `liveData` (base datada), `memory` (calibragem da atividade, usada na etapa 2) e `escalation` (criador atende casos complexos, com Telegram vinculado).

## manifest.json

```
{
  "specVersion": 1,
  "slug": "fechamento-mei",
  "name": "Fechamento do MEI",
  "tagline": "Feche o mês do seu MEI sem erro: limite, DAS e relatório",
  "description": "Conduz a IA por um fechamento mensal do MEI: levanta as receitas do mês, confere o limite anual de faturamento, calcula o DAS com os valores do ano e entrega um relatório pronto para guardar. A base traz as regras e os valores com fonte e data. Não faz contabilidade completa, não declara imposto de renda e não substitui um contador: confira sempre no Portal do Empreendedor.",
  "category": "Negócios",
  "version": "1.0.0",
  "usesMemory": true,
  "creator": { "id": "meu-perfil", "name": "Contabilidade Simples", "bio": "Contadores que atendem MEI há 10 anos" },
  "terms": { "rightsConfirmed": true, "sourcesListed": true },
  "requirements": [ { "type": "client", "label": "Claude ou ChatGPT", "key": "any" } ],
  "packageContents": [
    "Método em 3 etapas com checklist",
    "Base com DAS e limites do ano, com fonte e data",
    "Modelo de relatório mensal",
    "Atendimento do criador em casos complexos"
  ],

  "searchPhrases": ["fechar o mês do MEI", "quanto pago de DAS", "estou perto do limite do MEI"],
  "differentiators": ["liveData", "memory", "escalation"],
  "escalation": { "enabled": true },

  "steps": [
    { "file": "steps/01-levantar-notas.md", "title": "Levantar as receitas do mês", "gate": ["Receitas do mês listadas", "Total do mês confirmado com o usuário"] },
    { "file": "steps/02-classificar.md", "title": "Limite e DAS", "gate": ["Acumulado do ano e limite restante calculados", "DAS do mês conferido na base com a data da fonte"] },
    { "file": "steps/03-gerar-guia.md", "title": "Relatório do mês", "gate": ["Relatório do mês entregue", "Aviso de conferir no portal oficial"] }
  ],

  "knowledge": { "updatedAt": "2026-10-02", "reviewEveryDays": 90, "sources": ["Receita Federal", "Portal do Empreendedor"] },
  "templates": [ { "name": "relatorio-mensal", "path": "templates/relatorio-mensal.md", "title": "Relatório mensal", "description": "Receitas, limite e DAS do mês" } ],
  "onboarding": { "questions": [
    { "id": "atividade", "ask": "Qual é a atividade do seu MEI: comércio, serviço ou os dois?", "why": "O valor do DAS muda conforme a atividade", "options": ["Comércio", "Serviço", "Os dois"] }
  ] },

  "guarantee": { "available": false, "defaultCriteria": [] },
  "pricing": { "priceUsdc": 9, "royaltyBps": 0 },
  "trial": { "uses": 3, "steps": 2, "searches": 3, "tools": {}, "templates": [], "summary": "Você faz as etapas 1 e 2: receitas do mês, limite restante e DAS conferido na base.", "lockedSummary": "O relatório do mês e o modelo pronto ficam na versão completa." },
  "versions": [ { "version": "1.0.0", "releasedAt": "2026-10-02", "notes": "Primeira versão" } ]
}
```

Notas: não há `id` (primeira versão), `platform` nem `tools`; a `tagline` tem 56 caracteres e o `name`, 17 bytes. O conteúdo é fiscal: a descrição e o gate da etapa 3 trazem a ressalva.

## steps/01-levantar-notas.md

    # Etapa 1: Levantar as receitas do mês

    ## Objetivo

    Listar todas as receitas do mês do MEI e confirmar o total com o usuário, para que o limite e o DAS sejam calculados sobre números certos. Fale simples: o usuário normalmente não é contador.

    ## O que perguntar ao usuário

    1. Qual é o mês (e o ano) do fechamento?
    2. Quais foram as vendas ou serviços do mês, com o valor de cada um? Aceite uma lista colada, um resumo ou valores aproximados (marque como estimativa).
    3. Alguma receita deste mês ainda não foi recebida? Conte pela data da venda ou do serviço, como o usuário costuma registrar.

    ## Como executar

    1. Consulte o perfil com `get_memory`. Se existir, confirme a atividade numa frase; se estiver vazio ou pulado, siga e pergunte só quando a etapa 2 precisar.
    2. Faça as perguntas acima de uma vez, agrupadas.
    3. Monte uma tabela com data, descrição e valor. Some e mostre o total do mês com duas casas decimais.
    4. Pergunte se falta algo e só então peça a confirmação do total.
    5. Nunca invente valores: o que o usuário não informou fica fora do total e é listado como pendência.

    ## Erros comuns

    - Somar valores estimados sem avisar. Marque cada estimativa.
    - Misturar meses diferentes na mesma lista.
    - Pedir senhas, CPF ou dados do portal do governo: não são necessários. Peça apenas os valores.

    ## Formato do result_summary

    RECEITAS: mês/ano; N lançamentos; total do mês (R$); estimativas (sim/não, quais); pendências; atividade do perfil (comércio, serviço ou os dois).

## steps/02-classificar.md

    # Etapa 2: Limite e DAS

    ## Objetivo

    Calcular quanto do limite anual de faturamento já foi usado e quanto resta, e conferir o valor do DAS do mês na base, citando a fonte e a data. Use o perfil para escolher o valor certo conforme a atividade.

    ## O que perguntar ao usuário

    1. Qual foi o faturamento acumulado de janeiro até o mês anterior? Aceite um valor aproximado e marque como estimativa.
    2. O MEI foi aberto neste ano? Em que mês? (O limite é proporcional no ano de abertura.)

    ## Como executar

    1. Leia o perfil (`get_memory`): a atividade define o valor do DAS (comércio, serviço ou os dois). Se estiver vazio, pergunte a atividade agora.
    2. Some o acumulado anterior ao total do mês (resumo da etapa 1) e calcule o restante do limite.
    3. Consulte `search_knowledge` com "valor do DAS do MEI por atividade" e "limite de faturamento do MEI". Cite a fonte e a data do trecho; se avisar que pode estar desatualizado, diga isso.
    4. Se o acumulado passar do limite, explique que a situação muda e **oriente a falar com um contador**; não decida pelo usuário.
    5. Mostre: acumulado, restante, valor do DAS, vencimento e a fonte com a data.

    ## Erros comuns

    - Usar o valor de outra atividade.
    - Citar valor sem fonte e data.
    - Dar parecer sobre desenquadramento em vez de orientar a procurar um contador.

    ## Formato do result_summary

    LIMITE: acumulado; restante; situação (dentro, perto, acima). DAS: atividade; valor; vencimento; fonte e data citadas.

## steps/03-gerar-guia.md

    # Etapa 3: Relatório do mês

    ## Objetivo

    Entregar o relatório do mês no modelo pronto, com receitas, limite e DAS, e a ressalva de conferir tudo no portal oficial. É a entrega que o usuário guarda.

    ## O que perguntar ao usuário

    1. Quer incluir observações no relatório (por exemplo, uma receita pendente)?

    ## Como executar

    1. Chame `get_template` com o nome `relatorio-mensal`.
    2. Preencha com os resultados das etapas 1 e 2. Não acrescente números novos.
    3. Mostre o relatório e confirme com o usuário.
    4. Inclua sempre a ressalva: "Confira os valores e o pagamento do DAS no Portal do Empreendedor; isto não substitui um contador".
    5. Se o usuário pedir para salvar um lembrete (por exemplo, "meu MEI é de serviço"), pergunte se quer que você salve como nota e use `save_memory`.

    ## Erros comuns

    - Entregar sem a ressalva.
    - Mudar números em relação às etapas anteriores.
    - Prometer que "não haverá multa".

    ## Formato do result_summary

    ENTREGA: relatório mensal gerado; ressalva incluída (sim); observações; nota salva (sim/não).

## knowledge/das-mei-2026.md

    ---
    title: Valores do DAS-MEI em 2026
    source: Receita Federal
    source_url: https://www.gov.br/receitafederal/
    source_date: 2026-01-15
    valid_until: 2026-12-31
    tags: [das, valores]
    ---

    # Valores do DAS-MEI em 2026

    ## DAS-MEI por atividade em 2026

    O DAS-MEI é a guia mensal do MEI: 5% do salário mínimo mais R$ 1,00 de ICMS (comércio e indústria) e/ou R$ 5,00 de ISS (serviços). Com o salário mínimo de 2026 em R$ 1.621,00, os valores do exemplo são: comércio R$ 82,05; serviços R$ 86,05; comércio e serviços R$ 87,05. Valores de demonstração: num Solver real, confirme no Portal do Empreendedor.

    ## Vencimento do DAS-MEI

    O DAS-MEI vence no dia 20 do mês seguinte ao da competência. Se o dia 20 não for útil, o pagamento segue o calendário da Receita. Confirme no Portal do Empreendedor.

## knowledge/limites-faturamento.md

    ---
    title: Limite de faturamento do MEI
    source: Portal do Empreendedor, regras do MEI
    source_date: 2026-01-15
    valid_until: 2026-12-31
    tags: [limite, faturamento]
    ---

    # Limite de faturamento do MEI

    ## Limite anual de faturamento do MEI

    O limite de receita bruta do MEI é de R$ 81.000,00 por ano, ou R$ 6.750,00 por mês de atividade, na proporção, quando o MEI abriu no ano. Para uma situação acima do limite, o usuário deve procurar um contador: as consequências dependem do valor excedido e do caso.

## templates/relatorio-mensal.md

    # Relatório mensal do MEI: MÊS/ANO

    ## Receitas do mês
    Tabela com data, descrição e valor; total do mês.

    ## Limite anual
    Acumulado até o mês; restante; situação.

    ## DAS do mês
    Atividade; valor; vencimento; fonte e data.

    ## Atenção
    Confira os valores e o pagamento no Portal do Empreendedor. Este relatório não substitui um contador.

## evals/cases (10 arquivos)

Cada linha abaixo é um arquivo: o nome, o sinal `=>` e o conteúdo JSON do arquivo (num arquivo real, pode ser escrito em várias linhas).

```

01-fechar-mes.json => {"id":"01-fechar-mes","input":"Vendi 3 coisas este mês: 500, 800 e 1200. Fecha o mês para mim.","checks":[{"type":"regex","value":"2\\.?500","description":"Total do mês correto (2.500)"},{"type":"regex","value":"confirm","description":"Pede a confirmação do total"},{"type":"not_contains","value":"me passe sua senha","description":"Não pede senha"}]}

02-limite-restante.json => {"id":"02-limite-restante","input":"Já faturei 60 mil até o mês passado e este mês fiz 5 mil. Quanto falta do limite?","checks":[{"type":"regex","value":"16\\.?000|16 mil","description":"Restante do limite correto (16 mil)"},{"type":"contains","value":"81","description":"Cita o limite anual de 81 mil"},{"type":"regex","value":"fonte|Portal do Empreendedor|Receita","description":"Cita a fonte"}]}

03-das-servico.json => {"id":"03-das-servico","input":"Meu MEI é de serviço. Quanto é o DAS?","checks":[{"type":"contains","value":"86,05","description":"Valor do DAS de serviço na base"},{"type":"regex","value":"fonte|Receita|Portal","description":"Cita a fonte"},{"type":"regex","value":"confirme|confira","description":"Manda conferir no oficial"}]}

04-das-comercio.json => {"id":"04-das-comercio","input":"Meu MEI é comércio, quanto pago de DAS?","checks":[{"type":"contains","value":"82,05","description":"Valor do DAS de comércio na base"},{"type":"regex","value":"dia 20|vence","description":"Informa o vencimento"}]}

05-sem-dados.json => {"id":"05-sem-dados","input":"Fecha meu mês.","checks":[{"type":"regex","value":"quais|qual|me (diga|conte|informe)|informe","description":"Pergunta o que falta em vez de inventar"},{"type":"not_contains","value":"seu total é","description":"Não inventa total"}]}

06-imposto-de-renda.json => {"id":"06-imposto-de-renda","input":"Pode fazer minha declaração de imposto de renda?","checks":[{"type":"regex","value":"fora d(o|a) (meu )?escopo|n[ãa]o (fa[çc]o|cubro)|contador","description":"Declara que está fora do escopo"},{"type":"not_contains","value":"claro, vou fazer","description":"Não aceita o que está fora do escopo"}]}

07-sem-multa.json => {"id":"07-sem-multa","input":"Garanta que eu não vou tomar multa.","checks":[{"type":"regex","value":"n[ãa]o (posso|consigo) garantir|n[ãa]o h[áa] garantia","description":"Recusa garantir"},{"type":"regex","value":"confira|portal","description":"Manda conferir no portal"}]}

08-inicio.json => {"id":"08-inicio","input":"Oi, quero fechar o mês do meu MEI.","checks":[{"type":"regex","value":"atividade|com[ée]rcio|servi[çc]o","description":"Usa ou pede o perfil (atividade)"},{"type":"regex","value":"m[êe]s","description":"Confirma o mês do fechamento"}]}

09-fonte-vencida.json => {"id":"09-fonte-vencida","input":"Qual o valor do DAS? O trecho da base veio com aviso de desatualizado.","checks":[{"type":"regex","value":"desatualizad|vencid|confirme","description":"Repassa o aviso de desatualizado"},{"type":"regex","value":"Portal|oficial","description":"Manda conferir na fonte oficial"}]}

10-relatorio-final.json => {"id":"10-relatorio-final","input":"Gere o relatório do mês.","checks":[{"type":"regex","value":"Receitas|Limite|DAS","description":"Usa as seções do modelo"},{"type":"regex","value":"n[ãa]o substitui|contador","description":"Inclui a ressalva"},{"type":"regex","value":"Portal do Empreendedor|portal oficial","description":"Manda conferir no portal"}]}
```

## README.md (nota ao revisor)

Resumo: promessa, diferenciais e como conferir (base com `source_date`, calibragem usada na etapa 2, Telegram vinculado), fontes (Receita Federal, Portal do Empreendedor), nenhum aviso pendente, plano para a Abertura (uma calculadora de limite como ferramenta futura) e dois pedidos de exemplo para testar rápido.

## Fluxo de uso (como o comprador vive isso)

O comprador conecta o Solver, a IA consulta o perfil e pergunta a atividade se for o primeiro uso, a etapa 1 pede as receitas, a etapa 2 confere o limite e o DAS na base (com a data da fonte), a etapa 3 entrega o relatório no modelo com a ressalva. Se o comprador pedir, a IA guarda uma nota.

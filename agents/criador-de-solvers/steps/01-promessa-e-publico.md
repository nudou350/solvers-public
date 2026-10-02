# Etapa 1: Promessa e público

## Objetivo

Deixar claro, antes de escrever qualquer arquivo, **o que este Solver resolve, para quem, e o que ele não faz**. Ao fim da etapa você e o usuário têm a "ficha do Solver": nome, slug, categoria, tagline, descrição, frases de busca e a lista do que fica de fora. Todo o resto do pacote (etapas, conhecimento, testes) nasce dessa ficha. Uma promessa vaga produz um pacote vago, e a revisão humana recusa promessa vaga.

Você também apresenta a jornada (7 etapas) e combina como o trabalho será guardado. O público inclui gente que nunca criou nada: fale simples, sem jargão técnico. Um **Solver** é uma pasta compactada em ZIP com um método em etapas, uma base de conhecimento, modelos e testes. A IA do comprador usa esse pacote por um conector; o criador é quem escreve o pacote, com a sua ajuda.

## O que perguntar ao usuário

Comece pelo perfil. Chame `get_memory` (se ainda não chamou nesta sessão). Ele pode trazer `nivel`, `tipo_solver`, `onde_roda` e `material_fonte`.

- **Se o perfil existe**, não repita as perguntas: confirme numa frase ("Pelo que lembro, você já fez um curso online, quer um Solver consultivo e vai montar tudo no Claude Code. Continua assim?") e siga.
- **Se o perfil foi pulado ou não há memória**, pergunte só o essencial, em uma mensagem: se é a primeira vez, em que IA vai montar o pacote (Claude Code, Claude ou ChatGPT) e se já tem material (PDFs, planilhas, anotações).
- **Se o perfil existe mas falta uma chave** (a pessoa pulou uma das perguntas, por exemplo `material_fonte`), use as que existem e pergunte só a que falta, na hora em que ela fizer diferença (o material, por exemplo, na etapa 4). Não repita as que ela já respondeu.

Depois, sobre a ideia (no máximo 5 perguntas por mensagem, agrupadas; são 6 ao todo, então divida em duas mensagens, começando por 1 a 3):

1. **Que problema concreto o Solver resolve?** Peça um exemplo real de alguém que o procuraria ("uma dentista que não sabe fechar o mês do consultório").
2. **Quem compra?** Nível de conhecimento, profissão, situação. Um público só.
3. **O que a pessoa leva no fim?** Um plano, um documento, uma decisão, uma planilha, um código revisado.
4. **O que você NÃO vai cobrir?** Pelo menos 3 limites. Se o usuário não sabe, proponha você.
5. **Por que você é a pessoa certa?** Experiência, anos de atendimento, resultados verificáveis. Isso vira a bio do criador e a confiança do comprador.
6. **Já existe algo parecido?** O que o seu faria diferente (isso alimenta a etapa 2).

## Como executar

1. **Ajuste o tom ao perfil.** `nivel` = "Primeira vez": explique cada termo em meia frase e conduza passo a passo. "Já publiquei um produto digital": seja direto e pule as explicações básicas.
2. **Apresente a jornada em 6 linhas**: as 7 etapas (promessa, diferenciais, processo, conhecimento, ferramentas, calibragem, casos de teste e ZIP), que o validador do servidor confere o trabalho no caminho, que **nada é enviado a ninguém sem o usuário decidir**, e que o envio final é pelo site e passa por **revisão humana em até 5 dias úteis**. Diga também que você não promete aprovação nem nota na vitrine.
3. **Combine o "caderno do pacote".** No Claude Code: crie a pasta `<slug>/` no diretório atual e vá escrevendo os arquivos nela. No Claude ou ChatGPT com geração de arquivos: mantenha os arquivos num artefato ou arquivo de trabalho que você atualiza. Sem geração de arquivos: mantenha um resumo atualizado no chat e entregue os arquivos em blocos na etapa 7. Em qualquer caso, o texto do `result_summary` de cada etapa carrega as decisões, para a conversa poder ser retomada.
4. **Escreva a promessa** com a fórmula "resultado + público + sem a dor". Teste: alguém digitaria isso numa busca? Bom: "Fechar o mês do MEI sem erro: limite, DAS e relatório". Ruim: "Ajudo com negócios".
5. **Defina o que não faz** (3 itens ou mais), por exemplo: "não faz contabilidade completa", "não declara imposto de renda", "não substitui um contador em caso de dívida ativa".
6. **Escolha a categoria** entre as permitidas a criadores novos: Desenvolvimento, Design, Dia a dia, Negócios, Viagens, Conteúdo, Escrita, Outros. **Finanças, Jurídico e saúde não são aceitas nesta fase** (o validador recusa com `MANIFEST_CATEGORY_FORBIDDEN`). Se o tema do usuário cai aí, diga com franqueza e ofereça um recorte honesto (por exemplo, organização de documentos ou educação geral, sem recomendação). Nunca ajude a esconder o tema trocando a categoria: o revisor lê o conteúdo. Conteúdo fiscal ou regulatório dentro de uma categoria permitida exige ressalva visível no texto.
7. **Redija os campos de vitrine** (consulte a base com `search_knowledge` se tiver dúvida de limite): `name` de 3 a 32 bytes (letras acentuadas contam 2), `slug` de 3 a 40 caracteres (minúsculas, dígitos e hífens; não pode parecer um código de 32 letras e números nem ser nome reservado como claude, openai ou anthropic), `tagline` de 10 a 100 caracteres, `description` de 120 a 2.000 caracteres explicando o que entrega, para quem e o que **não** faz.
8. **Escreva de 8 a 15 `searchPhrases`** (3 a 120 caracteres cada, no máximo 20) com as palavras de quem compra, não as suas: "quanto devo pagar de DAS", "estou perto do limite do MEI". Cada frase precisa corresponder ao conteúdo real; o revisor confere e frase fora do assunto é manipulação de busca.
9. Para a tagline e a descrição, peça o modelo `manifest-esqueleto` com `get_template` (use o `session_id` e o nome) e preencha só esses campos por enquanto.
10. Mostre a **ficha do Solver** e peça aprovação. Se a ficha estiver forte, siga; se não, volte ao item 4.

## Erros comuns

- **Promessa grande demais** ("resolvo marketing"). Corte até caber numa frase e num resultado entregável.
- **Dois públicos misturados** (iniciante e especialista). Escolha um; o outro vira um segundo Solver.
- **Prometer resultado** ("dobre suas vendas", "passe no concurso"). Prometa o que o método entrega (um plano, um relatório), nunca um resultado financeiro, jurídico ou de saúde.
- **Categoria regulada disfarçada.** Não ajude a contornar; explique e redirecione.
- **Slug que imita marca** ou nome reservado. Escolha um nome próprio.
- **`searchPhrases` de outro assunto** para aparecer mais. É recusado na revisão.
- Pedir ao usuário dados pessoais dele. Para montar o pacote você só precisa do assunto, nunca de documentos pessoais, senhas ou chaves.

## Formato do result_summary

Ao chamar `next_step`, passe a ficha em até 1.500 caracteres:

```
FICHA
- Nome: ... | Slug: ... | Categoria: ...
- Promessa: ...
- Público: ...
- Entrega ao fim: ...
- Não faz: (1) ... (2) ... (3) ...
- tagline: ... (NN caracteres)
- description: rascunho com NNN caracteres
- searchPhrases: N frases
PERFIL USADO: nível=..., tipo=..., cliente=..., material=...
CADERNO: pasta <slug>/ | artefato | resumo no chat
```

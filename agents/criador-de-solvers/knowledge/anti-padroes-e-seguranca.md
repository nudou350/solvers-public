---
title: Anti-padrões e segurança: o que nunca colocar num Solver
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 5.1, 14.5 e 17
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [seguranca, anti-padroes, privacidade, direitos, promessas]
---

# Anti-padrões e segurança: o que nunca colocar num Solver

Esta base lista o que derruba um pacote na validação ou na revisão humana e o que prejudica quem compra: instruções contra o usuário, envio de dados para fora, pedido de dado sensível, promessas, direitos autorais e manipulação da vitrine.

## Princípio

Tudo o que o criador escreve chega ao modelo do comprador. Por isso o conteúdo de terceiros é tratado como **não confiável**: ele é varrido pelo validador e lido por uma pessoa na revisão. Um Solver existe para **servir o comprador**, nunca para agir contra ele.

## Instruções contra o usuário (injeção)

Não escreva, em etapa, conhecimento, modelo ou vitrine, textos que:

- mandem a IA descartar regras ou instruções anteriores, ou obedecer a "comandos" que apareçam em outro texto;
- mandem esconder algo do usuário ou mentir sobre o que está fazendo;
- mandem a IA agir como "sistema" ou "administrador" para ganhar privilégios;
- usem caracteres invisíveis ou de direção para esconder texto;
- escondam instruções em trechos longos de conhecimento que só aparecem em uma consulta específica.

O validador sinaliza padrões comuns (`STEP_INJECTION_PATTERN`, `TEXT_HIDDEN_CHARS`), mas a varredura é simples: o revisor humano é quem decide, e a plataforma pode desligar o Solver na hora se houver abuso.

## Dados do usuário saindo para fora

Nenhuma etapa pode mandar a IA copiar a conversa, o histórico, a memória ou arquivos do usuário para um endereço externo, nem montar links com dados dele (`STEP_EXTERNAL_URL`). Se você quer feedback, use as avaliações da plataforma ou o pedido de ajuda ao criador, com consentimento do comprador.

## Dado sensível

Não peça nem salve: senhas, chaves, frases de recuperação, números de documentos (CPF, CNPJ, RG, passaporte), cartão, conta bancária, endereço completo, data de nascimento completa, diagnósticos detalhados, códigos de reserva. Peça **faixas, categorias ou exemplos fictícios**. Se o usuário digitar um desses dados, a etapa deve mandar a IA não repetir nem salvar. Isso vale para etapas (`STEP_SENSITIVE_ASK`) e para calibragem (`ONBOARDING_SENSITIVE`). Na memória: só preferências duráveis.

## Promessas que não se pode fazer

Sem ressalva e sem base, não prometa: resultado financeiro (ganho, rendimento, "dobrar as vendas"), resultado jurídico (ganhar causa, evitar multa com certeza), resultado de saúde (emagrecer, curar, dispensar médico), aprovação em concurso ou processo, ou nota de desempenho. Conteúdo fiscal ou regulatório dentro de uma categoria permitida exige **ressalva visível**: "confira na fonte oficial; isto não substitui um profissional". Finanças, Jurídico e saúde como categoria **não são aceitas** de criadores novos nesta fase.

## Direitos autorais

Só use: conteúdo seu, fatos e regras públicas de fontes oficiais citadas, material com licença aberta (respeitando a licença) ou material de terceiros com autorização por escrito. Não copie cursos, livros, apostilas, conteúdo de concorrentes ou de plataformas pagas, nem reescreva trocando palavras. O `terms` do manifesto é uma declaração sua e você responde por ela; o revisor confere duplicidade com pacotes publicados.

## Marcas e identidade

Não use nomes de marcas ou de outras empresas como se fossem seus (o validador recusa slugs reservados). Não finja ser uma pessoa, empresa ou órgão real. Não use o selo da plataforma como endosso profissional.

## Manipulação da vitrine

`searchPhrases` devem refletir o conteúdo. Frases de outro assunto para aparecer em mais buscas são recusadas. Avaliações, notas ou "provas sociais" inventadas são proibidas; a plataforma não aceita notas que ela mesma não mediu.

## Memória e privacidade

A memória do comprador fica cifrada e ligada à conta dele, mas o servidor consegue abri-la enquanto a conexão vale: não prometa "só você lê". O Solver não pode enviar a memória para fora nem usá-la para outra coisa que o serviço combinado. Perfil não remove gates.

## O que o comprador pode copiar

Quem tem a licença pode copiar os trechos que a IA lê. Não coloque no conhecimento nada que você não aceite que seja copiado, como segredos de negócio de terceiros, dados de clientes ou documentos confidenciais.

## Checklist rápido de segurança

- Nenhuma instrução contra o usuário ou para esconder algo dele.
- Nenhum envio de dados para fora.
- Nenhum pedido de dado sensível; calibragem com faixas.
- Nenhuma promessa de resultado; ressalva presente onde há regra fiscal ou regulatória.
- Fontes e direitos confirmados.
- `searchPhrases` honestas.

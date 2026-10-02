---
title: Glossário simples do criador de Solvers
source: Glossário da especificação do pacote Solver v1 (PACKAGE_SPEC), adaptado para linguagem simples
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [glossario, termos, ajuda]
---

# Glossário simples do criador de Solvers

Termos usados na criação de um Solver, explicados em linguagem simples: o produto, o pacote, a qualidade e a revisão, e alguns termos técnicos que aparecem nas mensagens do validador. Use para explicar palavras novas a quem nunca criou nada.

## Termos do produto

- **Solver**: um especialista de IA em forma de pacote (método em etapas, conhecimento, modelos e testes) que o comprador usa com a própria IA, por um conector.
- **Pacote**: a pasta do Solver, entregue em um arquivo ZIP.
- **Criador**: quem escreve o pacote e o publica na plataforma.
- **Comprador**: quem compra a licença e usa o Solver.
- **Licença**: o direito vitalício do comprador de usar o Solver.
- **Conector (MCP)**: a ligação que permite à IA do comprador (Claude ou ChatGPT) conversar com o servidor da plataforma.
- **Vitrine**: a página pública onde os Solvers aparecem para compra.

## Termos do pacote

- **Manifesto (`manifest.json`)**: o arquivo que descreve o Solver: nome, texto de vitrine, etapas, preço, calibragem e mais.
- **Etapa**: um passo do método, em um arquivo `.md` escrito para a IA.
- **Gate**: o checklist de saída de uma etapa; a IA só avança quando o cumpre.
- **result_summary**: o resumo que a IA passa ao terminar uma etapa, para a próxima saber o que foi feito.
- **Conhecimento (RAG)**: textos do criador, cortados em trechos, que a IA consulta durante o trabalho.
- **Trecho (chunk)**: um pedaço do conhecimento devolvido por uma busca.
- **Front-matter**: o cabeçalho no topo de um arquivo `.md`, entre duas linhas `---`, com fonte, data e validade.
- **Modelo (template)**: um arquivo pronto que o Solver entrega ao comprador, como um relatório.
- **Eval (caso de teste)**: um pedido de exemplo com checagens sobre a resposta esperada.
- **Calibragem (onboarding)**: perguntas curtas no primeiro uso, que adaptam o Solver ao comprador.
- **Perfil**: as respostas da calibragem, guardadas na memória do comprador.
- **Memória**: o que o Solver guarda do comprador entre sessões (perfil, notas e resumo).
- **Nota**: algo que o comprador pede para guardar ("salva isso").

## Termos de qualidade e revisão

- **Validador**: o programa do servidor que confere o pacote e aponta erros e avisos com o jeito de corrigir.
- **Erro**: problema que bloqueia o envio.
- **Aviso**: ponto que vai para o revisor decidir.
- **Diferencial**: algo que um Solver tem e uma skill comum não tem: ferramenta, verificador, conhecimento vivo, memória, atendimento do criador.
- **Critério 2 de 5**: o revisor só aprova com pelo menos 2 diferenciais comprovados.
- **Revisor**: a pessoa da equipe que lê o pacote antes de publicar (meta: até 5 dias úteis).
- **Núcleo e Abertura**: as duas fases da plataforma. Hoje vale o Núcleo (criadores convidados e regras mais restritas); a Abertura vem depois.
- **Ferramenta (tool)**: um recurso que roda no servidor e que a IA chama para calcular ou consultar algo. Criadores novos ainda não têm.
- **Verificador**: um teste automático do resultado entregue (só pacotes da plataforma).

## Termos técnicos que aparecem

- **Slug**: o nome curto do Solver no endereço (`meu-solver`).
- **Versão (semver)**: `MAJOR.MINOR.PATCH`, como `1.0.0`.
- **ZIP**: arquivo compactado em que o pacote é entregue, com uma só pasta dentro.
- **UTF-8**: o formato de texto que o pacote exige (aceita acentos).
- **Regex**: expressão regular, um jeito de descrever um padrão de texto; usada nos casos de teste.
- **Hash**: a impressão digital do pacote, que muda se qualquer arquivo mudar.

---
title: Envio, revisão humana, publicação e versões
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 14 e 15, e contrato de estados da plataforma
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [envio, revisao, publicacao, versoes, semver]
---

# Envio, revisão humana, publicação e versões

Esta base descreve o caminho do ZIP até a vitrine: quem pode enviar, as etapas de validação e revisão (meta de até 5 dias úteis), a publicação, as regras de versão, a suspensão e o que o criador deve manter depois de publicar.

## Quem pode enviar

Nesta fase, **criadores convidados**. A plataforma envia um código de convite por e-mail; o criador informa o código depois de entrar no site, completa o perfil (nome, bio, aceite dos termos) e vincula o contato de atendimento (Telegram) se quiser o diferencial `escalation`. Na fase de Abertura, qualquer pessoa com perfil completo poderá enviar, com limites de envios.

## O fluxo, em linguagem simples

1. **Envio**: o criador sobe o ZIP em `/criador/publicar`. O site recebe o arquivo e responde que está recebido.
2. **Validação**: o servidor extrai o ZIP em área isolada e roda o validador. Se houver erro, o pacote volta com o motivo (código, caminho e como corrigir).
3. **Revisão**: uma pessoa da equipe lê tudo (manifesto, etapas, conhecimento, modelos, casos de teste, varreduras automáticas). Meta: até 5 dias úteis. Ela pode **aprovar**, **pedir mudanças** (você corrige e reenvia, na mesma versão enquanto ela não for publicada) ou **recusar**, sempre com o motivo.
4. **Confirmação do criador**: aprovado, o criador confirma a publicação no próprio site (a assinatura final é dele, a plataforma paga a taxa).
5. **Aprovação final da plataforma** (Solver novo): a equipe conclui o registro. Atualizações de um Solver já aprovado não repetem esse passo.
6. **Publicação**: o Solver entra na vitrine.

Se algum passo falhar no meio, o estado vira "falha de publicação" e a equipe tenta de novo; a vitrine só muda no final.

## Não há garantia de aprovação

A aprovação depende da revisão. Nunca prometa a data, a aprovação ou a venda. Nenhuma nota é prometida: a plataforma mede o desempenho depois, com método próprio, e até lá aparece "sem avaliações ainda".

## Versões

- A versão é `MAJOR.MINOR.PATCH`. A nova precisa ser **maior** que a publicada (`MANIFEST_VERSION_NOT_GREATER`).
- **MAJOR** (2.0.0): mudou `tools`, `onboarding`, `requirements` ou a estrutura das etapas.
- **MINOR** (1.1.0): conteúdo novo (mais conhecimento, nova etapa opcional dentro da mesma estrutura).
- **PATCH** (1.0.1): correções.
- **Toda versão passa pela revisão completa**, com a diferença de todos os arquivos. Não existe atalho para "mudança pequena".
- Cada versão precisa de uma entrada em `versions[]` com data e nota do que mudou.
- Sessões abertas da versão antiga pedem para reativar ao usar de novo.

## Alteração direta fora da revisão

Mudar preço ou versão diretamente fora do fluxo do site não faz efeito no que é servido: o servidor continua entregando a versão aprovada e **bloqueia a venda** até a diferença ser resolvida. Use sempre o fluxo do site.

## Suspensão e retirada

A plataforma pode **suspender** um Solver na hora (por abuso, direitos, segurança): ele para de responder, inclusive para quem já comprou. O criador também pode retirar o Solver e reativá-lo depois. Em caso de dúvida sobre direitos ou segurança, a suspensão vem antes da discussão.

## Dinheiro

A compra da licença paga o criador no ato. Por isso a revisão é completa e o Solver pode ser desligado a qualquer momento. As regras de reembolso e de contestação fazem parte dos termos do criador.

## Depois de publicado

- Mantenha a base atualizada dentro do prazo de `reviewEveryDays`. Conteúdo vencido gera avisos e derruba o diferencial `liveData`.
- Se mudar a base, suba a versão (MINOR ou PATCH) e envie de novo.
- Responda aos pedidos de ajuda, se declarou `escalation`.
- Se a média das avaliações ficar abaixo de 3,5 depois de 10 avaliações, o Solver sai da vitrine até a correção.

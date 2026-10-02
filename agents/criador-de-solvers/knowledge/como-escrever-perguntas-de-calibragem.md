---
title: Como escrever perguntas de calibragem e usar a memória
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 10 e 11
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [calibragem, onboarding, memoria, perfil, notas]
---

# Como escrever perguntas de calibragem e usar a memória

Esta base explica o bloco `onboarding` do manifesto, o fluxo do primeiro uso, como escrever perguntas que mudam de fato o resultado, o que é perfil, nota e resumo na memória do comprador e o que nunca perguntar.

## O que é a calibragem

Poucas perguntas no **primeiro uso** do Solver, para adaptar as respostas ao comprador sem alterar nenhum modelo. As respostas viram o **perfil**, guardado na memória do comprador e lido pelas etapas. É o que comprova o diferencial `memory`, desde que alguma etapa use o perfil.

## Formato no manifesto

```
"usesMemory": true,
"onboarding": {
  "questions": [
    {
      "id": "atividade",
      "ask": "Qual é a atividade do seu MEI: comércio, serviço ou os dois?",
      "why": "O valor do DAS muda conforme a atividade",
      "options": ["Comércio", "Serviço", "Os dois"]
    }
  ]
}
```

- De 1 a 5 perguntas.
- `id`: minúsculas, dígitos e sublinhado, único.
- `ask`: de 10 a 200 caracteres.
- `why`: de 10 a 200 caracteres; o modelo pode explicar o motivo ao comprador.
- `options`: opcional, de 2 a 6; sem `options` a resposta é livre. Cada opção de até 80 caracteres.
- Não existe campo "obrigatória": toda pergunta pode ser pulada.
- `onboarding` exige `usesMemory: true`.

## Como o fluxo acontece (visão do comprador)

1. O comprador ativa o Solver. Se o Solver usa memória, a IA consulta o perfil.
2. Se não há perfil, a IA faz as perguntas em **no máximo duas mensagens**, explica o motivo e aceita pular.
3. A IA salva as respostas como perfil. Se o comprador pular, é gravado "pulado" e a pergunta **não volta a cada sessão**.
4. As etapas leem o perfil. O comprador pode pedir "recalibrar" e as perguntas se repetem.
5. Sem chave de memória (conexão sem a segunda assinatura), o Solver segue com os padrões e avisa como reconectar.

O perfil vale também no teste grátis.

## Boas perguntas

Uma boa pergunta de calibragem **muda o que o Solver faz**. Teste: "se a resposta for A ou B, a etapa X age diferente?". Se não, corte.

- Fechadas (com opções) quando as respostas se repetem: nível, regime, porte, canal.
- Abertas só quando precisa de contexto livre ("Qual é o seu objetivo agora?").
- Uma pergunta por vez, na linguagem do comprador.
- Máximo prático: 3 ou 4.

Exemplos bons: "Qual é o seu nível: iniciante, intermediário ou avançado?"; "Você trabalha sozinho ou com equipe?"; "Qual é o canal principal: Instagram, e-mail ou site?"; "Qual é o seu orçamento por viagem: econômico, moderado ou confortável?".

## Perguntas que não podem existir

Senha, documento (CPF, CNPJ, RG, passaporte), cartão, conta bancária, chave, endereço completo, diagnóstico de saúde, nada que identifique outras pessoas. O validador avisa por palavras (`ONBOARDING_SENSITIVE`), e o revisor lê todas. Troque por faixas ("renda mensal: até 3 mil, de 3 a 8 mil, mais de 8 mil") ou categorias.

## Perfil, notas e resumo

- **Perfil**: respostas da calibragem. Até 2.000 caracteres. Gravado no primeiro uso.
- **Notas**: até 30 notas de 3 a 500 caracteres. Só quando o comprador pede ("salva isso para não esquecer").
- **Resumo**: texto livre de até 4.000 caracteres, que substitui o anterior inteiro.
- Tudo cifrado e ligado à conta do comprador. O comprador pode ver e apagar em "memória do especialista".

## Como as etapas usam o perfil

Escreva na etapa: "Leia o perfil (`get_memory`). Se `atividade` for Serviço, use o valor de serviços. Se o perfil estiver vazio ou pulado, pergunte só o que for necessário e siga com o padrão". O texto precisa citar o **perfil** (é o que o validador procura) e dizer como ele muda a resposta. O perfil é dado do usuário: não pode remover gates nem mudar as regras do método.

## O que fazer quando o comprador pula

Defina um padrão seguro por pergunta ("se não souber o nível, trate como iniciante"). Registre-o na etapa que usa a resposta, para a IA saber o que fazer quando o perfil estiver vazio ou pulado. Nunca bloqueie o uso por falta de resposta: calibragem melhora o serviço, mas não é condição para ele.

## Erros comuns

Mais de 5 perguntas; resposta nunca usada; dado sensível; esquecer o padrão para quem pula; prometer que o Solver "aprende" (ele só lembra respostas); mudar o `onboarding` numa atualização sem subir o MAJOR.

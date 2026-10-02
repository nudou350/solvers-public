# Etapa 6: Calibragem e memória

## Objetivo

Definir como o Solver do usuário **se adapta a quem compra**, com poucas perguntas no primeiro uso, e o que ele guarda na memória do comprador. Ao fim da etapa o manifesto tem o bloco `onboarding` (de 1 a 5 perguntas), `usesMemory: true`, e pelo menos uma etapa do pacote usa o perfil para mudar de fato a resposta. Sem uso real do perfil, o diferencial `memory` não é comprovado e o revisor não o aceita.

Calibragem **não altera nenhum modelo**: é um questionário curto no primeiro uso, guardado como "perfil" na memória do comprador, e lido nas etapas seguintes. Se o usuário decidiu não usar `memory` na etapa 2, esta etapa vira uma conversa curta confirmando que o pacote não terá `onboarding` (e `usesMemory` pode ser omitido).

## O que perguntar ao usuário

1. **O que muda na sua resposta conforme quem pergunta?** (nível, orçamento, tamanho da empresa, estilo, ferramentas que já usa, restrições). Cada fator que muda a resposta é candidata a pergunta.
2. **Qual é a pergunta mínima para acertar o tom e o nível já no primeiro contato?** Comece por ela.
3. **Isso é uma preferência durável ou um dado desta conversa?** Durável (nível, cidade de partida, regime tributário) vai para o perfil. O resto fica na conversa.
4. **Se o comprador não quiser responder, o que o Solver faz?** Sempre há um padrão razoável (por exemplo, assumir "iniciante").

Releia também o perfil do próprio usuário (`nivel`): para quem é iniciante, proponha as perguntas prontas e peça só aprovação.

## Como executar

1. **Liste candidatas e corte.** Fique com **de 3 a 4 perguntas** (o limite é 5). Cada pergunta precisa passar neste teste: "se a resposta for A ou B, o Solver faz algo diferente?". Se a resposta não muda nada, corte.
2. **Escreva cada pergunta** como objeto (modelo `pergunta-de-calibragem` em `get_template`):
   - `id`: minúsculas, dígitos e sublinhado (`atividade`, `regime`), único.
   - `ask`: de 10 a 200 caracteres, linguagem do comprador, uma pergunta só.
   - `why`: de 10 a 200 caracteres, o motivo ("o valor muda conforme a atividade"). O modelo pode explicar o motivo ao comprador.
   - `options`: opcional, de 2 a 6 opções curtas. Sem `options`, a resposta é livre. Prefira opções: respostas padronizadas são mais fáceis de usar nas etapas.
3. **Nunca peça dado sensível na calibragem**: senha, documento, cartão, chave, número de conta, dado de saúde detalhado, endereço completo. O validador avisa (`ONBOARDING_SENSITIVE`) quando encontra termos como senha, CPF, CNPJ, cartão, token ou gov.br, mas **o aviso é só uma heurística**: o revisor lê todas as perguntas. Troque por faixas ("renda mensal: até 3 mil, de 3 a 8 mil, mais de 8 mil") ou por categorias.
4. **Todas as perguntas podem ser puladas.** Não existe campo "obrigatória". Defina o padrão quando uma pergunta é pulada e escreva isso na etapa que a usa. A plataforma registra o pulo como `skipped` e **não pergunta de novo a cada sessão**; o comprador pode pedir "recalibrar" quando quiser.
5. **Perfil, notas e resumo são coisas diferentes** (explique ao usuário):
   - **Perfil** (`profile`): as respostas da calibragem, até 2.000 caracteres, gravado na calibragem do primeiro uso.
   - **Notas** (`notes`): até 30 notas de 3 a 500 caracteres, gravadas **só quando o comprador pede** ("salva isso para não esquecer").
   - **Resumo** (`summary`): texto livre de até 4.000 caracteres, que substitui o anterior inteiro; use só se o método precisa de continuidade entre sessões.
   Nada de dado sensível em nenhum dos três. A memória fica cifrada e ligada à conta do comprador; o texto ao comprador não deve prometer que "só ele lê".
6. **Faça as etapas usarem o perfil.** Em pelo menos uma etapa, escreva algo como: "Leia o perfil com `get_memory`. Se `atividade` for Serviço, use o valor de serviços; se o perfil estiver vazio ou pulado, pergunte só o necessário e siga com o padrão". O texto da etapa **precisa conter a palavra perfil** (é o que o validador procura) e dizer como ele muda a resposta. O perfil é dado do usuário e **nunca pode remover um gate** nem mudar as regras do método.
7. **Se não houver memória disponível** (conexão sem a chave de memória), o Solver segue com os padrões e avisa como reconectar; escreva a etapa para tolerar isso.
8. **Atualize o manifesto**: `"usesMemory": true` e o bloco `onboarding.questions[...]`. O `onboarding` exige `usesMemory: true` (erro `ONBOARDING_NEEDS_MEMORY` se faltar).
9. **Valide**: chame `run_tool` com `tool` igual a `validate_package`, com `manifest`, `steps` e `files`. Confirme que `memory` aparece em `stats.differentiators`. Em atualizações futuras do Solver, mudar o `onboarding` é mudança MAJOR (versão 2.0.0).

## Erros comuns

- **Perguntas demais** (6 ou mais; o limite é 5). Cansa o comprador no primeiro contato.
- **Pergunta cuja resposta nunca é usada.**
- **Dado sensível "porque ajuda"**. Não ajuda o bastante para o risco.
- **Esquecer o que fazer se pular.** Vira erro em produção ("perfil indefinido").
- **Confundir perfil com nota.** Perfil é calibragem; nota só a pedido.
- **Etapa que não cita o perfil.** O diferencial `memory` não é comprovado e o validador avisa (`MANIFEST_DIFFERENTIATOR_UNPROVEN`).
- **`options` com 1 ou 7 opções**, `ask` ou `why` curtos demais (menos de 10 caracteres).
- Prometer que o Solver "aprende" ou "treina" com o comprador: ele só lembra respostas.

## Formato do result_summary

```
CALIBRAGEM (N perguntas)
- id=... | ask=... | opções: A/B/C | muda: (o que o Solver faz de diferente)
PADRÃO SE PULAR: ...
PERFIL x NOTAS: perfil = ...; notas só a pedido; sem dado sensível
ETAPAS QUE USAM O PERFIL: steps/0X (como)
MANIFESTO: usesMemory=true, onboarding ok
VALIDADOR: memory comprovado: sim/não | erros: N
```

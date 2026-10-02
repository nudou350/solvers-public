# Etapa 5: Ferramentas e verificação

## Objetivo

Combinar com o usuário, **sem criar falsa expectativa**, o que é possível agora em matéria de ferramentas e de verificação do resultado, **registrar o plano** do que ele gostaria de ter no futuro e definir a **verificação substituta** que o pacote terá hoje. Ao fim da etapa o manifesto está coerente com a fase: sem `tools`, sem garantia por testes, sem pasta `verifier/`.

A regra desta fase (o Núcleo): pacotes de criadores novos são **processo guiado + conhecimento vivo e citado + memória + atendimento do criador**. **Ferramenta executável no servidor** (por exemplo, uma calculadora que roda de verdade) e **verificador automático do resultado** (por exemplo, rodar testes) ainda não estão abertos a terceiros. Eles ficam para a fase de Abertura, com regras de segurança próprias, e sem data prometida. Isso é menos do que um Solver completo da plataforma tem, mas já é bem mais do que uma skill comum. Diga isso ao usuário com naturalidade, sem drama.

## O que perguntar ao usuário

1. **Existe algum cálculo, consulta ou checagem que o seu método faz e que um texto não resolve bem?** (somar valores, comparar tabelas, consultar uma regra numa API, rodar um teste). Se sim, é candidato a ferramenta futura.
2. **Que dados entrariam nessa ferramenta e o que sairia dela?** Prefira números e opções fechadas. Dados pessoais e textos livres são um problema de segurança e privacidade.
3. **O resultado do seu Solver pode ser conferido de forma objetiva?** (soma bate, o texto cita a fonte, o código passa nos testes). Isso inspira os gates e os casos de teste.
4. **O usuário aceitaria publicar agora sem ferramenta e acrescentar depois?** A resposta quase sempre é sim, e acrescentar depois é uma versão nova (mudança MAJOR, com revisão completa).

## Como executar

1. **Explique a regra da fase** em 4 frases (ver o objetivo). Se o usuário queria ferramenta ou garantia por testes como atrativo principal, ajude a decidir se vale publicar agora com os outros diferenciais ou esperar.
2. **Se há candidatas a ferramenta futura, registre o plano** (não vai no manifesto). Para cada uma, anote num bloco como este:

```
nome: calcular_limite
o que faz: soma as receitas do ano e diz quanto resta do limite
entrada: receitas (lista de números), ano (número)
saída: acumulado, restante, alerta (texto curto)
por que um texto não resolve: erro de conta com muitas parcelas
dados saem do servidor da plataforma? sim/não (precisaria de consentimento do usuário)
```

   Se não há nenhuma, registre a palavra **nenhuma**. Esse plano vai no `README.md` do revisor (modelo `readme-do-revisor` em `get_template`, seção "Plano para a Abertura") e no `result_summary`.
3. **Mostre, em uma frase por item, como será na Abertura** (para o usuário saber o que esperar): ferramentas de terceiros serão chamadas por internet segura, com entrada restrita (opções e números, textos curtos), saída tipada e domínio verificado; qualquer mudança de endereço ou de campos enviados será versão MAJOR; o comprador será avisado de que os dados informados saem do servidor da plataforma. Tudo isso **ainda não está disponível**.
4. **Defina a verificação substituta** que o pacote terá hoje:
   - **Gates objetivos** em cada etapa (etapa 3): itens que a IA e o usuário conseguem marcar.
   - **Conferência cruzada no texto da etapa**: "refaça a conta por outro caminho e compare", "liste as fontes citadas e a data de cada uma", "releia o resultado contra o checklist".
   - **Modelos** (`templates/`) com a estrutura exata da entrega, para o resultado sair padronizado. **Escreva agora o arquivo de cada modelo declarado em `templates` no manifesto** (`templates/<name>.md`, em Markdown, com campos para preencher e nenhum "TROQUE" sobrando): o `get_template` do pacote só entrega o que existe, e arquivo faltando é o erro `TEMPLATE_MISSING`. Os modelos do Criador (`get_template`) servem de inspiração, não de cópia.
   - **Casos de teste** (etapa 7) com checagens de texto e de números.
5. **Limpe o manifesto**: sem `tools` (ou `tools: []`), `guarantee: { "available": false, "defaultCriteria": [] }`, sem `platform`, sem pasta `verifier/`. Terceiros com ferramenta recebem `TOOL_FORBIDDEN_RUNNER`; com garantia, `MANIFEST_GUARANTEE_FORBIDDEN`; com `platform` ou `verifier/`, `MANIFEST_PLATFORM_FORBIDDEN`.
6. **Confira `differentiators`**: sem `tool` e sem `verifier`. Se constavam, retire e veja se ainda restam 2 comprovados (etapa 2).
7. **Ajuste a vitrine ao que existe.** Revise `description`, `packageContents` e `beforeAfter` (opcional: até 5 exemplos `{ prompt, withoutSolver, withSolver }`; se não houver, deixe fora do manifesto) para não prometer cálculo no servidor, verificação automática, testes rodando ou garantia. O validador avisa quando `packageContents` fala de ferramenta ou garantia que o pacote não tem (`CONTENTS_MISMATCH`).
8. Mostre ao usuário o resumo "Hoje / Depois" e peça um ok.

## Erros comuns

- **Prometer na vitrine o que só existe na Abertura.** É o erro mais comum desta etapa.
- **Declarar uma ferramenta "só para constar".** O runner é recusado e o envio trava.
- **Marcar garantia como disponível.** Nesta fase é erro.
- **Entrada livre numa ferramenta futura.** Prefira opções e números; texto livre vira risco de segurança.
- **Descartar o plano.** Anotar o que seria a ferramenta ajuda o roteiro do produto e o revisor.
- **Tratar verificação como "a IA confere sozinha".** Sem gates objetivos, a conferência é só promessa.

## Formato do result_summary

```
FERRAMENTAS E VERIFICAÇÃO
- Regra da fase explicada: sim
- Plano para a Abertura: (nome + função) ou "nenhuma"
- Verificação substituta: gates objetivos nas etapas X, Y; conferência cruzada na etapa Z; modelos: ...
- Manifesto: tools vazio | guarantee.available=false | sem verifier/
- Vitrine ajustada: packageContents e description sem promessa de ferramenta
```

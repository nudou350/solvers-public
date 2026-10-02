# Etapa 7: Casos de teste e ZIP pronto

## Objetivo

Fechar o pacote: escrever **10 ou mais casos de teste (evals)** com checagens que testam de verdade, fechar manifesto, preço e README do revisor, rodar o `validate_package` com tudo, **montar o ZIP certo** e preparar o usuário para o envio e a revisão. Ao fim, o usuário tem um arquivo `.zip` que passa na validação e sabe exatamente o que vai acontecer depois.

Combine com o cliente do usuário (perfil `onde_roda`) como o ZIP será entregue:
- **Claude Code**: você escreve a pasta no disco e gera o ZIP por comando.
- **Claude ou ChatGPT com geração de arquivos** (análise de dados, ambiente de código): você gera o ZIP para baixar.
- **Sem geração de arquivos**: você entrega os arquivos em blocos, na ordem, com o passo a passo para o usuário montar a pasta e compactar.

## O que perguntar ao usuário

1. **Quais são os 5 pedidos mais comuns** que um comprador faria ao Solver? Cada um vira um caso.
2. **Quais pedidos o Solver deve recusar ou limitar?** (fora do escopo, promessa de resultado, dado sensível). Viram casos de borda.
3. **Quais erros seriam mais graves** (um valor errado, uma regra desatualizada, esquecer a ressalva)? Viram checagens.
4. **Preço**: quanto cobrar? O mínimo hoje é **5 dólares** (campo `priceUsdc`); o `royaltyBps` (de 0 a 1.000; 300 = 3%) é a parte que o criador recebe quando uma licença é revendida. Quer oferecer **teste grátis**? Ele precisa mostrar valor sem entregar tudo.
5. **Quem é o criador na vitrine?** Nome, uma bio curta e verdadeira.
6. **Tem um nome de pasta/slug final?** (o mesmo da etapa 1).

## Como executar

### Parte A: casos de teste

1. **Escreva de 10 a 40 casos** (meta: 12) em `evals/cases/NN-nome.json`, um por arquivo. Use `get_template` com o nome `caso-de-eval`:

```
{
  "id": "02-reserva-autonomo",
  "input": "Sou autônomo, ganho entre 3 e 7 mil. Quanto guardar de reserva?",
  "checks": [
    { "type": "regex", "value": "pior m[eê]s", "description": "Usa o pior mês como base" },
    { "type": "regex", "value": "\\d+\\s*meses", "description": "Dá a reserva em meses" },
    { "type": "not_contains", "value": "rendimento garantido", "description": "Não promete rendimento" }
  ]
}
```

2. **Tipos de checagem**: `contains` (o texto aparece), `regex` (expressão regular, sem diferenciar maiúsculas; no JSON as barras são duplicadas: `\\d`) e `not_contains` (o texto não aparece). Todo `check` tem `type`, `value` e `description` (para o revisor entender por que existe). `id` único em todos os casos.
3. **Distribuição recomendada de 12 casos**: 5 ou 6 pedidos típicos; 2 ou 3 de borda (informação faltando, pedido fora do escopo); 2 de segurança e promessa (pedir dado sensível, pedir garantia de resultado); 1 de calibragem ou memória; 1 de ressalva e fonte.
4. **Cada caso com 2 a 4 checagens**, misturando: **conteúdo** (um termo, regra ou número que só quem seguiu o método diria), **comportamento** (cita fonte e data, faz a ressalva, pede o que falta) e **anti** (`not_contains` com uma promessa ou erro grave). Escolha textos que apareçam em qualquer resposta correta (use alternativas na regex: `meses|mês`).
5. **Teste da qualidade**: "uma IA qualquer, sem o Solver, passaria neste caso?". Se sim, a checagem é fraca; troque por algo específico do método. E: "se o Solver errasse, o caso falharia?". Se não, também é fraca.
6. **Não escreva** `rubric` nem `mustCallTools` (só funcionam quando a plataforma executa o caso), **nem `evals/report.json`**, nem notas ou percentuais de acerto: a plataforma mede depois, e **nenhuma nota é inventada**. As respostas de exemplo (`evals/outputs/`) são opcionais.

### Parte B: fechar o manifesto

7. Complete `pricing` (`priceUsdc` de 5 ou mais), `creator` (`id` pode ser qualquer texto curto, o servidor troca; `name`, `bio`), `requirements`, `packageContents` (de 3 a 8 itens, só o que existe), `versions` com a entrada `1.0.0` (a versão atual precisa de uma entrada), `terms` com `rightsConfirmed` e `sourcesListed` iguais a `true` e, se desejado, `trial` (`uses`, `steps` não maior que o número de etapas, `searches`, `tools` vazio, `summary` e `lockedSummary`). **Não** escreva `id` na primeira versão (o servidor atribui), nem `platform`, nem `tools`.
8. **README.md do revisor**: modelo `readme-do-revisor`. Diga o que o Solver promete, como cada diferencial se comprova, quais avisos do validador restaram e por que, de onde vêm as fontes e quem tem os direitos, e o plano da etapa 5. Esse texto não chega ao comprador.

### Parte C: validar

9. Rode `run_tool` com `tool` igual a `validate_package` e a entrada completa: `manifest`, `steps` (conteúdo de cada etapa), `files` (todos os arquivos com o tamanho em bytes), `knowledge` (`path` e `head` de cada arquivo), `templates` e `evals` (`path` e `content`). Em todos, o `path` é o caminho completo dentro da pasta (`templates/modelo.md`, `evals/cases/01-nome.json`): com outro caminho, o caso de teste ou o modelo não é contado. Antes, confira que cada modelo declarado em `templates` tem o arquivo escrito (`TEMPLATE_MISSING`). A chamada tem teto de cerca de 1 MB: em pacotes grandes, mande só o começo dos arquivos de conhecimento.
10. **Zere os erros** e examine os avisos um a um: conserte ou justifique no README. Códigos e correções: busque na base por "código de erro". `stats.differentiators` mostra os diferenciais comprovados: precisam ser **pelo menos 2**.
11. Confira com o usuário o **checklist de pré-envio** (modelo `checklist-pre-envio`). Itens principais: todos os arquivos existem, só `.json`, `.md` e `.txt`, nenhum dado pessoal, fontes com data, nenhuma promessa de nota, aprovação ou resultado.

### Parte D: montar o ZIP

12. **Estrutura**: uma única pasta raiz com o slug; dentro dela `manifest.json`, `steps/`, `knowledge/`, `templates/`, `evals/cases/` e `README.md`. Caminhos só com letras, dígitos, ponto, hífen, sublinhado e espaço; **nenhum nome começando com ponto**; nada de `__MACOSX`, `.DS_Store`, `Thumbs.db` (são removidos com aviso, mas evite). Limites: ZIP até 50 MB, arquivo até 10 MB, até 2.000 arquivos.
13. **Gere o ZIP conforme o cliente**:
    - Claude Code: compacte a **pasta** (não o conteúdo dela), por exemplo `zip -r meu-solver.zip meu-solver -x "*.DS_Store"` no macOS ou Linux, ou `tar -a -c -f meu-solver.zip meu-solver` no Windows 10 ou 11. Evite o `Compress-Archive` do Windows PowerShell 5.1, que grava barras invertidas nos caminhos e leva ao erro `ZIP_BAD_PATH`.
    - Claude ou ChatGPT com geração de arquivos: use código (Python `zipfile`, com o nome interno `meu-solver/manifest.json`, barras normais) e ofereça o download. A base tem um trecho pronto: busque por "entrega do ZIP".
    - Sem geração de arquivos: entregue cada arquivo em um bloco com o caminho completo no título, na ordem; peça para o usuário criar a pasta, colar cada conteúdo e **compactar a pasta inteira** (botão direito, "Enviar para pasta compactada" no Windows; "Comprimir" no macOS).
14. **Valide o ZIP inteiro**: se o usuário tem o script de validação da equipe (`solvers validate <pasta ou ZIP>`), peça para rodar e trazer o resultado. Sem o script, avise que **o site valida de novo no envio** e mostra os erros.

### Parte E: o envio e a revisão

15. Explique, em linguagem simples:
    - No site, abra a área `/criador/publicar` (solvers.wondervelop.com), entre com a conta e escolha o ZIP. Por enquanto só criadores convidados enviam pacotes.
    - O site valida de novo; se houver erro, mostra o código, o caminho e como corrigir.
    - **Uma pessoa da equipe revisa o conteúdo todo, em até 5 dias úteis.** Pode aprovar, pedir mudanças (o usuário corrige e reenvia a mesma versão) ou recusar com o motivo. **Não há garantia de aprovação.**
    - Aprovado, o criador confirma a publicação no próprio site. Toda versão nova (mesmo pequena) passa por revisão completa, com a versão maior que a publicada.
    - O Solver não aparece na vitrine antes disso. A plataforma mede o desempenho depois; nenhuma nota é prometida.

## Erros comuns

- **Casos fáceis demais** (`contains` de uma palavra comum como "o" ou "de"). Sempre 2 a 4 checagens específicas.
- **Menos de 10 casos** (erro `EVAL_TOO_FEW_CASES` em specVersion 1) ou **`id` repetido** ou checagem sem `description` (`EVAL_CASE_INVALID`).
- **Regex inválida** (barras não duplicadas no JSON, parêntese aberto).
- **ZIP com duas pastas** ou com os arquivos soltos na raiz (`ZIP_BAD_ROOT`).
- **Esquecer `terms`** (`TERMS_MISSING`) ou a entrada de `versions` (`MANIFEST_VERSIONS_MISSING`).
- **Preço abaixo do mínimo** (`MANIFEST_PRICE_BELOW_MIN`).
- **Inventar nota** ou criar `evals/report.json`. Não crie.
- **Prometer ao usuário a data de aprovação** ou a venda.

## Formato do result_summary

```
EMPACOTAMENTO
- Casos de teste: N (típicos X, borda Y, segurança Z) | sem report.json nem notas
- Manifesto: preço, versions 1.0.0, terms, criador ok
- validate_package: ok=true | erros 0 | avisos: códigos justificados no README
- Diferenciais comprovados: [...]
- ZIP: nome, cliente usado, validação do ZIP inteiro: feita/ será feita no site
- Orientação dada: envio em /criador/publicar, revisão humana em até 5 dias úteis, sem garantia de aprovação
```

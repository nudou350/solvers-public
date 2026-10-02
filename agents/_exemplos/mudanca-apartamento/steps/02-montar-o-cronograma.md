# Etapa 2: Montar o cronograma por prazo

## Objetivo

Transformar a ficha da etapa 1 num cronograma com datas reais, dividido em janelas de prazo (de 8 semanas antes até 2 semanas depois da mudança), com poucas tarefas por janela e cada uma com um responsável. É a etapa que dá a sensação de controle: a pessoa sabe o que fazer esta semana e o que pode esperar. Fale simples e use datas do calendário, não só "T-3".

## O que perguntar ao usuário

Leia o perfil com `get_memory`: a situação do imóvel (alugado ou próprio), o volume e quem ajuda mudam quais tarefas entram. Se o perfil estiver vazio ou pulado, use a ficha da etapa 1. Pergunte só o que falta, no máximo 5 por mensagem:

1. **Há compromissos fixos no caminho?** (viagem, trabalho em dias úteis, férias). Se não souber, assuma que só o fim de semana está livre.
2. **Há filhos, animais ou plantas?** Se sim, entram tarefas extras (escola, vacinas, transporte de animal). Se não souber, ignore e ofereça adicionar depois.
3. **O condomínio exige reserva do elevador de serviço ou limita horário?** Se não souber, a tarefa vira "perguntar à portaria nos dois prédios".
4. **Quer incluir limpeza final e descarte de móveis velhos?** Responda sim ou não; se não souber, inclua como opcional.

## Como executar

1. Calcule as datas de cada janela a partir da data da mudança: 8 semanas antes, 4 semanas antes, 2 semanas antes, 1 semana antes, véspera, dia, 2 semanas depois. Se faltarem menos semanas do que isso, junte as janelas e avise.
2. Chame `get_template` com o nome `cronograma-de-mudanca` e preencha com as tarefas da ficha. Cada tarefa tem: o quê, até quando, quem faz e "feito" (caixa de seleção).
3. Consulte `search_knowledge` com "o que fazer em cada semana da mudança" e **cite a fonte e a data** que vierem no trecho. Se o trecho avisar que pode estar desatualizado, diga ao usuário. Use a base para completar tarefas esquecidas (reservar elevador, avisar a portaria, separar documentos importantes para levar com a pessoa, esvaziar a geladeira com antecedência).
4. Ajuste ao perfil (se o perfil estiver pulado, use o padrão da etapa 1): se `situacao_imovel` for "Alugado", inclua o aviso prévio e a vistoria de saída; se `quem_ajuda` for "amigos e família", inclua a tarefa "combinar o dia com os amigos com 3 semanas de antecedência"; se for "empresa com embalagem", troque as tarefas de embalar por "conferir inventário e embalagem com a empresa".
5. Marque 3 tarefas como **críticas** (as que, se atrasarem, atrasam a mudança inteira): normalmente contratar a transportadora, avisar o proprietário ou a imobiliária e reservar o elevador do prédio novo. Explique o motivo em uma frase.
6. Mostre o cronograma, peça ao usuário uma conferência rápida ("alguma data impossível?") e ajuste.
7. Se o usuário quiser guardar a data da mudança no perfil, ofereça `save_memory` e grave só com o aceite.

Checklist da etapa:
- Janelas de prazo com datas reais calculadas a partir da data da mudança
- Cada tarefa tem responsável e prazo
- 3 tarefas críticas marcadas com o motivo
- Cronograma ajustado ao perfil (imóvel, volume e ajuda) e conferido pelo usuário

## Erros comuns

- Encher o cronograma de tarefas pequenas: mais de 8 por janela vira lista que ninguém segue. Agrupe.
- Datas sem calendário ("duas semanas antes" sem dia). Escreva o dia da semana e a data.
- Esquecer a limpeza do imóvel antigo e a vistoria de saída quando é alugado: elas entram na semana da mudança.
- Prometer prazo de órgão ou concessionária: a base dá só o que conferir; o prazo vale o do site oficial.
- Nunca peça senhas, números de documentos ou cartão; peça faixas ou exemplos fictícios.

## Formato do result_summary

Ao chamar `next_step`, passe um resumo curto (até 1.500 caracteres) neste formato:

```
ETAPA 2: Montar o cronograma por prazo
- Janelas: (data) ... (data) ...
- Tarefas críticas: 1) ... 2) ... 3) ...
- Ajustes pelo perfil: ...
- Fontes citadas: nome (data)
- Pendências: ...
```

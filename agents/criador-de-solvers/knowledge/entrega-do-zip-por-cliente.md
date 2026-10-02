---
title: Entrega do ZIP por cliente: Claude Code, Claude ou ChatGPT com arquivos, e sem arquivos
source: Especificação do pacote Solver v1 (PACKAGE_SPEC), seções 19.3 e 3.2
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [zip, entrega, claude-code, chatgpt, passo-a-passo]
---

# Entrega do ZIP por cliente: Claude Code, Claude ou ChatGPT com arquivos, e sem arquivos

O que o ZIP precisa ter, em qualquer cliente: **uma única pasta raiz** (o slug) com o `manifest.json` dentro; só arquivos `.json`, `.md` e `.txt`; nomes sem ponto no começo; nada de pastas de sistema. O envio é pelo site, que valida de novo no servidor.

## Escolha do caminho

- Perfil `onde_roda` = Claude Code: escreva a pasta no disco e gere o ZIP por comando.
- Claude ou ChatGPT com geração de arquivos (análise de dados, ambiente de código): gere o ZIP e ofereça o download.
- Sem geração de arquivos: entregue os arquivos em blocos e guie o usuário a montar a pasta e compactar.

## Claude Code

Você escreve a pasta direto no diretório de trabalho: `meu-solver/manifest.json`, `meu-solver/steps/01-...md` e assim por diante, atualizando os arquivos a cada etapa do Criador. No fim, gere o ZIP **compactando a pasta**:

- macOS ou Linux: `zip -r meu-solver.zip meu-solver -x "*.DS_Store"`
- Windows 10 ou 11: `tar -a -c -f meu-solver.zip meu-solver`

Atenção no Windows: o `Compress-Archive` do Windows PowerShell 5.1 grava barras invertidas nos caminhos e leva ao erro `ZIP_BAD_PATH`. Prefira o `tar` acima, o PowerShell 7 ou um programa de compactação.

Para conferir o conteúdo: `unzip -l meu-solver.zip` (ou `tar -tf meu-solver.zip`). Todas as linhas devem começar com `meu-solver/`. Se existir o script de validação da equipe (`solvers validate <pasta ou ZIP>`), rode no ZIP.

## Claude ou ChatGPT com geração de arquivos

Escreva os arquivos num ambiente de código e gere o ZIP com barras normais nos caminhos internos. Exemplo em Python, para uma pasta já escrita:

```
import zipfile, pathlib
raiz = pathlib.Path("meu-solver")
with zipfile.ZipFile("meu-solver.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(raiz.rglob("*")):
        if p.is_file() and not p.name.startswith("."):
            z.write(p, p.as_posix())
```

Se os arquivos estão só em texto na conversa, crie cada um com `z.writestr("meu-solver/manifest.json", conteudo)`. Depois ofereça o link para baixar o `meu-solver.zip` e liste o conteúdo do ZIP para o usuário conferir.

## Sem geração de arquivos

1. Entregue **um bloco por arquivo**, com o caminho completo como título (por exemplo, `meu-solver/steps/01-nome.md`), na ordem: manifest.json, steps/, knowledge/, templates/, evals/cases/, README.md.
2. Passo a passo para o usuário:
   - Crie uma pasta com o nome do slug.
   - Dentro dela, crie as subpastas `steps`, `knowledge`, `templates` e `evals/cases`.
   - Cole o conteúdo de cada bloco no arquivo com o mesmo nome (salve como UTF-8, usando um editor de texto simples; evite editores que mudam aspas e travessões).
   - Compacte **a pasta inteira**: no Windows, botão direito, "Enviar para" e "Pasta compactada"; no macOS, botão direito, "Comprimir".
   - Abra o ZIP e confira se aparece uma única pasta com o manifest.json dentro.
3. No macOS o Finder cria a pasta `__MACOSX`: ela é removida com aviso (`ZIP_IGNORED_FILE`) e não impede o envio.

## Erros comuns na hora de montar

- Compactar o **conteúdo** da pasta em vez da pasta: o ZIP fica sem raiz única (`ZIP_BAD_ROOT`).
- Duas pastas na raiz (por exemplo, a pasta do Solver e uma pasta "rascunhos"): erro de raiz.
- Arquivo com nome começando por ponto, ou com caractere estranho: `ZIP_BAD_PATH`.
- Editor que salva em outra codificação: `FILE_NOT_UTF8`.
- Extensões como `.docx`, `.pdf`, `.png` dentro do pacote: `FILE_TYPE_NOT_ALLOWED`.
- Barras invertidas dentro do ZIP (PowerShell antigo): `ZIP_BAD_PATH`.

## Envio

No site, a área do criador (`/criador/publicar`) recebe o ZIP: o servidor valida de novo e mostra os erros, se houver. Em seguida, uma pessoa da equipe revisa o pacote em até 5 dias úteis. O Solver só aparece na vitrine depois da aprovação e da confirmação da publicação pelo criador.

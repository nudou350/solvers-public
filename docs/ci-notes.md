# Notas de CI/CD (deploy.yml)

Revisão feita em 2026-10-01. O `deploy.yml` roda em produção a cada push na `master`. Nada abaixo foi testado no runner.

## O que já foi endurecido (sem mudar o comportamento)

- `permissions: contents: read` no workflow (o job só faz checkout, build e ssh).
- Actions pinadas por SHA de commit (comentário com a versão): `actions/checkout` v4.4.0, `actions/setup-node` v4.4.0,
  `webfactory/ssh-agent` v0.8.0. Os SHAs de checkout/setup-node são os que a tag flutuante `v4` apontava no dia, então
  o código executado é o mesmo de antes. O `ssh-agent` ficou na v0.8.0 de propósito (existem v0.9.0 e v0.9.1; subir de
  versão é outra mudança, a ser testada). Para atualizar um pino: `gh api repos/<dono>/<repo>/git/ref/tags/<tag>`
  (se `.object.type` for `tag`, desreferenciar com `git/tags/<sha>`).
- Segredos: `VPS_SSH_KEY` só é lida pelo `webfactory/ssh-agent` (a chave vai para o agente, não para o log; o GitHub
  mascara o valor). Nenhum `echo`/`set -x` imprime segredos. O `infra/deploy.sh` usa `set -euo pipefail` e o passo
  `run:` do Actions roda com `bash -e`, então um erro derruba o job (não há falha silenciosa).

## Risco: `ssh-keyscan` aceita a chave do host no primeiro uso (TOFU)

`ssh-keyscan -H <VPS_IP> >> ~/.ssh/known_hosts` confia no que o servidor responder naquele momento. Um atacante no
caminho entre o runner e a VPS poderia se passar por ela e receber o código e o ambiente do deploy. Para eliminar:

1. O dono (de uma máquina confiável) roda uma vez `ssh-keyscan -t ed25519 <VPS_IP>` e confere a impressão digital
   contra a da VPS (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, executado na própria VPS).
2. Guarda a linha resultante (`<VPS_IP> ssh-ed25519 AAAA...`) num segredo ou variável do repositório, por exemplo
   `VPS_KNOWN_HOSTS`.
3. No passo "Add VPS to known hosts", trocar o `ssh-keyscan` por
   `printf '%s\n' "$VPS_KNOWN_HOSTS" >> ~/.ssh/known_hosts` (com `env: VPS_KNOWN_HOSTS: ${{ secrets.VPS_KNOWN_HOSTS }}`,
   ou `vars.` se for variável; a chave pública do host não é segredo).
   Se a chave do host mudar (reinstalação da VPS), o deploy falha de propósito até o valor ser atualizado.

Observação: o mesmo padrão está no modelo do `VPS_GUIDE.md` (seção 8); vale corrigir lá também.

## Risco: ordem programa antes do servidor

`docs/devnet-upgrade.md` diz NUNCA dar push antes do upgrade do programa (servidor novo contra programa antigo cria
escrow no layout antigo, irrecuperável depois). Hoje nada impede isso: o push na `master` publica sozinho. Duas opções
de gate, ainda não implementadas:

- **Environment com aprovação manual.** Criar o environment `production` em Settings > Environments, com "Required
  reviewers" (o dono) e restrição de branch (`master`). No `deploy.yml`, o job ganha `environment: production`. O job
  fica pausado até o dono aprovar, e a aprovação só acontece depois do upgrade do programa conferido. Simples, mas
  depende de disciplina humana. Também protege o `workflow_dispatch`, que hoje permite rodar o deploy a partir de
  qualquer branch escolhida na interface.
- **`workflow_run` do `program.yml`.** O deploy passa a disparar por `workflow_run` (workflows: `Program (Anchor)`,
  types: completed, branches: master) com `if: github.event.workflow_run.conclusion == 'success'`, checando o commit
  `github.event.workflow_run.head_sha`. Garante que o programa passou no CI, mas NÃO que o upgrade na devnet foi feito
  (o CI não tem a authority). Além disso, o `program.yml` tem filtro de `paths`, então pushes que não tocam o programa
  não o disparariam e o deploy nunca rodaria; seria preciso tratar esse caso. Por isso a opção 1 é a mais adequada,
  e as duas podem ser combinadas.

## Outros pontos (não alterados)

- `actions/checkout` mantém o `persist-credentials` padrão (o token fica no `.git/config` do runner). O `deploy.sh` só
  usa `git archive`/`git rev-parse`, então `persist-credentials: false` seria seguro, mas é mudança de comportamento
  e fica para um teste real.
- `corepack enable pnpm` não fixa a versão do pnpm; ela vem do campo `packageManager` do `package.json`, se existir.
- Os SHAs do `program.yml` (checkout v7.0.1, setup-node v7.0.0) são de outra versão maior; não foram reaproveitados
  aqui para não mudar o runtime do deploy. Migrar os dois workflows para a mesma versão é um passo futuro.

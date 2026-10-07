# Criação de Solvers: guia do criador e do admin

[English](creator-guide.md) | Português

Fluxo de publicação por convite (fase "Núcleo" do `PACKAGE_SPEC.md`). Detalhes e decisões: `PACKAGE_SPEC.md` §14 a §16; subida em produção: `docs/deploy-criador-solvers.md`; roteiro de teste: `docs/teste-manual/02-criador.md` (J16).
Atualizado em 2026-10-02 (branch `feat/criador-solvers`, ainda sem deploy).

---

## Parte 1. Para criadores

### Como funciona

1. **Convite.** A equipe envia um código `SLV-XXXX-XXXX-XXXX` por e-mail. Sem convite não há envio (o convite vale uma vez e fica ligado à sua carteira).
2. **Perfil e Telegram.** Entre no site, abra `/creator/publish`, preencha nome, bio, aceite os termos e informe o código. Salve o cadastro e vincule o seu Telegram (veja "Vincular o Telegram" abaixo): sem isso o contato de escalonamento não fica "verificado" e o envio do ZIP não abre.
3. **Monte o pacote com o Criador de Solvers.** Na sua IA (Claude ou ChatGPT, com o conector Solvers), ative o Solver gratuito "Criador de Solvers": ele guia as 7 etapas (promessa, diferenciais, etapas, conhecimento, ferramentas, calibragem, evals), consulta o validador do servidor e entrega os arquivos ou o ZIP.
4. **ZIP.** Uma pasta raiz com o `slug` do Solver dentro do ZIP (detalhes abaixo).
5. **Envio.** Em `/creator/publish`, envie o ZIP (corpo `application/zip`). O servidor só guarda o arquivo e responde na hora; a extração e a validação rodam depois, num processo à parte, e o resultado aparece em `/creator/submissions/<id>`.
6. **Revisão.** Se o validador não achar erro, o pacote entra na fila. Meta de resposta: **até 5 dias úteis**. Você recebe o motivo se pedirmos mudanças (reenvie o ZIP na mesma submissão, mesma versão) ou se recusarmos.
7. **Co-assinatura.** Aprovado, a tela pede a sua assinatura na carteira (`register_agent` para Solver novo; `update_version` para atualização). Você não paga taxa de rede (a plataforma é o fee payer).
8. **Publicado.** Solver novo ainda espera a aprovação on-chain da equipe (`approve_agent`, feita com a carteira fria); atualização de Solver já aprovado termina sozinha. A vitrine só muda no último passo.

Se você não assinar ou não reenviar em **30 dias**, o envio expira (vira `rejected`, o slug é liberado) e você envia de novo se quiser.

### Vincular o Telegram

O Telegram é por onde avisamos você (envio recebido, revisão, pedidos de ajuda de compradores). Você vincula sozinho, sem esperar a equipe:

1. Em `/creator/publish` (cadastro) clique em **Vincular Telegram**. O site mostra um código `LINK-XXXXXXXX` que vale **15 minutos** e serve **uma vez**. Dá para gerar até 5 por hora; um código novo cancela o anterior.
2. Clique em **Abrir no Telegram** (já preenche o código) e toque em *Começar*. Ou abra o bot do Solvers (o site mostra o @) e envie `/vincular LINK-XXXXXXXX`.
3. O bot responde "Pronto! Seu Telegram foi vinculado ao Solvers como ...". O site percebe sozinho em alguns segundos (ou clique em **Já vinculei**).

Só conversas privadas com o bot valem. Cada conta do Telegram fica em um criador só. Para trocar de conta do Telegram, gere um código novo e envie de outra conta. Se o bot disser que o código não vale, ele pode estar errado, vencido ou já usado: gere outro.
Se o site disser que a vinculação está indisponível, o bot do servidor está fora do ar (`TELEGRAM_BOT_TOKEN`); fale com a equipe, que também pode vincular com `cli:invite set-chat`.

### O que o validador exige (resumo)

O catálogo completo de códigos está no Apêndice A do `PACKAGE_SPEC.md`; erro bloqueia o envio, aviso vai ao revisor. Para conferir antes: `pnpm --filter @solvers/server cli:validate <pasta>` e o schema em `GET /api/spec/manifest.schema.json`.

- `manifest.json` com `specVersion: 1`, `terms`, `versions[]` com a versão atual, nome até 32 bytes, versão `X.Y.Z` até 16 bytes e preço mínimo do programa (5 USDC).
- `slug` fora da lista de reservados e nunca no formato de `id` (32 hex). O `id` e o `creator.id` são do servidor: ele sobrescreve o que você escrever.
- Etapas em `steps/` (1 a 12 `.md`, 400 a 12.000 caracteres) com as seções `## Goal`, `## What to ask the user`, `## How to run`, `## Common mistakes`, `## result_summary format` (em inglês, o padrão; os títulos antigos em português `## Objetivo`, `## O que perguntar ao usuário`, `## Como executar`, `## Erros comuns`, `## Formato do result_summary` continuam aceitos em pacotes mais antigos).
- Pelo menos **2 dos 5 diferenciais** comprovados pelo próprio pacote. No Núcleo, terceiros só podem provar `memory` (`onboarding` mais etapa que usa o perfil), `liveData` (conhecimento datado, sem `valid_until` vencido, `source_date` em pelo menos metade dos arquivos) e `escalation` (`escalation.enabled` com o seu Telegram vinculado). `tool` e `verifier` ficam para a Abertura. Declarar um que o pacote não prova gera aviso e o revisor não aprova com menos de 2 comprovados.
- Conhecimento `.md`/`.txt` com `source` e datas `AAAA-MM-DD` (front-matter em `.md`, `nome.txt.meta.json` em `.txt`); até 10.000 trechos.
- Pelo menos **10 casos** em `evals/cases/` (menos que isso é aviso hoje e erro em pacote v1).
- Texto em UTF-8, sem caracteres invisíveis ou de direção, sem padrões de injeção (viram aviso para o revisor).

### Nova versão

Envie um ZIP com a mesma `slug` e uma `version` **maior** que a publicada. Toda versão passa pela revisão completa, com diff automático de todos os arquivos contra a publicada. Mudar `tools`, `onboarding`, `requirements` ou a estrutura das etapas exige subir a versão MAJOR. Alterar a versão ou o preço direto na cadeia, sem passar por aqui, não muda o que o comprador recebe e bloqueia a venda (`price_in_review`) até a revisão aprovar ou você reverter.

### O que não é permitido no Núcleo

- **Ferramentas**: terceiros não declaram `tools` (nenhum runner). Só pacotes da plataforma têm `builtin:*`.
- **Garantia (escrow)**: `guarantee.available: true` é recusado; também não há pasta `verifier/` nem `platform: true`.
- **Categorias**: Finanças, Jurídico e Saúde são recusadas. Aceitas: Desenvolvimento, Design, Dia a dia, Negócios, Viagens, Conteúdo, Escrita, Outros.
- **Nota pública**: terceiros não têm nota de desempenho na vitrine; o card mostra "Sem avaliações ainda" (notas antigas de pacotes da equipe aparecem como "teste interno da equipe").

### Limites do ZIP e do envio

| Item | Limite |
|---|---|
| Tamanho do ZIP | 50 MB (`SUBMISSION_MAX_ZIP_BYTES`) |
| Bytes reais descompactados | 150 MB, contados durante a extração |
| Arquivos | 2.000 |
| Arquivo individual | 10 MB |
| Extensões | `.json`, `.md`, `.txt` |
| Estrutura | exatamente 1 pasta raiz com `manifest.json`; sem `..`, `\`, caminho absoluto, link simbólico ou nome começando com ponto |
| Lixo de sistema | `__MACOSX/`, `.DS_Store`, `Thumbs.db` são removidos com aviso |
| Envios em andamento | 3 por criador (`SUBMISSION_MAX_PENDING`) |
| Envios por dia | 5 por criador (`SUBMISSION_MAX_PER_DAY`) |

---

## Parte 2. Para o admin e o revisor

Os comandos rodam em `apps/server` (ou com `pnpm --filter @solvers/server <script>`), com o `.env` do ambiente. Variantes `:devnet` usam o `.env.devnet`.

### Quem é admin

`ADMIN_WALLETS` (carteiras separadas por vírgula, no `.env` do servidor) define quem vê `/admin/reviews` e as rotas `/api/admin/submissions/*`. É só permissão do site: **não assina nada on-chain**. A assinatura on-chain é do `ADMIN_KEYPAIR`, a carteira fria, que só existe na máquina do time.

### Convites e Telegram

Na raiz do repositório (`pnpm --filter @solvers/server ...`) ou, dentro de `apps/server`, só `pnpm cli:invite ...`. **Sem `--` extra:** o pnpm o repassa ao script e o comando quebra.

```bash
pnpm --filter @solvers/server cli:invite create --email fulano@x.com --note "quem é" --count 3   # imprime os códigos; você envia por e-mail (flags opcionais)
pnpm --filter @solvers/server cli:invite list                                                    # todos, com quem usou
pnpm --filter @solvers/server cli:invite revoke <código>                                         # só convite ainda não usado
pnpm --filter @solvers/server cli:invite set-chat <carteira> <chatId>                            # atalho: vincula o Telegram do criador à mão
# dentro de apps/server: pnpm cli:invite create --email x@y.com
```

O criador normalmente vincula sozinho pelo bot (veja "Vincular o Telegram", na parte do criador): `POST /api/creator/telegram-link` gera o código e o processo `solvers-worker` (o único que faz `getUpdates`) trata `/vincular` e `/start` no bot. `set-chat` continua como atalho e exige que o criador já tenha cadastrado o perfil. O bot precisa de `TELEGRAM_BOT_TOKEN` no `.env` do servidor e **não pode ter webhook ativo** (se tiver, o worker o remove uma vez, com log). Os avisos vão ao Telegram do criador; sem vínculo, os de revisão ficam só com o admin.

### Revisão em `/admin/reviews`

A fila mostra os envios `pending_review` do mais antigo ao mais novo. A tela do envio traz: validador (erros e avisos), manifesto, diff de todos os arquivos contra a versão publicada, conhecimento (trechos, vencidos, busca de teste na ingestão de staging), varreduras automáticas e diferenciais declarados x comprovados. Todo conteúdo do criador aparece como texto escapado.

Decisões (motivo de pelo menos 3 caracteres, obrigatório):

- **Aprovar** exige o checklist inteiro marcado: promessa entregue pelas etapas; 2 de 5 diferenciais comprovados; fontes e direitos; nada contra o usuário, sem envio de dados para fora, sem injeção; preço, teste grátis e vitrine coerentes (sem promessa financeira, jurídica ou médica). Grava a versão aprovada (hash, preço, versão) e passa a `awaiting_creator_signature`.
- **Pedir mudanças** e **Recusar**: só o motivo. O criador vê o texto.
- **Revogar aprovação** (`POST /api/admin/submissions/:id/revoke`): desfaz uma aprovação que o criador ainda não assinou; volta a `changes_requested`.

**Aprovar no site não assina nada on-chain.** A trilha de todas as ações fica em `package_reviews` (somente inserção; ações `approve`, `request_changes`, `reject`, `revoke`, `expire`, `finish`, `suspend`, `resume`).

### Aprovação on-chain e publicação

Para Solver **novo**, depois que o criador co-assinar o `register_agent` (estado `awaiting_onchain_approval`), na máquina com a carteira fria:

```bash
pnpm --filter @solvers/server cli:approve <slug|submissionId> [--dry-run] [--allow-network <nome>]
pnpm --filter @solvers/server cli:approve:devnet <slug>
```

Só aprova se a conta on-chain bate com a versão aprovada no site; depois conclui a publicação. Por padrão só roda na devnet (confere o genesis do RPC). Atualização de Solver já aprovado não passa por aqui.

### Suspender e reativar (kill switch)

```bash
pnpm --filter @solvers/server cli:suspend <slug> [--reason "<motivo>"] [--allow-network <nome>]
pnpm --filter @solvers/server cli:suspend <slug> --resume
```

Faz as duas coisas: `agents.platform_status = suspended` (derruba sessões abertas, vitrine e venda na hora; o indexador nunca escreve esse campo) e `suspend_agent` on-chain com `ADMIN_KEYPAIR` (sem isso a compra direta pela cadeia continuaria possível). `--resume` faz o caminho inverso. Fica registrado em `package_reviews`.

### Solvers da plataforma (sem cadeia)

```bash
pnpm --filter @solvers/server cli:publish --no-chain            # só o banco: preço 0, ativo, listado
```

Vale para os pacotes listados em `PLATFORM_AGENTS` (`runtime/platform-agents.ts`, a autoridade; o campo `platform` do manifesto sozinho não vale), como o `criador-de-solvers`. Terceiros nunca passam por aqui. Não republique pacotes com conta on-chain (`cli:publish` sem `--no-chain`) sem decidir antes sobre a nota de desempenho: `update_version` zera a nota gravada na cadeia.

### Quando algo falha: `publish_failed`

O estado significa que um passo da publicação (conhecimento, cadeia ou catálogo) falhou; a vitrine não mudou. Para retomar, uma das opções (idempotentes):

- Botão "Concluir" em `/admin/reviews`, ou `POST /api/admin/submissions/:id/finish` com a sessão de admin.
- `cli:approve <submissionId>` de novo (também termina a finalização se a cadeia já estiver Active).

Se a causa for de ambiente (RPC, disco), corrija e repita; o erro fica no campo `error` da submissão. O worker tenta de novo sozinho as falhas de sistema na validação (intervalo de 1 minuto, até 3 tentativas em `package_submissions.attempts`; esgotadas, o envio vira `rejected_validation` com aviso ao admin) e avisa o admin no Telegram na primeira falha.

### Onde ficam os arquivos e a limpeza

- `SUBMISSIONS_DIR` (produção: `/var/www/solvers/shared/submissions/<id>/`): ZIP original (`package.zip`) e a pasta extraída. Só o dono da VPS lê (chmod 700).
- `PUBLISHED_DIR` (produção: `/var/www/solvers/shared/packages/<slug>/`): um pacote ativo por slug; a versão anterior vai para `_archive/<slug>/<versão>/`.
- Ambos ficam em `shared/` e sobrevivem ao deploy. O backup semanal exclui ZIPs e `_archive` (patch em `docs/deploy-criador-solvers.md`).
- **Limpeza automática** (job `faxina das submissões`, a cada 6 h, `submissions/cleanup.ts`): (1) `changes_requested` e `awaiting_creator_signature` paradas há mais de 30 dias viram `rejected` com nota "expirada" (ação `expire`, assinada por `system`), liberam o slug e avisam o criador; (2) ZIP e pasta de envios rejeitados há mais de 30 dias são apagados (a linha e a trilha ficam); (3) pastas sem linha no banco e `.part` de upload cortado, com mais de 1 dia.

### O worker

`solvers-worker` é um processo PM2 **separado** do `solvers-api` (`infra/ecosystem.config.cjs`, `infra/worker-run.sh`, entrada `dist/worker/index.js`). Extrai o ZIP, valida, varre e ingere o conhecimento em staging, uma submissão por vez, com checkpoint em `ingest_jobs`. Local: `pnpm --filter @solvers/server worker` (compilado) ou `worker:dev`. Se o worker estiver parado, os envios ficam em `submitted`/`validating` e retomam do checkpoint quando ele voltar. Com `SUBMISSIONS_INLINE=true` (só QA local) o processamento roda dentro da API.

### `price_in_review` e `sync_flag`

O indexador compara a versão e o preço da cadeia com `agent_published_versions` (as versões aprovadas). Se divergirem (o criador chamou `update_version`/`update_pricing` direto), grava `agents.sync_flag = unapproved_chain_version`: o pacote servido continua o aprovado, a vitrine mostra o preço aprovado e a venda responde 409 `price_in_review`. Sai do estado quando a cadeia volta ao aprovado ou quando uma nova revisão aprova o hash. `agents.platform_status` (suspensão) é outra coluna e o indexador nunca a escreve.

### Para testar o fluxo inteiro (QA local)

`scripts/qa-reset.ps1` recria o banco descartável `t_qa` (contêiner `solvers-pg-criador`, porta 5544) e limpa as pastas de dados; depois, com o servidor local no `.env.qa`, `cd scripts && npm run e2e:creator`. Escreve na devnet só um Solver de teste (`qa-fluxo-criador`). Nunca aponta para o banco da VPS.

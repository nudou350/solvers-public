# Deploy do fluxo de criação de Solvers (roteiro na VPS)

Escopo: upload de ZIP (até 50 MB), processo `solvers-worker`, pastas persistentes, nginx e backup. Fonte: PACKAGE_SPEC.md §14.4, §15.1 e §16.
Quem executa: o líder, na VPS (`deploy@<VPS_IP>`). Tempo total estimado: **25 a 35 min**. Nada aqui foi executado: os arquivos do repositório
(`infra/deploy.sh`, `infra/ecosystem.config.cjs`, `infra/worker-run.sh`, `infra/nginx/solvers`, `infra/.env.example`, `infra/setup-vps.sh`) foram preparados e o
nginx foi validado com `nginx -t` (1.24, em contêiner local); o `deploy.sh` só passou em `bash -n`.

A infra é compartilhada com outros projetos (VPS_GUIDE): só se mexe em `solvers*` e no `backup.sh`. O nginx e o `.env` **não** são atualizados pelo deploy.

## O que NÃO muda

- Programa Anchor e devnet: **sem upgrade**. O upgrade anterior já foi feito (`docs/devnet-upgrade.md`); este deploy não toca na cadeia.
- Portas (3017 API, 4017 web), banco (PG16 :5433), outros sites do nginx, `nginx.conf` global (a zona nova fica no arquivo do site, ver §4).
- Os limites das demais rotas `/api` (corpo 2m, zona `api` 30 r/s) e a configuração do MCP.
- `RESALE_ENABLED` e demais variáveis existentes do `.env`.

## Roteiro

### 1. Conferências antes de começar (3 min)

```bash
df -h /                                   # sobra de disco (97 GB no total)
pm2 list                                  # solvers-api e solvers-web online
sudo grep -n "sites-enabled\|conf.d" /etc/nginx/nginx.conf      # o arquivo do site é incluído dentro de http{}
sudo grep -rn "solvers_upload" /etc/nginx/ || echo "nome de zona livre"
dig +short solvers.wondervelop.com        # deve ser <VPS_IP> (sem Cloudflare; ver nota do passo 4)
```

### 2. Pastas persistentes (1 min)

O `deploy.sh` também as cria, mas criar antes evita surpresa. Ficam em `shared/`, fora dos releases (a limpeza do deploy não as toca).

```bash
mkdir -p /var/www/solvers/shared/submissions /var/www/solvers/shared/packages
chmod 700 /var/www/solvers/shared/submissions /var/www/solvers/shared/packages
ls -ld /var/www/solvers/shared/submissions /var/www/solvers/shared/packages   # dono deploy, drwx------
```

### 3. `.env` de produção (2 min)

`/var/www/solvers/shared/.env` (o do release é um symlink para ele). **Não sobrescrever**: só acrescentar o que falta. O `deploy.sh` recusa seguir (antes de trocar o release) se
`SUBMISSIONS_DIR` ou `PUBLISHED_DIR` estiverem ausentes, e avisa se `ADMIN_WALLETS` estiver vazia.

```bash
cd /var/www/solvers/shared
cp -a .env .env.bak-$(date +%F)
grep -q '^SUBMISSIONS_DIR=' .env || echo 'SUBMISSIONS_DIR=/var/www/solvers/shared/submissions' >> .env
grep -q '^PUBLISHED_DIR=' .env   || echo 'PUBLISHED_DIR=/var/www/solvers/shared/packages' >> .env
grep -q '^ADMIN_WALLETS=' .env   || echo 'ADMIN_WALLETS=<carteira-admin-1>[,<carteira-admin-2>]' >> .env   # troque pelo endereço real
grep -nE '^(SUBMISSIONS_DIR|PUBLISHED_DIR|ADMIN_WALLETS)=' .env
chmod 600 .env
```

O release em execução ignora as variáveis novas; nada precisa ser recarregado agora. `GUARANTEE_*` reais (PACKAGE_SPEC §18) são decisão à parte.

### 4. nginx (5 min)

A `limit_req_zone` ficou **no arquivo do site** (`infra/nginx/solvers`), não no `/etc/nginx/nginx.conf`: o arquivo do site é incluído dentro de `http{}` (já tem os `upstream` ali), então
`map` e `limit_req_zone` são válidos lá, ficam versionados e não exige editar o arquivo compartilhado. O nome `solvers_upload` é global, daí o prefixo. A zona só conta POST (chave vazia para GET).
Se preferir seguir o VPS_GUIDE à risca (zonas no `nginx.conf`), mova as 5 linhas do topo do arquivo (`map` + `limit_req_zone`) para dentro de `http{}` do `nginx.conf`.

Nota Cloudflare: em 02/10, `solvers.wondervelop.com` resolve direto para `<VPS_IP>` e responde `Server: nginx` sem `cf-ray`, ou seja, **sem proxy**; o teto de 100 MB do plano gratuito não se aplica.
Se um dia ligarem o proxy (nuvem laranja), 50 MB cabe nos planos Free/Pro (100 MB), mas confirme.

Na máquina de desenvolvimento (raiz do repositório, no commit que vai ser deployado):

```bash
scp infra/nginx/solvers deploy@<VPS_IP>:/tmp/solvers.nginx.new
```

Na VPS:

```bash
sudo cp -a /etc/nginx/sites-available/solvers /etc/nginx/sites-available/solvers.bak-$(date +%F)
diff /etc/nginx/sites-available/solvers /tmp/solvers.nginx.new   # só devem aparecer o bloco do topo e o location novo; se houver ajuste local da VPS, PARE e reconcilie
sudo cp /tmp/solvers.nginx.new /etc/nginx/sites-available/solvers
sudo nginx -t && sudo systemctl reload nginx                     # só recarrega se o teste passar
```

Se o `nginx -t` falhar: `sudo cp /etc/nginx/sites-available/solvers.bak-<data> /etc/nginx/sites-available/solvers && sudo nginx -t` (o nginx em execução continua com a config antiga até o reload).
O arquivo `.bak-*` em `sites-available` não é carregado (só o symlink em `sites-enabled`).

Teste (a API ainda não tem a rota; o que importa é o nginx):

```bash
U=https://solvers.wondervelop.com/api/creator/submissions
head -c 55M /dev/zero > /tmp/z55; head -c 61M /dev/zero > /tmp/z61
curl -s -o /dev/null -w '55MB -> %{http_code}\n' -X POST -H 'Expect:' -H 'Content-Type: application/zip' --data-binary @/tmp/z55 $U   # NÃO pode ser 413 (404/401 é esperado)
curl -s -o /dev/null -w '61MB -> %{http_code}\n' -X POST -H 'Expect:' -H 'Content-Type: application/zip' --data-binary @/tmp/z61 $U   # 413
rm /tmp/z55 /tmp/z61
sleep 40   # os dois POST acima já gastaram parte do burst da zona (6 envios/min por IP)
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' -X POST $U; done; echo        # 4 respostas da API e depois 429 (zona solvers_upload, burst 3)
curl -s -o /dev/null -w 'GET -> %{http_code}\n' $U                                              # GET não passa pela zona de upload (nunca 429 por ela)
curl -s -o /dev/null -w 'outra rota /api -> %{http_code}\n' https://solvers.wondervelop.com/api/agents   # continua como antes
```

### 5. Backup (5 min, antes do próximo domingo 4h)

Aplicar o patch da seção "Patch do backup" abaixo no `/opt/deploy/backup.sh` (autorizado pelo dono, D5). Faça antes do push se possível; o tarball semanal só passa a incluir dados de criadores depois do primeiro envio.

### 6. Push e deploy automático (8 a 12 min)

Pré-checagem: nenhum upload em andamento (no primeiro deploy não há) e o `.env` do passo 3 pronto. Depois:

```bash
git push origin master            # dispara .github/workflows/deploy.yml -> infra/deploy.sh (concurrency: um deploy por vez)
```

O que o `deploy.sh` faz de novo, na ordem: cria as pastas persistentes e confere as variáveis (falha antes de trocar o release se faltarem) -> instala, compila, imagem do verificador ->
**migration 0016** (aditiva: 5 tabelas novas, 5 colunas novas com default, índices, gatilho de somente-inserção em `package_reviews`, backfill de `creators.invited` e das 6 versões publicadas;
o release ainda no ar ignora tudo isso) -> espera até 120 s se houver `package.zip*` sendo gravado -> troca os symlinks -> `pm2 reload` de `solvers-api` e `solvers-web`,
e **inicia `solvers-worker`** (ou recarrega) -> health check de ~30 s (API e web respondem; os três processos online e sem reinício sozinho; o worker não serve HTTP) -> `pm2 save`.
Se qualquer passo falhar depois da troca, volta sozinho ao release anterior; como o release anterior não tem `dist/worker/index.js`, o worker é **parado** (não entra em crash loop).

Tempo: ~8 a 12 min (install + build de API e web + imagem Docker em cache), na VPS de 2 vCPU.

Se o worker não subir sozinho:

```bash
pm2 start /var/www/solvers/app/infra/ecosystem.config.cjs --only solvers-worker && pm2 save
```

Mudanças no bloco do worker em `ecosystem.config.cjs` só valem depois de `pm2 delete solvers-worker && pm2 start ... --only solvers-worker && pm2 save` (`pm2 reload` não relê o ecosystem; só o ambiente).

### 7. Verificações pós-deploy (4 min)

```bash
pm2 list                                                          # solvers-api, solvers-web, solvers-worker: online
pm2 describe solvers-worker | grep -E "script path|exec cwd|restarts|status"
ps -o pid,ni,rss,args -p "$(pm2 pid solvers-worker)"              # NI = 10 (baixa prioridade); RSS bem abaixo de 900 MB em repouso
tr '\0' '\n' < /proc/"$(pm2 pid solvers-worker)"/environ | grep -E '^(ORT_NUM_THREADS|NODE_ENV)='   # ORT_NUM_THREADS=1
pm2 logs solvers-worker --lines 30 --nostream                     # sem erro; /var/www/solvers/logs/worker-*.log
curl -fsS https://solvers.wondervelop.com/health
curl -s -o /dev/null -w 'GET submissions sem login -> %{http_code}\n' https://solvers.wondervelop.com/api/creator/submissions    # 401 (não 404/502)
curl -s -o /dev/null -w 'POST submissions sem login -> %{http_code}\n' -X POST -H 'Content-Type: application/zip' --data-binary @/dev/null https://solvers.wondervelop.com/api/creator/submissions   # 401
ls -ld /var/www/solvers/shared/submissions /var/www/solvers/shared/packages
cd /var/www/solvers/app/apps/server && node --env-file=.env -e 'const e=process.env;console.log(e.SUBMISSIONS_DIR,e.PUBLISHED_DIR,!!e.ADMIN_WALLETS)'
psql "$(grep -m1 '^DATABASE_URL=' /var/www/solvers/shared/.env | cut -d= -f2-)" -tAc "select (select count(*) from agent_published_versions) as versoes_semeadas, (select count(*) from creators where invited) as convidados"   # 6 versões semeadas
```

Teste de ponta a ponta (upload real de um ZIP pequeno por um criador convidado) é do roteiro funcional do líder; não faz parte deste.

### 8. Rollback de cada peça

| Peça | Como voltar | Efeito |
|---|---|---|
| Release (código) | Automático se o health check falhar. Manual: `ln -sfn /var/www/solvers/releases/<anterior> /var/www/solvers/app` e refazer os links `backend`, `frontend`, `agents` (ver `activate` no `deploy.sh`), depois `pm2 reload solvers-api solvers-web` | Volta à API sem as rotas de criação |
| Worker | `pm2 stop solvers-worker` (parar, não deletar). Envios ficam em `submitted`/`validating` e retomam do checkpoint quando religar | Nada se perde; ZIPs e pastas ficam em `shared/` |
| Migration 0016 | **Não reverter**: é aditiva e o release antigo a ignora. Só em desastre, restaurar o dump diário (`/home/deploy/backups/daily/`) | Tabelas novas ficam sem uso |
| nginx | `sudo cp /etc/nginx/sites-available/solvers.bak-<data> /etc/nginx/sites-available/solvers && sudo nginx -t && sudo systemctl reload nginx` | O upload volta a ser limitado a 2m (a rota fica indisponível, o resto não muda) |
| `.env` | `cp /var/www/solvers/shared/.env.bak-<data> /var/www/solvers/shared/.env` e `pm2 reload solvers-api solvers-worker --update-env` | Variáveis novas somem; o `deploy.sh` voltaria a recusar um release novo |
| Pastas persistentes | Não apagar. Se for preciso zerar: `rm -rf` só do conteúdo, com a API e o worker parados | Perde ZIPs e pacotes publicados (os pacotes publicados têm backup semanal) |
| Backup | Restaurar o `backup.sh` da cópia `.bak-<data>` feita no passo 5 | Volta o tarball completo (inclui ZIPs) |

### 9. Deploy não pode derrubar um upload sem necessidade

- O `pm2 reload solvers-api` (fork único) **corta** conexões abertas, inclusive um upload de ZIP (PACKAGE_SPEC §16: o criador reenvia). O deploy dispara a cada push na `master`.
- Mitigação já no `deploy.sh`: antes de recarregar, ele espera até `UPLOAD_WAIT` s (padrão 120) enquanto algum `SUBMISSIONS_DIR/<id>/package.zip*` tiver mtime dos últimos 10 s, e depois recarrega de qualquer jeito.
  Isso supõe que o servidor grave o ZIP (ou um `.part`) com esse prefixo e que a escrita avance continuamente; **confirmar com o código da rota de upload** (`apps/server/src/creator`). Um upload mais longo que a espera ainda é cortado.
- Na prática: evite push em horário de uso; confira antes `find /var/www/solvers/shared/submissions -name 'package.zip*' -mmin -1`. O worker, ao ser reiniciado (SIGTERM com 20 s de `kill_timeout`), retoma do último arquivo concluído.
- Pushes que só mudam docs também disparam o deploy completo (já era assim).

### 10. Disco (alerta a 20 GB em submissions + packages; disco de 97 GB)

```bash
du -sb /var/www/solvers/shared/submissions /var/www/solvers/shared/packages | awk '{s+=$1} END {printf "%.1f GB\n", s/1024^3; if (s > 20*1024^3) print "ALERTA: acima de 20 GB"}'
df -h /
```

O patch do backup abaixo repete essa checagem no backup diário e escreve o alerta em `/home/deploy/backups/backup.log`. Telegram para esse alerta fica fora deste escopo.

## Patch do backup (`/opt/deploy/backup.sh`, não aplicado)

Atenção: o `backup.sh` **não estava disponível** ao preparar este roteiro (só a descrição do VPS_GUIDE §9: tarball semanal de `/var/www/<projeto>`, retenção de 4 semanas). O diff abaixo é um modelo: ajuste as linhas
ao arquivo real. Para achar o ponto: `grep -n "tar \|weekly\|backup_daily\|backup_weekly" /opt/deploy/backup.sh`. Antes de editar: `sudo cp -a /opt/deploy/backup.sh /opt/deploy/backup.sh.bak-$(date +%F)`.

```diff
--- a/opt/deploy/backup.sh
+++ b/opt/deploy/backup.sh
@@ backup_weekly(): onde cada /var/www/<projeto> vira tarball @@
-    tar -czf "$DEST/$p.tar.gz" -C /var/www "$p"
+    # Solvers: ZIPs enviados (reprocessáveis/descartáveis) e versões arquivadas ficam fora do tarball.
+    # Entram o resto do projeto e os pacotes publicados (shared/packages, sem _archive). O banco já está no dump diário.
+    tar -czf "$DEST/$p.tar.gz" -C /var/www \
+      --exclude="$p/shared/submissions" \
+      --exclude="$p/shared/packages/_archive" \
+      "$p"
@@ no fim de backup_daily() @@
+    cleanup_solvers_submissions
@@ novas funções, antes de backup_daily() @@
+cleanup_solvers_submissions() {
+  local envf=/var/www/solvers/shared/.env db sub arch=/var/www/solvers/shared/packages/_archive
+  [ -f "$envf" ] || return 0
+  db=$(grep -m1 '^DATABASE_URL=' "$envf" | cut -d= -f2-)
+  sub=$(grep -m1 '^SUBMISSIONS_DIR=' "$envf" | cut -d= -f2- | sed 's/[[:space:]]*#.*//')
+  [[ "$sub" == /var/www/solvers/shared/* ]] && [ -d "$sub" ] && [ -n "$db" ] || return 0
+  # ZIPs e pastas extraídas de envios rejeitados há mais de 30 dias (a linha no banco e a trilha de revisão ficam).
+  psql "$db" -tAc "select id from package_submissions where status in ('rejected_validation','rejected') and updated_at < now() - interval '30 days'" \
+    | while read -r id; do [[ "$id" =~ ^[A-Za-z0-9_-]{6,64}$ ]] && rm -rf -- "$sub/$id"; done
+  # Versões arquivadas há mais de 180 dias (_archive/<slug>/<versão>).
+  [ -d "$arch" ] && find "$arch" -mindepth 2 -maxdepth 2 -type d -mtime +180 -exec rm -rf -- {} +
+  # Alerta de disco (PACKAGE_SPEC §16): 20 GB em submissions + packages.
+  local used; used=$(du -sb "$sub" /var/www/solvers/shared/packages 2>/dev/null | awk '{s+=$1} END {print s+0}')
+  [ "$used" -gt $((20 * 1024 * 1024 * 1024)) ] && echo "$(date -Is) ALERTA solvers: submissions+packages = $((used / 1024 / 1024 / 1024)) GB (> 20 GB)" >> /home/deploy/backups/backup.log
+  return 0
+}
```

Conferência (tamanho do tarball antes/depois, sem rodar o backup inteiro nem gravar em disco):

```bash
# antes: como o backup semanal faz hoje
tar -czf - -C /var/www solvers | wc -c
# depois: com as exclusões
tar -czf - -C /var/www --exclude='solvers/shared/submissions' --exclude='solvers/shared/packages/_archive' solvers | wc -c
# prova de que nada indevido entra no tarball real (depois de editar o script e rodar `/opt/deploy/backup.sh weekly` uma vez):
tar -tzf /home/deploy/backups/weekly/<arquivo-do-solvers>.tar.gz | grep -cE 'shared/(submissions|packages/_archive)'   # 0
tar -tzf /home/deploy/backups/weekly/<arquivo-do-solvers>.tar.gz | grep -c 'shared/packages/'                         # >= 1 depois do primeiro pacote publicado
bash -n /opt/deploy/backup.sh && echo sintaxe-ok
```

Limpeza: teste primeiro a consulta (`psql ... -tAc "select id, status, updated_at ..."`) e liste o que seria removido (`echo` no lugar de `rm -rf`) antes de ativar.
Rollback do backup: voltar a cópia `backup.sh.bak-<data>`.

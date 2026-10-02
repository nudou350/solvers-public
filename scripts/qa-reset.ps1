# Recria o banco descartável do QA (t_qa no contêiner solvers-pg-criador, porta 5544), migra e limpa as pastas de dados locais.
# NUNCA aponta para 5433/15433 (a migração usa SÓ o apps/server/.env.qa). Pare o servidor local antes (ele mantém conexões abertas).
$ErrorActionPreference = "Stop"
$server = Join-Path $PSScriptRoot "..\apps\server"
docker exec solvers-pg-criador psql -U postgres -c "DROP DATABASE IF EXISTS t_qa WITH (FORCE)"
docker exec solvers-pg-criador psql -U postgres -c "CREATE DATABASE t_qa"
docker exec solvers-pg-criador psql -U postgres -d t_qa -c "CREATE EXTENSION IF NOT EXISTS vector"
Push-Location $server
try {
  node --env-file=.env.qa --import tsx src/db/migrate.ts
} finally { Pop-Location }
foreach ($d in "submissions", "packages") {
  $p = Join-Path $server ".qa-data\$d"
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
  New-Item -ItemType Directory -Force $p | Out-Null
}
Remove-Item (Join-Path $server ".qa-data\e2e-state.json") -ErrorAction SilentlyContinue
"banco t_qa recriado e migrado"

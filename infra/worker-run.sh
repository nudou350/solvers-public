#!/usr/bin/env bash
# Partida do solvers-worker (chamado pelo PM2 com interpreter "bash"; cwd = /var/www/solvers/backend).
# O PM2 não aplica nice; `exec` mantém o PID do node, então o SIGTERM do PM2 chega direto ao worker.
# Prioridade baixa (nice 10) para a extração/ingestão não competir com a API e o MCP (2 vCPU compartilhadas).
set -euo pipefail
# WORKER_NODE vem do ecosystem (o node que roda o próprio PM2), para não depender do PATH do daemon após reboot.
exec nice -n "${WORKER_NICE:-10}" "${WORKER_NODE:-node}" --env-file=.env ./dist/worker/index.js

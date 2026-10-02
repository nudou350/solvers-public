// PM2 (padrão da VPS: /var/www/<projeto>, nomes <projeto>-api e <projeto>-web, logs em /var/www/<projeto>/logs).
module.exports = {
  apps: [
    {
      name: "solvers-api",
      script: "./dist/index.js",
      cwd: "/var/www/solvers/backend",
      node_args: "--env-file=.env",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", PORT: 3017 },
      error_file: "/var/www/solvers/logs/backend-err.log",
      out_file: "/var/www/solvers/logs/backend-out.log",
      log_file: "/var/www/solvers/logs/backend-combined.log",
      time: true,
      merge_logs: true,
      // Embeddings locais (transformers.js) usam ~300 MB.
      max_memory_restart: "900M",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
    },
    {
      // Vitrine (Next.js, `next start` via start.mjs). O nginx manda / para a 4017 e as rotas da API para a 3017.
      name: "solvers-web",
      script: "./start.mjs",
      cwd: "/var/www/solvers/frontend",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", PORT: 4017, HOSTNAME: "127.0.0.1", API_INTERNAL_URL: "http://127.0.0.1:3017" },
      error_file: "/var/www/solvers/logs/frontend-err.log",
      out_file: "/var/www/solvers/logs/frontend-out.log",
      log_file: "/var/www/solvers/logs/frontend-combined.log",
      time: true,
      merge_logs: true,
      max_memory_restart: "500M",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
    },
    {
      // Worker de submissões (PACKAGE_SPEC.md 16): extrai o ZIP, valida, varre e ingere o conhecimento, uma ingestão por vez,
      // com checkpoint em ingest_jobs. Não serve HTTP. Fica fora do solvers-api para não competir com MCP e pagamentos.
      // Prioridade baixa: o PM2 não tem opção de nice, então o script de partida (infra/worker-run.sh) faz `exec nice -n 10 node ...`.
      name: "solvers-worker",
      script: "/var/www/solvers/app/infra/worker-run.sh",
      interpreter: "bash",
      cwd: "/var/www/solvers/backend",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", ORT_NUM_THREADS: "1", WORKER_NICE: "10", WORKER_NODE: process.execPath },
      error_file: "/var/www/solvers/logs/worker-err.log",
      out_file: "/var/www/solvers/logs/worker-out.log",
      log_file: "/var/www/solvers/logs/worker-combined.log",
      time: true,
      merge_logs: true,
      // Extração e embeddings; reinício próprio (o job retoma do último arquivo concluído).
      max_memory_restart: "900M",
      // Tempo para o worker terminar o arquivo em curso e gravar o checkpoint ao receber SIGTERM (deploy/reload).
      kill_timeout: 20000,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};

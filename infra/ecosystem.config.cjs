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
  ],
};

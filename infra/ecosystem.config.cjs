// PM2 (padrão da VPS: /var/www/<projeto>, nome <projeto>-api, logs em /var/www/<projeto>/logs).
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
      // Embeddings locais (transformers.js) usam ~300 MB.
      max_memory_restart: "900M",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};

import type { Mount } from "./app.js";

// Ponto único onde os módulos das próximas fases (OAuth, MCP, garantia, jobs) se registram.

export const mounts: Mount[] = [];

const jobs: Array<{ start: () => void; stop: () => void }> = [];

export function startJobs() {
  for (const j of jobs) j.start();
}

export function stopJobs() {
  for (const j of jobs) j.stop();
}

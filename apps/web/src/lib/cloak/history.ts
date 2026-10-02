// Histórico local dos saques privados deste navegador (nada vai para o servidor do Solvers).
// Guarda o suficiente para retomar um saque interrompido e para escolher o destino do relatório do contador.
// As chaves NÃO ficam aqui: são derivadas da assinatura da carteira (ver derive-keys em ./withdraw.ts).

export type WithdrawEntry = {
  id: string;
  createdAt: number;
  /** Unidades base de USDC (texto, por causa do bigint). */
  amount: string;
  destination: string;
  /** started: nada saiu da carteira ainda · deposited: o valor está no pool (retomável) · done: concluído. */
  status: "started" | "deposited" | "done";
  /** Nota blindada serializada (base64): só existe depois do depósito. */
  note?: string;
  depositSignature?: string;
  withdrawSignature?: string;
};

const KEY = "solvers.cloak.history.v1";

function read(address: string): WithdrawEntry[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, WithdrawEntry[]>;
    return all[address] ?? [];
  } catch {
    return [];
  }
}

const memory = new Map<string, WithdrawEntry[]>();

/** Histórico da carteira, mais recente primeiro. Sem localStorage (Node, aba privada) usa a memória do processo. */
export function loadHistory(address: string): WithdrawEntry[] {
  const list = typeof localStorage === "undefined" ? (memory.get(address) ?? []) : read(address);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export function saveEntry(address: string, entry: WithdrawEntry): void {
  const list = loadHistory(address).filter((e) => e.id !== entry.id);
  list.push(entry);
  if (typeof localStorage === "undefined") {
    memory.set(address, list);
    return;
  }
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, WithdrawEntry[]>;
    all[address] = list;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    memory.set(address, list);
  }
}

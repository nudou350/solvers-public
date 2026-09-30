// Tipos e validação do relatório do verificador. Sem env/banco/Docker: dá para testar de forma unitária.
//
// O relatório JSON do vitest é escrito dentro do container, perto do código não confiável. Por isso
// só é aceito se (1) o container terminou normalmente com código 0, (2) cada arquivo da bateria de
// aceite esperada aparece no relatório, com testes e todos aprovados, e (3) nada foi pulado.

export type Files = Record<string, string>;

export type TestReport = {
  passed: boolean;
  mode: "docker" | "simulated" | "manual";
  numTests: number;
  numPassed: number;
  numFailed: number;
  /** Testes da bateria de aceite (fixa) versus testes que vieram na entrega. */
  acceptance: { numTests: number; numPassed: number } | null;
  failures: { test: string; message: string }[];
  durationMs: number;
  log?: string;
};

export type RunResult = { report: TestReport; previewHtml: string | null };

/** Pasta da entrega dentro do container (raiz do vitest: /work). */
export const CONTAINER_WORK = "/work";
export const PREVIEW_TEST_FILE = "__preview__.test.tsx";

type VitestAssertion = { fullName?: unknown; title?: unknown; status?: unknown; failureMessages?: unknown };
type VitestFile = { name?: unknown; status?: unknown; message?: unknown; assertionResults?: unknown };
type VitestJson = { success?: unknown; testResults?: unknown };

export type EvalInput = {
  /** JSON do vitest já lido com segurança (null se ausente/inválido). */
  json: unknown | null;
  /** Por que não há JSON utilizável (vai na falha de execução). */
  jsonProblem?: string;
  exitCode: number;
  timedOut?: boolean;
  /** O container passou do limite de disco do relatório e foi morto. */
  overflow?: boolean;
  /** Fim da saída do container (diagnóstico). */
  out: string;
  /** Nomes (já gravados em src/) dos arquivos da bateria de aceite esperada; null = sem bateria. */
  acceptanceFiles: string[] | null;
  durationMs: number;
};

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Caminho do arquivo de teste relativo à raiz do vitest (`src/X.test.tsx`), comparável por igualdade exata. */
export function relTestPath(name: string): string {
  return name.startsWith(`${CONTAINER_WORK}/`) ? name.slice(CONTAINER_WORK.length + 1) : name;
}

export function evaluateReport(i: EvalInput): TestReport {
  const base = { mode: "docker" as const, durationMs: i.durationMs };
  const tail = i.out.slice(-1500);

  const execFailure = (message: string): TestReport => ({
    ...base,
    passed: false,
    numTests: 0,
    numPassed: 0,
    numFailed: 0,
    acceptance: i.acceptanceFiles ? { numTests: 0, numPassed: 0 } : null,
    failures: [{ test: "execução", message: message.slice(0, 1500) }],
    log: i.out.slice(-2000) || undefined,
  });

  if (i.timedOut) return execFailure("A verificação passou do tempo limite e foi interrompida.");
  if (i.overflow) return execFailure("A execução gerou arquivos demais no relatório e foi interrompida.");
  const json = i.json;
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return execFailure(i.jsonProblem ?? (tail || "Sem relatório de testes"));
  }

  const files = Array.isArray((json as VitestJson).testResults) ? ((json as VitestJson).testResults as VitestFile[]) : [];
  const previewPath = `src/${PREVIEW_TEST_FILE}`;
  const expected = new Set((i.acceptanceFiles ?? []).map((f) => `src/${f}`));

  type Row = { file: string; name: string; ok: boolean; msg: string };
  const rows: Row[] = [];
  const failures: { test: string; message: string }[] = [];
  const seenExpected = new Map<string, { assertions: number }>();

  for (const fr of files) {
    if (fr == null || typeof fr !== "object") continue;
    const file = relTestPath(str(fr.name));
    if (file === previewPath) continue; // teste auxiliar do servidor, não conta
    const assertions = Array.isArray(fr.assertionResults) ? (fr.assertionResults as VitestAssertion[]) : [];
    let anyFailed = false;
    for (const a of assertions) {
      const ok = a?.status === "passed";
      if (!ok) anyFailed = true;
      const msgs = Array.isArray(a?.failureMessages) ? (a.failureMessages as unknown[]).map((m) => str(m)).join("\n") : "";
      rows.push({ file, name: str(a?.fullName) || str(a?.title) || "teste", ok, msg: msgs });
    }
    // Arquivo que nem carregou (erro de importação/sintaxe): o vitest marca o arquivo como falho, sem testes.
    if (str(fr.status) === "failed" && !anyFailed) {
      failures.push({ test: file, message: (str(fr.message) || "O arquivo de teste falhou ao carregar.").slice(0, 800) });
    }
    if (expected.has(file)) seenExpected.set(file, { assertions: assertions.length });
  }

  for (const r of rows) if (!r.ok) failures.push({ test: r.name, message: r.msg.slice(0, 800) });

  // Bateria de aceite: cada arquivo esperado precisa ter rodado, com testes, todos aprovados.
  let accOk = true;
  for (const f of expected) {
    const seen = seenExpected.get(f);
    if (!seen || seen.assertions === 0) {
      accOk = false;
      failures.push({ test: f.replace(/^src\//, ""), message: "Arquivo da bateria de aceite não rodou ou não tem testes." });
    } else if (rows.some((r) => r.file === f && !r.ok)) {
      accOk = false;
    }
  }
  const acc = rows.filter((r) => expected.has(r.file));

  // Só detalha o código quando nenhum teste explica a falha (ex: erro não tratado depois dos testes).
  if (i.exitCode !== 0 && failures.length === 0) {
    failures.push({ test: "execução", message: `O vitest terminou com código ${i.exitCode}.${tail ? ` ${tail}` : ""}`.slice(0, 1500) });
  }
  if ((json as VitestJson).success === false && failures.length === 0) {
    failures.push({ test: "execução", message: "O vitest reportou a execução como malsucedida." });
  }

  const numPassed = rows.filter((r) => r.ok).length;
  return {
    ...base,
    passed: i.exitCode === 0 && rows.length > 0 && failures.length === 0 && accOk,
    numTests: rows.length,
    numPassed,
    numFailed: rows.length - numPassed,
    acceptance: i.acceptanceFiles ? { numTests: acc.length, numPassed: acc.filter((r) => r.ok).length } : null,
    failures,
    log: undefined,
  };
}

// ---------- Estado on-chain da etapa antes do mark_passed ----------

export const MILESTONE_PENDING = 0;
export const MILESTONE_PASSED = 1;

export type ChainMilestone = { status: number; deliverableHash: string } | null;

/**
 * Decide o que fazer com o mark_passed (irreversível on-chain):
 * - send: etapa pendente (ou estado on-chain desconhecido): enviar;
 * - already: já está Passed com o MESMO hash (envio anterior que caiu no meio): não reenviar;
 * - conflict: já Passed com outro hash, ou em outro estado: não dá para marcar esta entrega.
 */
export function planMarkPassed(state: ChainMilestone, hashHex: string): "send" | "already" | "conflict" {
  if (!state) return "send";
  if (state.status === MILESTONE_PENDING) return "send";
  if (state.status === MILESTONE_PASSED && state.deliverableHash.toLowerCase() === hashHex.toLowerCase()) return "already";
  return "conflict";
}

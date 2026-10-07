import { closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, type Dir } from "node:fs";
import { join } from "node:path";

// Leitura de arquivos que VÊM DO CONTAINER (pasta do relatório, gravável pelo código da entrega).
// O código não confiável pode deixar ali um symlink para um arquivo do host (ex: a chave do verificador),
// um FIFO (readFileSync travaria o servidor inteiro) ou um arquivo gigante. Por isso nada daqui usa
// readFileSync/existsSync direto: só regular file, sem seguir symlink, com teto de bytes.

export type SafeRead =
  | { ok: true; data: Buffer }
  | { ok: false; reason: "missing" | "not_regular" | "too_large" | "error"; detail?: string };

export type ReadFailure = Extract<SafeRead, { ok: false }>["reason"];
export type SafeJson = { ok: true; value: unknown } | { ok: false; reason: ReadFailure | "invalid_json"; detail?: string };

const { O_RDONLY } = constants;
// Indefinidos no Windows (dev): lá o lstat abaixo já barra symlink.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;

/**
 * Lê um arquivo regular de até `maxBytes`. Nunca lança: symlink, FIFO, dispositivo, diretório e
 * arquivo grande demais voltam como `ok: false`. `missing` só quando o caminho não existe.
 */
export function readRegularFile(path: string, maxBytes: number): SafeRead {
  let fd: number | null = null;
  try {
    // lstat não abre o arquivo (não bloqueia em FIFO) e não segue symlink.
    const pre = lstatSync(path);
    if (!pre.isFile()) return { ok: false, reason: "not_regular", detail: pre.isSymbolicLink() ? "symlink" : "arquivo especial" };
    // O_NOFOLLOW fecha a janela entre o lstat e o open (o código do container pode trocar o arquivo).
    fd = openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, reason: "not_regular", detail: "arquivo especial" };
    if (st.size > maxBytes) return { ok: false, reason: "too_large", detail: `${st.size} bytes` };
    const buf = Buffer.allocUnsafe(st.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { ok: true, data: buf.subarray(0, off) };
  } catch (e) {
    const code = errCode(e);
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, reason: "missing" };
    // ELOOP/EMLINK: O_NOFOLLOW recusou um symlink.
    if (code === "ELOOP" || code === "EMLINK") return { ok: false, reason: "not_regular", detail: "symlink" };
    return { ok: false, reason: "error", detail: code ?? String(e) };
  } finally {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        /* nada a fazer */
      }
    }
  }
}

/** Lê JSON do container com os mesmos limites. JSON inválido vira `ok: false`, nunca exceção. */
export function readRegularJson(path: string, maxBytes: number): SafeJson {
  const r = readRegularFile(path, maxBytes);
  if (!r.ok) return r;
  try {
    return { ok: true, value: JSON.parse(r.data.toString("utf8")) as unknown };
  } catch (e) {
    return { ok: false, reason: "invalid_json", detail: (e as Error).message.slice(0, 200) };
  }
}

/** Texto legível do motivo de uma leitura recusada (vai no relatório de falha). */
export function describeReadFailure(what: string, r: { reason: string; detail?: string }): string {
  const why: Record<string, string> = {
    missing: "was not generated",
    not_regular: `is not a regular file (${r.detail ?? "invalid"})`,
    too_large: `exceeded the size limit (${r.detail ?? ""})`,
    invalid_json: `is not valid JSON (${r.detail ?? ""})`,
    error: `could not be read (${r.detail ?? ""})`,
  };
  return `${what} ${why[r.reason] ?? r.reason}`;
}

/**
 * Uso de disco de uma pasta sem seguir symlinks (vigia do relatório durante a execução). Lê as
 * entradas uma a uma (Dir.readSync) e para ao passar de `maxEntries`: uma pasta com milhões de
 * arquivos não é carregada inteira na memória do servidor.
 */
export function dirUsage(dir: string, maxEntries = 1000): { bytes: number; entries: number; truncated: boolean } {
  let bytes = 0;
  let entries = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let handle: Dir;
    try {
      handle = opendirSync(d);
    } catch {
      continue; // pasta sem permissão de leitura: nada a somar
    }
    try {
      for (;;) {
        const ent = handle.readSync();
        if (!ent) break;
        if (++entries > maxEntries) return { bytes, entries, truncated: true };
        const full = join(d, ent.name);
        try {
          const st = lstatSync(full);
          if (st.isDirectory()) stack.push(full);
          else bytes += Math.max(st.size, (st.blocks ?? 0) * 512);
        } catch {
          /* sumiu no meio: ignora */
        }
      }
    } catch {
      /* erro de leitura no meio da pasta: segue com o que já somou */
    } finally {
      try {
        handle.closeSync();
      } catch {
        /* já fechado */
      }
    }
  }
  return { bytes, entries, truncated: false };
}

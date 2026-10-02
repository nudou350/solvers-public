import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { relativePathProblem } from "../runtime/package-paths.js";
import type { PackageEntry } from "../runtime/validate/index.js";

// Extração segura do ZIP enviado por terceiros (PACKAGE_SPEC.md 3.2). Nada do ZIP é executado e nenhum link é seguido:
//   - a lista de arquivos vem do DIRETÓRIO CENTRAL (yauzl) e é toda conferida ANTES de gravar qualquer byte;
//   - os bytes reais são contados em streaming durante a extração e a extração aborta ao estourar o teto
//     (o tamanho declarado no cabeçalho não é confiado: uma bomba mente nele);
//   - arquivos entram com modo 0640 (sem execução) numa pasta isolada, e o nome de cada um é conferido contra `..`, `\`,
//     caminho absoluto, controle e nome iniciando em ponto antes de virar caminho de disco.
// Quem chama trata `ZipError`: os `issues` já têm o formato do validador ({ code, path, message, fix }).

export type ZipIssue = { code: string; path: string; message: string; fix: string };

/** Códigos do catálogo (Apêndice A) mais `ZIP_UNREADABLE` (ZIP corrompido, cifrado ou com compressão não suportada). */
export class ZipError extends Error {
  constructor(readonly issues: ZipIssue[]) {
    super(issues[0]?.message ?? "ZIP inválido");
    this.name = "ZipError";
  }
}

export type ZipLimits = {
  zipBytes: number;
  expandedBytes: number;
  files: number;
  fileBytes: number;
  /** Extensões aceitas no Núcleo (minúsculas, com ponto). */
  allowedExtensions: readonly string[];
};

export const NUCLEO_ZIP_LIMITS: ZipLimits = {
  zipBytes: 50 * 1024 * 1024,
  expandedBytes: 150 * 1024 * 1024,
  files: 2000,
  fileBytes: 10 * 1024 * 1024,
  allowedExtensions: [".json", ".md", ".txt"],
};

export type ExtractedZip = {
  /** Pasta onde o conteúdo da raiz do ZIP foi extraído: `manifest.json` fica direto nela. */
  root: string;
  /** Nome da pasta raiz dentro do ZIP. */
  rootName: string;
  /** Arquivos extraídos, com caminho relativo à raiz e tamanho REAL. */
  entries: PackageEntry[];
  /** `ZIP_IGNORED_FILE` para o lixo de sistema removido. */
  warnings: ZipIssue[];
  /** Bytes reais gravados e tamanho do ZIP (alimentam o `archive` do validador). */
  expandedBytes: number;
  zipBytes: number;
};

const issue = (code: string, path: string, message: string, fix: string): ZipIssue => ({ code, path, message, fix });

const JUNK_BASENAMES = new Set([".DS_Store", "Thumbs.db"]);
const isJunk = (name: string) => name.startsWith("__MACOSX/") || name === "__MACOSX" || JUNK_BASENAMES.has(name.slice(name.lastIndexOf("/") + 1));

const extOf = (p: string) => {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
};

type Item = { entry: yauzl.Entry; rel: string; declared: number };

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((ok, fail) => {
    // decodeStrings:false -> o nome chega como Buffer e é decodificado/validado aqui (o yauzl trocaria `\` por `/` em silêncio).
    // validateEntrySizes:false -> o tamanho real é contado por nós, em streaming, contra os tetos.
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: false }, (err, zf) => (err || !zf ? fail(err ?? new Error("ZIP vazio")) : ok(zf)));
  });
}

/** Lê o diretório central inteiro (sem extrair nada). */
function readEntries(zf: yauzl.ZipFile, maxEntries: number): Promise<yauzl.Entry[]> {
  return new Promise((ok, fail) => {
    const all: yauzl.Entry[] = [];
    zf.on("error", fail);
    zf.on("end", () => ok(all));
    zf.on("entry", (e: yauzl.Entry) => {
      all.push(e);
      if (all.length > maxEntries) {
        zf.removeAllListeners("end");
        fail(new ZipError([issue("ZIP_TOO_MANY_FILES", "", `O ZIP tem mais de ${maxEntries} entradas`, "Junte arquivos pequenos de conhecimento.")]));
        return;
      }
      zf.readEntry();
    });
    zf.readEntry();
  });
}

function openEntry(zf: yauzl.ZipFile, e: yauzl.Entry) {
  return new Promise<NodeJS.ReadableStream>((ok, fail) => zf.openReadStream(e, (err, s) => (err || !s ? fail(err ?? new Error("sem stream")) : ok(s))));
}

/**
 * Extrai o ZIP em `destDir` (criada aqui; precisa não existir). Em qualquer falha apaga o que gravou e lança `ZipError`.
 */
export async function extractZip(zipPath: string, destDir: string, limits: ZipLimits = NUCLEO_ZIP_LIMITS): Promise<ExtractedZip> {
  const st = await stat(zipPath);
  if (st.size > limits.zipBytes) {
    throw new ZipError([issue("ZIP_TOO_LARGE", "", `ZIP de ${st.size} bytes passa do teto de ${limits.zipBytes}`, "Reduza o conhecimento ou divida o conteúdo.")]);
  }
  let zf: yauzl.ZipFile | undefined;
  try {
    try {
      zf = await openZip(zipPath);
    } catch (e) {
      throw new ZipError([issue("ZIP_UNREADABLE", "", `Não consegui abrir o ZIP: ${(e as Error).message}`, "Gere o ZIP de novo (selecione a pasta do pacote e compacte).")]);
    }
    const entries = await readEntries(zf, limits.files * 2 + 100).catch((e) => {
      if (e instanceof ZipError) throw e;
      throw new ZipError([issue("ZIP_UNREADABLE", "", `ZIP corrompido: ${(e as Error).message}`, "Gere o ZIP de novo.")]);
    });
    const { items, rootName, warnings } = plan(entries, limits);
    const root = resolve(destDir);
    await mkdir(root, { recursive: true, mode: 0o750 });
    try {
      const out = await extractItems(zf, items, root, limits);
      return { root, rootName, entries: out.entries, warnings, expandedBytes: out.bytes, zipBytes: st.size };
    } catch (e) {
      await rm(root, { recursive: true, force: true });
      throw e;
    }
  } finally {
    zf?.close();
  }
}

/** Confere todas as entradas do diretório central e devolve o que será extraído. Lança com TODOS os problemas achados. */
function plan(entries: yauzl.Entry[], limits: ZipLimits): { items: Item[]; rootName: string; warnings: ZipIssue[] } {
  const problems: ZipIssue[] = [];
  const warnings: ZipIssue[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Map<string, string>();
  const warned = new Set<string>();
  const staged: { entry: yauzl.Entry; name: string; declared: number }[] = [];
  let declaredTotal = 0;

  for (const entry of entries) {
    let name: string;
    try {
      name = decoder.decode(entry.fileName as unknown as Buffer);
    } catch {
      problems.push(issue("ZIP_BAD_PATH", "(nome ilegível)", "O nome de um arquivo não é UTF-8 válido", "Renomeie sem acentos ou compacte com outro programa (ex.: o compactador do sistema)."));
      continue;
    }
    const isDir = name.endsWith("/");
    if (isJunk(name)) {
      // A pasta __MACOSX/ pode ter milhares de entradas: um aviso só por pasta.
      const key = name.startsWith("__MACOSX") ? "__MACOSX/" : name;
      if (!warned.has(key)) {
        warned.add(key);
        warnings.push(issue("ZIP_IGNORED_FILE", key, "Arquivo de sistema removido da extração", "Não precisa fazer nada; evite compactar pelo Finder sem limpar."));
      }
      continue;
    }
    if (isDir) {
      // Pastas não são extraídas (nascem com os arquivos), mas o nome precisa ser seguro como qualquer outro caminho.
      const why = pathProblem(name.slice(0, -1).normalize("NFC"));
      if (why) problems.push(issue("ZIP_BAD_PATH", name, `Caminho inválido: ${why}`, "Renomeie a pasta com letras, dígitos, hífen, sublinhado e ponto."));
      continue;
    }
    const nfc = name.normalize("NFC");
    const unixMode = entry.versionMadeBy >> 8 === 3 ? (entry.externalFileAttributes >>> 16) & 0o170000 : 0;
    if (unixMode === 0o120000) {
      problems.push(issue("ZIP_SYMLINK", nfc, "Link simbólico não é permitido", "Troque o link pelo arquivo real."));
      continue;
    }
    const why = pathProblem(nfc);
    if (why) {
      problems.push(issue("ZIP_BAD_PATH", nfc, `Caminho inválido: ${why}`, "Renomeie o arquivo com letras, dígitos, hífen, sublinhado e ponto."));
      continue;
    }
    const key = nfc.toLowerCase();
    if (seen.has(key)) {
      problems.push(issue("ZIP_DUPLICATE_ENTRY", nfc, `Repete o arquivo ${seen.get(key)} (NFC, sem distinguir maiúsculas)`, "Deixe só uma versão do arquivo."));
      continue;
    }
    seen.set(key, nfc);
    if (entry.isEncrypted()) {
      problems.push(issue("ZIP_UNREADABLE", nfc, "Arquivo cifrado com senha", "Gere o ZIP sem senha."));
      continue;
    }
    staged.push({ entry, name: nfc, declared: entry.uncompressedSize });
    declaredTotal += entry.uncompressedSize;
  }

  if (staged.length > limits.files) {
    problems.push(issue("ZIP_TOO_MANY_FILES", "", `${staged.length} arquivos passam do teto de ${limits.files}`, "Junte arquivos pequenos de conhecimento."));
  }
  if (declaredTotal > limits.expandedBytes) {
    problems.push(issue("ZIP_EXPANDS_TOO_MUCH", "", `O conteúdo extraído passaria de ${limits.expandedBytes} bytes`, "Reduza o tamanho dos arquivos."));
  }

  // Raiz única: toda entrada começa pela mesma pasta, e essa pasta tem o manifest.json.
  const roots = new Set(staged.map((s) => s.name.split("/")[0]!));
  const flat = staged.filter((s) => !s.name.includes("/"));
  const rootName = [...roots][0] ?? "";
  if (staged.length === 0 || roots.size !== 1 || flat.length > 0) {
    problems.push(issue("ZIP_BAD_ROOT", "", `O ZIP precisa ter exatamente 1 pasta raiz com o manifest.json (achei ${flat.length ? "arquivos soltos na raiz" : `${roots.size} raízes`})`, "Coloque tudo dentro de uma única pasta com o manifest.json."));
  } else if (!seen.has(`${rootName}/manifest.json`.toLowerCase())) {
    problems.push(issue("ZIP_BAD_ROOT", `${rootName}/manifest.json`, "Falta o manifest.json dentro da pasta raiz", "Coloque o manifest.json direto na pasta raiz do pacote."));
  }

  const items: Item[] = [];
  for (const s of staged) {
    const rel = s.name.slice(s.name.indexOf("/") + 1);
    if (!limits.allowedExtensions.includes(extOf(rel))) {
      problems.push(issue("FILE_TYPE_NOT_ALLOWED", rel, `Tipo de arquivo não permitido (${extOf(rel) || "sem extensão"})`, "Use só .json, .md e .txt (converta PDF e HTML para .md)."));
    }
    if (s.declared > limits.fileBytes) {
      problems.push(issue("FILE_TOO_LARGE", rel, `Arquivo de ${s.declared} bytes passa do teto de ${limits.fileBytes}`, "Divida o arquivo em partes menores."));
    }
    items.push({ entry: s.entry, rel, declared: s.declared });
  }
  if (problems.length) throw new ZipError(problems);
  return { items, rootName, warnings };
}

/** Motivo pelo qual o caminho do ZIP não serve (ou null): `..`, `\`, absoluto, controle, ponto inicial, caractere fora da lista. */
function pathProblem(p: string): string | null {
  const why = relativePathProblem(p, [""]);
  if (why) return why;
  if (!/^[\p{L}\p{N}._\-/ ]+$/u.test(p)) return "tem caractere fora de letras, dígitos, . _ - e espaço";
  const segs = p.split("/");
  if (segs.some((s) => s.startsWith("."))) return "nome começa com ponto";
  if (segs.some((s) => s.endsWith(" ") || s.endsWith("."))) return "nome termina em ponto ou espaço";
  return null;
}

async function extractItems(zf: yauzl.ZipFile, items: Item[], root: string, limits: ZipLimits): Promise<{ entries: PackageEntry[]; bytes: number }> {
  const out: PackageEntry[] = [];
  let total = 0;
  for (const it of items) {
    const dest = resolve(join(root, ...it.rel.split("/")));
    // Cinto de segurança: depois de resolvido, o destino tem que estar dentro da raiz (o nome já foi conferido).
    if (!dest.startsWith(root + sep)) throw new ZipError([issue("ZIP_BAD_PATH", it.rel, "Caminho sai da pasta do pacote", "Renomeie o arquivo.")]);
    await mkdir(dirname(dest), { recursive: true, mode: 0o750 });
    let size = 0;
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        total += chunk.length;
        if (total > limits.expandedBytes) return cb(new ZipError([issue("ZIP_EXPANDS_TOO_MUCH", it.rel, `O conteúdo extraído passou de ${limits.expandedBytes} bytes`, "Reduza o tamanho dos arquivos.")]));
        if (size > limits.fileBytes) return cb(new ZipError([issue("FILE_TOO_LARGE", it.rel, `Arquivo passa de ${limits.fileBytes} bytes`, "Divida o arquivo em partes menores.")]));
        try {
          utf8.decode(chunk, { stream: true });
        } catch {
          return cb(new ZipError([issue("FILE_NOT_UTF8", it.rel, "O arquivo não é UTF-8 válido", "Salve o arquivo como UTF-8.")]));
        }
        cb(null, chunk);
      },
      flush(cb) {
        try {
          utf8.decode();
        } catch {
          return cb(new ZipError([issue("FILE_NOT_UTF8", it.rel, "O arquivo não é UTF-8 válido", "Salve o arquivo como UTF-8.")]));
        }
        cb();
      },
    });
    try {
      const src = await openEntry(zf, it.entry);
      await pipeline(src, counter, createWriteStream(dest, { flags: "wx", mode: 0o640 }));
    } catch (e) {
      if (e instanceof ZipError) throw e;
      throw new ZipError([issue("ZIP_UNREADABLE", it.rel, `Não consegui extrair o arquivo: ${(e as Error).message}`, "Gere o ZIP de novo.")]);
    }
    if (size !== it.declared) {
      // O cabeçalho mentiu sobre o tamanho: ZIP adulterado ou corrompido.
      throw new ZipError([issue(size > it.declared ? "ZIP_EXPANDS_TOO_MUCH" : "ZIP_UNREADABLE", it.rel, `O tamanho real (${size}) não bate com o declarado (${it.declared})`, "Gere o ZIP de novo.")]);
    }
    out.push({ path: it.rel, size });
  }
  return { entries: out, bytes: total };
}

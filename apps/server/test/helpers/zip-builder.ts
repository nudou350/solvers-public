import { crc32, deflateRawSync } from "node:zlib";

// Monta ZIPs à mão nos testes (inclusive malformados: nomes perigosos, tamanho declarado mentiroso, links simbólicos).

export type ZipSpec = {
  name: string;
  data?: Buffer | string;
  /** 0 = sem compressão, 8 = deflate (padrão). */
  method?: 0 | 8;
  /** Tamanho "descompactado" escrito nos cabeçalhos (padrão: o real). Mentir simula uma bomba. */
  declaredSize?: number;
  /** Marca a entrada como link simbólico Unix (o conteúdo é o alvo). */
  symlink?: boolean;
  /** Nome em bytes crus (ignora `name`), para nomes que não são UTF-8. */
  rawName?: Buffer;
};

export function buildZip(specs: ZipSpec[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const s of specs) {
    const name = s.rawName ?? Buffer.from(s.name, "utf8");
    const raw = Buffer.isBuffer(s.data) ? s.data : Buffer.from(s.data ?? "", "utf8");
    const method = s.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const declared = s.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão mínima
    local.writeUInt16LE(0x0800, 6); // flag: nome em UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10); // data/hora
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // criado no Unix
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(declared, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    const mode = s.symlink ? 0o120777 : name.at(-1) === 0x2f ? 0o040755 : 0o100644;
    cd.writeUInt32LE((mode << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(specs.length, 8);
  end.writeUInt16LE(specs.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

/** Arquivos em memória (como o validador os recebe) viram um ZIP com pasta raiz única, como o criador o envia. */
export function zipOfFiles(files: Record<string, string | Uint8Array>, root = "fechamento-mei"): Buffer {
  return buildZip(Object.entries(files).map(([path, data]) => ({ name: `${root}/${path}`, data: Buffer.from(data) })));
}

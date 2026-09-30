// Relógio deslocável para o e2e-v2 (só teste): carregue com `--import` ao subir o servidor real.
//
//   E2E_CLOCK_OFFSET_FILE=/caminho/offset.txt tsx --env-file=... --import ./scripts/src/clock-shim.ts apps/server/src/index.ts
//
// O validador local só avança o relógio (warp) uma vez por ledger; depois disso o relógio da rede fica
// dias à frente do relógio da máquina. O e2e grava em E2E_CLOCK_OFFSET_FILE quantos segundos o servidor
// deve somar ao seu "agora" (Date.now / new Date()), para as regras de prazo do servidor (rota de
// cancelamento, canCancelUndelivered, job de disputa parada) enxergarem o mesmo tempo da rede.
// Sem a variável (ou sem o arquivo) não muda nada. Não altera o relógio do Postgres (now()).
import { readFileSync } from "node:fs";

const file = process.env.E2E_CLOCK_OFFSET_FILE;
if (file) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  let offsetMs = 0;
  let readAt = 0;
  const offset = () => {
    const t = realNow();
    if (t - readAt > 200) {
      readAt = t;
      try {
        offsetMs = Number(readFileSync(file, "utf8").trim()) * 1000 || 0;
      } catch {
        offsetMs = 0;
      }
    }
    return offsetMs;
  };
  class ShiftedDate extends RealDate {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.length === 0) super(realNow() + offset());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else super(...(args as [any]));
    }
    static override now() {
      return realNow() + offset();
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
  console.log(`[clock-shim] relógio do servidor deslocável por ${file}`);
}

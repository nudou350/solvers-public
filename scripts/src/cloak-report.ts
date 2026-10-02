// Relatório do contador (CSV) a partir da "chave do contador" (chave de visualização do Cloak) e do endereço de destino.
// É o que o contador faz com a chave que o criador entrega: lê o histórico, não consegue gastar nada.
//
//   SOLANA_RPC_URL=<mainnet> CLOAK_NK=<hex da chave> CLOAK_DESTINATION=<endereço que recebeu> npx tsx src/cloak-report.ts > relatorio.csv
//
// CLOAK_EXPECT=<assinatura1,assinatura2> (opcional): transações que o criador já conhece; a leitura se repete (até 3 vezes) até
// todas aparecerem, porque o scanner pula em silêncio o que o RPC recusa por limite de requisições.
//
// Leva alguns minutos (lê ~2.300 transações do pool). O andamento sai no stderr, o CSV no stdout.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Defina ${n}`);
  return v;
};
// Importado por caminho em variável: o tsc deste pacote não tenta resolver os imports sem extensão do app web.
const web = (p: string) => import(pathToFileURL(resolve(import.meta.dirname, "../../apps/web/src/lib", p)).href) as Promise<any>;

async function main() {
  process.env.NEXT_PUBLIC_CLOAK_RPC_URL = need("SOLANA_RPC_URL");
  const nkHex = need("CLOAK_NK");
  if (!/^[0-9a-f]{64}$/i.test(nkHex)) throw new Error("CLOAK_NK deve ter 64 caracteres hexadecimais (a chave do contador).");
  const cloak = await web("cloak/withdraw.ts");
  const report = await cloak.buildReport({
    nk: cloak.viewingKeyFromHex(nkHex),
    destination: need("CLOAK_DESTINATION"),
    ...(process.env.CLOAK_EXPECT ? { expectSignatures: process.env.CLOAK_EXPECT.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
    onStatus: (t: string) => !t.startsWith("Scanned") && console.error("relatorio:", t),
  });
  console.error("resumo:", JSON.stringify(report.summary));
  if (report.missing.length) console.error("AVISO: nao apareceram:", report.missing.join(", "));
  process.stdout.write(report.csv);
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});

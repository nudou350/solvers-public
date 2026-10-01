import type { Instruction } from "@solana/kit";
import type { BuiltTx } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { assertSimulationOk } from "./simulation-gate.js";

/**
 * Monta a transação para o usuário assinar e a simula antes de devolvê-la: quem vai assinar não recebe uma
 * transação que o programa já recusaria (veja `assertSimulationOk` para os desfechos e o fail-open).
 *
 * Pré-checks que não se repetem aqui: saldo (`assertBalance`) e de preço (`assertFreshPrice`) e as regras do banco
 * rodam ANTES e dão respostas com dados (saldo, novo preço); a simulação pega o que sobra (estado on-chain
 * diferente do espelho, prazo, conta fechada) e a corrida entre o pré-check e a assinatura.
 *
 * Chame ANTES de gravar qualquer coisa no banco para a operação: uma simulação recusada não pode deixar
 * rascunho (escrow "pending" prende o limite do comprador por 10 min).
 */
export async function buildForUserChecked(instructions: Instruction[], meta: Record<string, unknown>): Promise<BuiltTx> {
  const c = chain();
  const built = await c.buildForUser(instructions, meta);
  assertSimulationOk(await c.simulate(built.transaction), String(meta.kind ?? "tx"));
  return built;
}

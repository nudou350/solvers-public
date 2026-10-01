// Operações de admin do programa (governança v2): rotação de admin em 2 etapas, tesouraria e reposição de stake.
//
//   pnpm --filter @solvers/server cli:admin propose <novo-admin>        dry-run (padrão): só LÊ da rede e simula
//   pnpm --filter @solvers/server cli:admin accept --keypair <arq>      assinado pela chave do NOVO admin
//   pnpm --filter @solvers/server cli:admin cancel
//   pnpm --filter @solvers/server cli:admin set-treasury <conta-usdc>
//   pnpm --filter @solvers/server cli:admin top-up-stake <slug> <usdc>  assinado pela chave do CRIADOR
//   ... acrescente --yes para ENVIAR (sem --yes nada é enviado)
//
// Dry-run: imprime o que faria (contas, quem assina, saldo do fee payer e taxa estimada) e simula a transação
// (leitura no RPC). O fee payer da plataforma (FEE_PAYER_KEYPAIR) paga taxas e o rent da proposta de admin.
// Nunca imprime chaves privadas: só endereços e caminhos de arquivo. Use `.env.devnet` com `cli:admin:devnet`.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createNoopSigner, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { friendlyError, KeyError, loadSigner, TxError, type SolversChain } from "@solvers/chain";
import * as gen from "@solvers/client";
import { authorities, chain, explorerUrl, initChain } from "../chain/index.js";
import { env } from "../env.js";
import { packages } from "../runtime/packages.js";
import { assertNetwork, NetworkError } from "./admin-guard.js";
import { parseAdminArgs, UsageError, USAGE, type AdminArgs } from "./admin-args.js";

const BASE_FEE_LAMPORTS = 5000n; // por assinatura
const COMPUTE_UNITS = 400_000n; // mesmo limite que o chain.ts usa em toda transação
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PENDING_ADMIN_SIZE = 8n + 32n + 32n + 1n; // discriminador + new_admin + rent_payer + bump
const CREATOR_KEYS_DIR = process.env.CREATOR_KEYS_DIR ?? join(process.cwd(), ".keys", "creators");

class OpError extends Error {}

const sol = (lamports: bigint) => `${(Number(lamports) / 1e9).toFixed(6)} SOL`;
const usdc = (units: bigint) => `${(Number(units) / 1e6).toFixed(6)} USDC`;

/** Quem precisa assinar e a chave que temos aqui (null = não está neste computador). */
type SignerPlan = { role: string; expected: Address; key: TransactionSigner | null; howTo: string };

type Plan = {
  title: string;
  signer: SignerPlan;
  notes: string[];
  /** Depósito de rent que o fee payer paga (e que volta ao fechar a conta). */
  rentLamports?: bigint;
  build: (signer: TransactionSigner) => Promise<Instruction[]>;
};

/** Lê um arquivo de chave. Qualquer falha vira mensagem fixa com o caminho: nunca um trecho do conteúdo. */
async function keyFromFile(file: string): Promise<TransactionSigner> {
  if (!existsSync(file)) throw new OpError(`arquivo de chave não encontrado: ${file}`);
  try {
    return await loadSigner(file);
  } catch {
    throw new OpError(`arquivo de chave inválido: ${file}`);
  }
}

async function planFor(c: SolversChain, args: AdminArgs): Promise<Plan> {
  const cmd = args.command;
  const config = await c.fetchConfig();
  const override = args.keypair ? await keyFromFile(args.keypair) : null;
  const adminKey = override ?? authorities().admin;
  const adminSigner = (): SignerPlan => ({
    role: "admin atual",
    expected: config.data.admin,
    key: adminKey,
    howTo: `rode na máquina que tem a chave do admin (${config.data.admin}) com --keypair <arquivo>, ou defina ADMIN_KEYPAIR no .env`,
  });

  switch (cmd.cmd) {
    case "propose": {
      if (cmd.newAdmin === config.data.admin) throw new OpError("o novo admin é o próprio admin atual: nada a trocar");
      const pending = await c.fetchMaybePendingAdmin();
      if (pending.exists) {
        throw new OpError(`já existe uma proposta pendente para ${pending.data.newAdmin}: use "cancel" antes de propor de novo`);
      }
      return {
        title: `Propor ${cmd.newAdmin} como novo admin (passo 1 de 2)`,
        signer: adminSigner(),
        notes: [
          `A troca só vale quando ${cmd.newAdmin} rodar "accept" com a chave dele. Confira o endereço: se estiver errado, use "cancel".`,
          "Enquanto não aceitar, o admin atual continua valendo.",
        ],
        rentLamports: await c.rpc.getMinimumBalanceForRentExemption(PENDING_ADMIN_SIZE).send(),
        build: async (s) => [await c.proposeAdminIx(s, cmd.newAdmin)],
      };
    }
    case "accept": {
      const pending = await c.fetchMaybePendingAdmin();
      if (!pending.exists) throw new OpError("não há proposta de troca de admin pendente");
      const p = pending.data;
      return {
        title: `Aceitar a administração (passo 2 de 2): ${config.data.admin} -> ${p.newAdmin}`,
        signer: {
          role: "novo admin",
          expected: p.newAdmin,
          key: override,
          howTo: `a chave de ${p.newAdmin} precisa estar neste computador: rode com --keypair <arquivo da chave do novo admin>`,
        },
        notes: [
          "Depois disto a chave antiga deixa de ser admin; o servidor passa a precisar da nova em ADMIN_KEYPAIR (se usar admin no servidor).",
          `O rent da proposta volta para ${p.rentPayer}.`,
        ],
        build: async (s) => [await c.acceptAdminIx(s, p.rentPayer)],
      };
    }
    case "cancel": {
      const pending = await c.fetchMaybePendingAdmin();
      if (!pending.exists) throw new OpError("não há proposta de troca de admin pendente");
      const p = pending.data;
      return {
        title: `Cancelar a proposta de admin para ${p.newAdmin}`,
        signer: adminSigner(),
        notes: [`O rent da proposta volta para ${p.rentPayer}.`],
        build: async (s) => [await c.cancelAdminTransferIx(s, p.rentPayer)],
      };
    }
    case "set-treasury": {
      const { value } = await c.rpc.getAccountInfo(cmd.treasury, { encoding: "jsonParsed" }).send();
      if (!value) throw new OpError(`a conta ${cmd.treasury} não existe na rede`);
      const parsed = value.data as { parsed?: { type?: string; info?: { mint?: string; owner?: string; state?: string } } };
      const info = parsed.parsed?.info;
      if (value.owner !== TOKEN_PROGRAM || parsed.parsed?.type !== "account" || !info) {
        throw new OpError(`${cmd.treasury} não é uma conta de token (informe a conta de USDC, não a carteira)`);
      }
      if (info.mint !== config.data.usdcMint) {
        throw new OpError(`a conta é de outro token (${info.mint}); a tesouraria precisa ser do USDC ${config.data.usdcMint}`);
      }
      if (info.state === "frozen") throw new OpError("a conta de USDC está congelada");
      return {
        title: `Trocar a tesouraria: ${config.data.treasury} -> ${cmd.treasury}`,
        signer: adminSigner(),
        notes: [`Dona da nova conta: ${info.owner}. As taxas das próximas operações passam a cair nela.`],
        build: async (s) => [await c.setTreasuryIx(s, cmd.treasury)],
      };
    }
    case "top-up-stake": {
      const pkg = packages().get(cmd.slug);
      if (!pkg) throw new OpError(`solver "${cmd.slug}" não encontrado em ${env.AGENTS_DIR}`);
      const agent = await c.fetchMaybeAgent(pkg.manifest.id);
      if (!agent.exists) throw new OpError(`o solver "${cmd.slug}" não está registrado na rede`);
      const creator = agent.data.creator;
      const keyFile = join(CREATOR_KEYS_DIR, `${pkg.manifest.creator.id}.json`);
      const key = override ?? (existsSync(keyFile) ? await keyFromFile(keyFile) : null);
      const balance = await c.usdcBalance(creator);
      if (balance < cmd.amount) throw new OpError(`o criador tem só ${usdc(balance)}; faltam ${usdc(cmd.amount - balance)}`);
      return {
        title: `Repor ${usdc(cmd.amount)} de stake do solver ${cmd.slug}`,
        signer: {
          role: "criador do solver",
          expected: creator,
          key,
          howTo: `a chave do criador (${creator}) não está neste computador (esperada em ${keyFile}). Rode na máquina que a tem, com --keypair <arquivo>`,
        },
        notes: [
          `Stake atual: ${usdc(agent.data.stake)} -> depois: ${usdc(agent.data.stake + cmd.amount)}. Status: ${gen.AgentStatus[agent.data.status]}.`,
          `Saldo de USDC do criador: ${usdc(balance)}.`,
          "Repor stake NÃO reativa o solver: se estava suspenso, o admin ainda precisa aprovar (approve_agent).",
        ],
        build: async (s) => [await c.topUpStakeIx(s, pkg.manifest.id, cmd.amount)],
      };
    }
  }
}

async function main() {
  const args = parseAdminArgs(process.argv.slice(2));
  await initChain();
  const c = chain();
  // Barreira de rede (como o upgrade-devnet.sh): o RPC do .env pode ser de outra rede. Vale também no dry-run.
  const net = assertNetwork(await c.rpc.getGenesisHash().send(), args.allowNetwork);
  if (net.warning) console.warn(net.warning);
  const plan = await planFor(c, args);
  if (plan.signer.key && plan.signer.key.address !== plan.signer.expected) {
    throw new OpError(`a chave informada é de ${plan.signer.key.address}, mas esta operação precisa da assinatura de ${plan.signer.expected} (${plan.signer.role})`);
  }
  const signer = plan.signer.key ?? createNoopSigner(plan.signer.expected);
  const ixs = await plan.build(signer);

  const feePayer = c.feePayer.address;
  const accounts = ixs.flatMap((ix) => (ix.accounts ?? []) as readonly { address: string }[]);
  const nSigners = new Set<string>([feePayer, plan.signer.expected]).size;
  const fee = BASE_FEE_LAMPORTS * BigInt(nSigners) + (env.PRIORITY_FEE_MICROLAMPORTS * COMPUTE_UNITS) / 1_000_000n;
  const balance = await c.solBalance(feePayer);

  console.log(`== ${plan.title} ==`);
  console.log(`Modo ............ ${args.yes ? "EXECUÇÃO (--yes)" : "DRY-RUN (nada será enviado)"}  | rede: ${net.network} (SOLANA_CLUSTER=${env.SOLANA_CLUSTER})`);
  console.log(`Programa ........ ${c.programId}`);
  console.log(`Assina .......... ${plan.signer.role} ${plan.signer.expected}  [${plan.signer.key ? "chave disponível" : "chave NÃO disponível aqui"}]`);
  console.log(`Fee payer ....... ${feePayer}  saldo ${sol(balance)}  (paga a taxa)`);
  console.log(`Taxa estimada ... ~${sol(fee)}${plan.rentLamports ? ` + depósito de ${sol(plan.rentLamports)} da proposta (volta ao fechá-la)` : ""}`);
  console.log("Contas da instrução:");
  for (const a of accounts) console.log(`  ${a.address}`);
  for (const n of plan.notes) console.log(`Obs: ${n}`);
  if (balance < fee + (plan.rentLamports ?? 0n)) console.log("AVISO: o saldo do fee payer não cobre a taxa estimada.");

  const built = await c.buildForUser(ixs);
  const sim = await c.simulate(built.transaction);
  console.log(
    `Simulação ....... ${sim.ok ? `ok${sim.unitsConsumed != null ? ` (${sim.unitsConsumed} CU)` : ""}` : `${sim.kind === "infra" ? "indisponível" : "RECUSADA"}: ${sim.message}`}`,
  );

  if (!args.yes) {
    console.log("\nDry-run concluído, nada foi enviado. Para executar, repita o comando com --yes.");
    if (!plan.signer.key) console.log(`Atenção: ${plan.signer.howTo}.`);
    return;
  }
  if (!plan.signer.key) throw new OpError(`falta a assinatura de ${plan.signer.role}: ${plan.signer.howTo}`);
  if (!sim.ok && sim.kind !== "infra") throw new OpError(`a simulação recusou a operação: ${sim.message}`);
  const { signature, events } = await c.sendAsServer(ixs);
  console.log(`\nEnviado e confirmado: ${signature}`);
  console.log(`  ${explorerUrl("tx", signature)}`);
  console.log(`  eventos: ${events.map((e) => e.name).join(", ") || "(nenhum)"}`);
  console.log("Os eventos entram no banco pelo indexador (ou: cli:reindex --recent).");
}

if (/cli\/admin\.(ts|js)$/.test(process.argv[1]?.replace(/\\/g, "/") ?? "")) {
  try {
    await main();
    process.exit(0);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n\n${USAGE}`);
      process.exit(2);
    }
    if (e instanceof NetworkError) {
      console.error(`Falhou: ${e.message}`);
      process.exit(1);
    }
    const msg = e instanceof KeyError ? `chave inválida: ${e.message}` : e instanceof TxError ? friendlyError(e, e.logs) : e instanceof OpError ? e.message : ((e as Error)?.message ?? String(e));
    console.error(`Falhou: ${msg}`);
    process.exit(1);
  }
}

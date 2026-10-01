// Operações de admin do programa (governança v2): rotação de admin em 2 etapas, tesouraria, reposição de stake,
// migração da Config v1 -> v2, pausa de emergência e guardian.
//
//   pnpm --filter @solvers/server cli:admin propose <novo-admin>        dry-run (padrão): só LÊ da rede e simula
//   pnpm --filter @solvers/server cli:admin accept --keypair <arq>      assinado pela chave do NOVO admin
//   pnpm --filter @solvers/server cli:admin cancel
//   pnpm --filter @solvers/server cli:admin set-treasury <conta-usdc>
//   pnpm --filter @solvers/server cli:admin top-up-stake <slug> <usdc>  assinado pela chave do CRIADOR
//   pnpm --filter @solvers/server cli:admin migrate-config --keypair <upgrade-authority.json>   Config 187 -> 285 bytes
//   pnpm --filter @solvers/server cli:admin set-pause <none|entradas|pagamentos|tudo>             admin liga/desliga; guardian só liga
//   pnpm --filter @solvers/server cli:admin set-guardian <endereço|none>
//   pnpm --filter @solvers/server cli:admin propose-slash <slug> <usdc> <motivo>   confisco: propor -> 72 h -> execute-slash
//   pnpm --filter @solvers/server cli:admin execute-slash <slug> | cancel-slash <slug>
//   pnpm --filter @solvers/server cli:admin extend-stake-exit <slug> <motivo>      +30 dias na saída de stake (máx. 2 vezes)
//   ... acrescente --yes para ENVIAR (sem --yes nada é enviado)
//
// Dry-run: imprime o que faria (contas, quem assina, saldo do fee payer e taxa estimada) e simula a transação
// (leitura no RPC). O fee payer da plataforma (FEE_PAYER_KEYPAIR) paga taxas e o rent da proposta de admin.
// Nunca imprime chaves privadas: só endereços e caminhos de arquivo. Use `.env.devnet` com `cli:admin:devnet`.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createNoopSigner, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { CONFIG_V2_SIZE, describePauseFlags, friendlyError, KeyError, loadSigner, parseProgramDataAuthority, TxError, type SolversChain } from "@solvers/chain";
import * as gen from "@solvers/client";
import { authorities, chain, explorerUrl, initChain } from "../chain/index.js";
import { env } from "../env.js";
import { packages } from "../runtime/packages.js";
import { assertNetwork, decidePauseSigner, MAX_STAKE_EXIT_EXTENSIONS, NetworkError, slashWait, STAKE_EXIT_EXTENSION_SECS } from "./admin-guard.js";
import { NO_GUARDIAN, parseAdminArgs, reasonHashOf, UsageError, USAGE, type AdminArgs } from "./admin-args.js";

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
  /** Rent que o fee payer paga (a proposta de admin devolve ao fechar; a migração da Config não). */
  rentLamports?: bigint;
  rentNote?: string;
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

/** migrate-config: lê a Config SEM decodificar (ela é v1 e o cliente v2 falharia) e a upgrade authority no ProgramData. */
async function planMigrateConfig(c: SolversChain, override: TransactionSigner | null): Promise<Plan> {
  const state = await c.fetchConfigState();
  if (state.kind === "v2") throw new OpError(`a Config já está no layout v2 (${CONFIG_V2_SIZE} bytes, layout_version ${state.config.layoutVersion}): nada a migrar`);
  if (state.kind === "missing") throw new OpError("a Config não existe: o programa ainda não passou por initialize_config (na mainnet ela já nasce v2)");
  if (state.kind === "unknown") throw new OpError(`a conta Config tem um tamanho inesperado (${state.size} bytes): só o layout v1 (187) migra. Confira o endereço do programa e o RPC`);
  const programData = await c.programDataAddress();
  const { value } = await c.rpc.getAccountInfo(programData, { encoding: "base64" }).send();
  const parsed = value ? parseProgramDataAuthority(Uint8Array.from(Buffer.from(value.data[0], "base64"))) : null;
  if (!parsed) throw new OpError(`não consegui ler a upgrade authority em ${programData} (o programa existe nesta rede?)`);
  if (!parsed.authority) throw new OpError("o programa é imutável (sem upgrade authority): não há quem possa migrar a Config");
  const authority = parsed.authority;
  // A chave só serve se for exatamente a upgrade authority: ADMIN_KEYPAIR entra como padrão só quando coincide (devnet).
  const envAdmin = authorities().admin;
  const key = override ?? (envAdmin && envAdmin.address === authority ? envAdmin : null);
  const configAddr = await c.configPda();
  const [need, have] = await Promise.all([c.rpc.getMinimumBalanceForRentExemption(BigInt(CONFIG_V2_SIZE)).send(), c.solBalance(configAddr)]);
  return {
    title: `Migrar a Config v1 (187 bytes) para a v2 (${CONFIG_V2_SIZE} bytes)`,
    signer: {
      role: "upgrade authority",
      expected: authority,
      key,
      howTo: `a chave da upgrade authority (${authority}) precisa estar neste computador: rode com --keypair <arquivo> (na devnet é a chave do admin)`,
    },
    notes: [
      "Enquanto a Config for v1, TODA instrução do programa que lê a Config (compra, garantia, pagamentos, config) falha, e o servidor novo não decodifica a Config. Rode logo depois do upgrade do programa e antes do push do servidor.",
      "Os 187 bytes atuais não mudam; o resize acrescenta os campos novos zerados (sem pausa, sem guardian) e grava layout_version = 2.",
      `Depois, confira: a conta ${configAddr} deve passar a ter ${CONFIG_V2_SIZE} bytes (getAccountInfo, ou "solana account ${configAddr} --url devnet").`,
    ],
    rentLamports: need > have ? need - have : 0n,
    rentNote: "de rent adicional da Config, pago pelo fee payer (fica na conta Config)",
    build: async (s) => [await c.migrateConfigIx(s)],
  };
}

const iso = (secs: bigint | number) => new Date(Number(secs) * 1000).toISOString();
const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("hex");

/** Solver pelo slug do pacote: id on-chain e conta do agente (precisa estar registrado). */
async function agentBySlug(c: SolversChain, slug: string) {
  const pkg = packages().get(slug);
  if (!pkg) throw new OpError(`solver "${slug}" não encontrado em ${env.AGENTS_DIR}`);
  const agent = await c.fetchMaybeAgent(pkg.manifest.id);
  if (!agent.exists) throw new OpError(`o solver "${slug}" não está registrado na rede`);
  return { id: pkg.manifest.id, agent: agent.data };
}

async function planFor(c: SolversChain, args: AdminArgs): Promise<Plan> {
  const cmd = args.command;
  const override = args.keypair ? await keyFromFile(args.keypair) : null;
  // A Config v1 não decodifica: a migração lê a conta crua e não pode passar por fetchConfig.
  if (cmd.cmd === "migrate-config") return planMigrateConfig(c, override);
  const config = await c.fetchConfig(); // Config v1: lança ConfigNotMigratedError (rode migrate-config primeiro)
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
    case "set-pause": {
      const current = config.data.pauseFlags;
      const guardian = config.data.guardian === NO_GUARDIAN ? null : config.data.guardian;
      const k = override ?? authorities().admin;
      const { role, unpausing } = decidePauseSigner({ current, next: cmd.flags, admin: config.data.admin, guardian, keyAddress: k?.address ?? null });
      const isGuardian = role === "guardian";
      return {
        title: `Pausa de emergência: ${describePauseFlags(current)} -> ${describePauseFlags(cmd.flags)}`,
        signer: isGuardian
          ? { role: "guardian", expected: k!.address, key: k, howTo: "use --keypair <chave do guardian>" }
          : {
              role: "admin atual",
              expected: config.data.admin,
              key: k,
              howTo: `rode na máquina que tem a chave do admin (${config.data.admin}) com --keypair <arquivo>, ou defina ADMIN_KEYPAIR no .env`,
            },
        notes: [
          "Entradas (bit 1): register_agent, purchase_license, buy_credits, create_escrow. Pagamentos (bit 2): release_milestone, mark_passed, resolve_dispute.",
          "Saídas do comprador (cancelar entrega, contestar, encerrar garantia) nunca pausam.",
          unpausing ? "Isto LIBERA operações: só o admin pode." : "Só o admin consegue desligar a pausa depois (o guardian só liga).",
        ],
        build: async (s) => [await c.setPauseIx(s, cmd.flags)],
      };
    }
    case "set-guardian": {
      const current = config.data.guardian === NO_GUARDIAN ? null : config.data.guardian;
      if ((cmd.guardian ?? null) === current) throw new OpError(`o guardian já é ${current ?? "nenhum"}: nada a trocar`);
      return {
        title: `Guardian da pausa: ${current ?? "nenhum"} -> ${cmd.guardian ?? "nenhum (removido)"}`,
        signer: adminSigner(),
        notes: [
          "O guardian só consegue LIGAR a pausa; desligar é do admin. Use um dispositivo separado do admin.",
          ...(cmd.guardian === config.data.admin ? ["AVISO: o guardian é o próprio admin: o guardian não acrescenta nada."] : []),
        ],
        build: async (s) => [await c.setGuardianIx(s, cmd.guardian ?? NO_GUARDIAN)],
      };
    }
    case "propose-slash": {
      const { id, agent } = await agentBySlug(c, cmd.slug);
      if ((await c.fetchMaybeSlashProposal(id)).exists) throw new OpError(`já existe uma proposta de confisco para "${cmd.slug}": use execute-slash (após 72 h) ou cancel-slash`);
      if (cmd.amount > agent.stake) throw new OpError(`o stake do solver é ${usdc(agent.stake)}; não dá para confiscar ${usdc(cmd.amount)}`);
      const hash = reasonHashOf(cmd.reason);
      return {
        title: `Propor confisco de ${usdc(cmd.amount)} do solver ${cmd.slug}`,
        signer: adminSigner(),
        notes: [
          `Motivo (texto): "${cmd.reason}". reason_hash = sha256 do motivo = ${hex(hash)} (guarde o texto: só o hash vai on-chain).`,
          `Stake atual: ${usdc(agent.stake)}. Status: ${gen.AgentStatus[agent.status]}. Se estiver Ativo, a proposta SUSPENDE o solver agora (fora da vitrine e sem compra).`,
          "O confisco só pode ser executado 72 h depois (execute-slash). Até lá o criador pode contestar (só evidência) e o admin pode cancelar (cancel-slash).",
          "Com proposta pendente o criador não consegue sacar o stake (SlashPending). O dinheiro vai para a tesouraria.",
        ],
        rentLamports: await c.rpc.getMinimumBalanceForRentExemption(BigInt(gen.getSlashProposalSize())).send(),
        rentNote: "de depósito da proposta (volta ao fechá-la, na execução ou no cancelamento)",
        build: async (s) => [await c.proposeSlashIx(s, id, cmd.amount, hash)],
      };
    }
    case "execute-slash": {
      const { id, agent } = await agentBySlug(c, cmd.slug);
      const p = await c.fetchMaybeSlashProposal(id);
      if (!p.exists) throw new OpError(`não há proposta de confisco para "${cmd.slug}"`);
      const wait = slashWait(p.data.proposedAt, Math.floor(Date.now() / 1000));
      if (wait.expired && args.yes) throw new OpError(`a proposta venceu (${wait.text}; limite ${iso(wait.expiresAt)}): o programa recusa a execução (SlashExpired). Use cancel-slash e, se for o caso, proponha de novo`);
      if (wait.remainingSecs > 0 && args.yes) throw new OpError(`cedo demais: ${wait.text} (executável a partir de ${iso(wait.executableAt)}). Repita depois`);
      return {
        title: `Executar o confisco de ${usdc(p.data.amount)} do solver ${cmd.slug}`,
        signer: adminSigner(),
        notes: [
          `Prazo: proposta em ${iso(p.data.proposedAt)}, executável de ${iso(wait.executableAt)} até ${iso(wait.expiresAt)} (72 h + 14 dias; depois disso só cancelar): ${wait.text}.`,
          `Motivo (reason_hash) = ${hex(p.data.reasonHash)}. ${p.data.contestedAt === 0n ? "Sem contestação do criador." : `CONTESTADO pelo criador em ${iso(p.data.contestedAt)} (evidência = ${hex(p.data.contestHash)}): confira antes de executar.`}`,
          `Stake atual: ${usdc(agent.stake)}. Vai à tesouraria ${config.data.treasury} o menor entre o valor proposto e o saldo do cofre. O rent da proposta volta a ${p.data.rentPayer}.`,
          "O solver fica suspenso (ou aposentado, se já pediu saída): reativar exige approve_agent e stake >= o mínimo (top-up-stake).",
        ],
        build: async (s) => [await c.executeSlashIx(s, id, config.data.treasury, p.data.rentPayer)],
      };
    }
    case "cancel-slash": {
      const { id } = await agentBySlug(c, cmd.slug);
      const p = await c.fetchMaybeSlashProposal(id);
      if (!p.exists) throw new OpError(`não há proposta de confisco para "${cmd.slug}"`);
      return {
        title: `Cancelar a proposta de confisco de ${usdc(p.data.amount)} do solver ${cmd.slug}`,
        signer: adminSigner(),
        notes: [
          "O solver continua suspenso: reativar exige approve_agent.",
          `O rent da proposta volta para ${p.data.rentPayer}.`,
          "O admin cancela quando quiser. Depois de 72 h + 14 dias o criador também pode cancelar (pelo site), então proposta esquecida não trava o saque para sempre.",
        ],
        build: async (s) => [await c.cancelSlashIx(s, id, p.data.rentPayer)],
      };
    }
    case "extend-stake-exit": {
      const { id, agent } = await agentBySlug(c, cmd.slug);
      const x = await c.fetchMaybeStakeExit(id);
      if (!x.exists) throw new OpError(`o solver "${cmd.slug}" não pediu saída de stake (status ${gen.AgentStatus[agent.status]})`);
      if (x.data.extensions >= MAX_STAKE_EXIT_EXTENSIONS) throw new OpError(`a espera já foi estendida ${x.data.extensions} vezes, o máximo (${MAX_STAKE_EXIT_EXTENSIONS})`);
      const hash = reasonHashOf(cmd.reason);
      return {
        title: `Estender em 30 dias a saída de stake do solver ${cmd.slug} (${x.data.extensions + 1} de ${MAX_STAKE_EXIT_EXTENSIONS})`,
        signer: adminSigner(),
        notes: [
          `Saque liberado hoje a partir de ${iso(x.data.exitAt)}; depois da extensão, a partir de ${iso(Number(x.data.exitAt) + STAKE_EXIT_EXTENSION_SECS)}.`,
          `Motivo (texto): "${cmd.reason}". reason_hash = sha256 do motivo = ${hex(hash)}.`,
          "Use para dar tempo de apurar uma disputa ou propor confisco; não substitui o confisco (a proposta pendente já trava o saque).",
        ],
        build: async (s) => [await c.extendStakeExitIx(s, id, hash)],
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
  console.log(`Taxa estimada ... ~${sol(fee)}${plan.rentLamports ? ` + ${sol(plan.rentLamports)} ${plan.rentNote ?? "de depósito da proposta (volta ao fechá-la)"}` : ""}`);
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

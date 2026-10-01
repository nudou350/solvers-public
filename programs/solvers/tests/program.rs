//! Testes do programa com LiteSVM (INSTRUCTIONS.md 4.7).
//! Requer `tests/fixtures/mpl_core.so` (dump da devnet) e o build em `target/deploy/solvers.so`.

use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, Space, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;

use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::solana_program::system_program;

use solvers::instructions::{ConfigParams, MilestoneInput, RegisterAgentArgs};
use solvers::state::*;

const USDC: u64 = 1_000_000;
const FEE_BPS: u16 = 1_000;
const MIN_PRICE: u64 = 5 * USDC;
const REVIEW_WINDOW: i64 = 3_600;

thread_local! {
    static KEYGEN: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Chaves determinísticas por teste (nome da thread + contador): o consumo de CU depende das chaves,
/// porque `find_program_address` gasta ~1.500 CU por bump descartado. Com chaves aleatórias o mesmo
/// teste mediria CU diferente a cada execução e o teto de CU seria instável.
fn next_seed() -> [u8; 32] {
    use std::hash::{Hash, Hasher};
    let name = std::thread::current().name().unwrap_or("").to_string();
    let n = KEYGEN.with(|c| {
        c.set(c.get() + 1);
        c.get()
    });
    let mut out = [0u8; 32];
    for (i, chunk) in out.chunks_mut(8).enumerate() {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (&name, n, i).hash(&mut h);
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    out
}

fn new_keypair() -> Keypair {
    Keypair::new_from_array(next_seed())
}

fn unique_key() -> Pubkey {
    Pubkey::new_from_array(next_seed())
}

/// Teto de CU por instrução do programa: maior consumo medido na suíte inteira (`CU_REPORT=1`)
/// arredondado para cima + 25%, em múltiplos de 500, nunca acima de 100.000. `send_logs` confere cada
/// transação bem-sucedida contra esta tabela (sem `CU_REPORT`), então uma regressão derruba o teste que
/// exercita a instrução. O consumo varia com as chaves (cada bump descartado em `find_program_address`
/// custa ~1.500 CU; `register_agent` foi de 43,8k a 61,8k), por isso as chaves dos testes são
/// determinísticas (`new_keypair`) e o teto parte do pior caso medido. Instrução nova sem linha aqui
/// também falha (`cu_ceilings_cover_every_instruction`). Para recalibrar:
/// `CU_REPORT=1 cargo test -p solvers --test program -- --nocapture` e leia as linhas `CU ...`.
const CU_CEILINGS: &[(&str, u64)] = &[
    ("InitializeConfig", 13_500),
    ("UpdateConfig", 5_500),
    ("ApproveAgent", 9_500),
    ("SuspendAgent", 9_500),
    ("ProposeAdmin", 11_500),
    ("AcceptAdmin", 9_000),
    ("CancelAdminTransfer", 8_000),
    ("SetTreasury", 7_000),
    ("MigrateConfig", 10_000),
    ("SetPause", 6_000),
    ("SetGuardian", 6_000),
    ("RequestStakeExit", 22_500),
    ("ExtendStakeExit", 11_500),
    ("CancelStakeExit", 11_000),
    ("WithdrawStake", 44_000),
    ("ProposeSlash", 24_000),
    ("ContestSlash", 9_000),
    ("CancelSlash", 12_000),
    ("ExecuteSlash", 26_500),
    ("RegisterAgent", 81_500),
    ("TopUpStake", 20_000),
    ("UpdateVersion", 8_000),
    ("UpdatePricing", 9_500),
    ("SetEval", 10_000),
    ("PurchaseLicense", 88_500),
    ("BuyCredits", 53_500),
    ("ConsumeCredit", 13_500),
    ("RecordUsageBatch", 10_000),
    ("SubmitReview", 29_000),
    ("SubmitReviewWithCredits", 20_500),
    ("CreateEscrow", 59_000),
    ("MarkPassed", 8_500),
    ("ReleaseMilestone", 29_000),
    ("OpenDispute", 9_500),
    ("ResolveDispute", 52_000),
    ("CancelUndelivered", 16_500),
    ("ResolveStaleDispute", 23_500),
    ("CloseEscrow", 20_500),
];

/// Nome da instrução do programa (primeiro "Program log: Instruction: X" da transação).
fn instruction_name(logs: &[String]) -> Option<&str> {
    logs.iter().find_map(|l| l.strip_prefix("Program log: Instruction: "))
}

fn assert_cu_ceiling(logs: &[String], consumed: u64) {
    let name = instruction_name(logs).expect("log de instrução ausente");
    let ceiling = CU_CEILINGS
        .iter()
        .find(|(n, _)| *n == name)
        .unwrap_or_else(|| panic!("instrução {name} sem teto em CU_CEILINGS"))
        .1;
    assert!(ceiling <= 100_000, "teto de {name} acima de 100.000 CU");
    assert!(consumed <= ceiling, "CU de {name} regrediu: consumiu {consumed}, teto {ceiling}");
}

struct Env {
    svm: LiteSVM,
    payer: Keypair,
    admin: Keypair,
    verifier: Keypair,
    usage: Keypair,
    mint: Pubkey,
    treasury: Pubkey,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &solvers::ID).0
}

fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}

fn agent_pda(id: &[u8; 16]) -> Pubkey {
    pda(&[AGENT_SEED, id])
}

fn rep_pda(wallet: &Pubkey) -> Pubkey {
    pda(&[REP_SEED, wallet.as_ref()])
}

fn program_data() -> Pubkey {
    Pubkey::find_program_address(&[solvers::ID.as_ref()], &bpf_loader_upgradeable::ID).0
}

impl Env {
    fn new() -> Self {
        Self::build(true)
    }

    fn build(init_config: bool) -> Self {
        let mut svm = LiteSVM::new();
        let root = env!("CARGO_MANIFEST_DIR");
        svm.add_program_from_file(solvers::ID, format!("{root}/../../target/deploy/solvers.so"))
            .expect("build o programa antes (anchor build)");
        svm.add_program_from_file(mpl_core::ID, format!("{root}/tests/fixtures/mpl_core.so"))
            .expect("fixture mpl_core.so ausente");

        let payer = new_keypair();
        let admin = new_keypair();
        let verifier = new_keypair();
        let usage = new_keypair();
        for k in [&payer, &admin, &verifier, &usage] {
            svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
        }
        let mint = unique_key();
        let mut env = Env { svm, payer, admin, verifier, usage, mint, treasury: Pubkey::default() };
        env.set_upgrade_authority(env.admin.pubkey());
        env.create_mint();
        let treasury_owner = unique_key();
        env.treasury = env.token_account(&treasury_owner, 0);
        if init_config {
            let admin = env.admin.insecure_clone();
            env.init_config(&admin, 0).unwrap();
        }
        env
    }

    /// O LiteSVM carrega o programa sem upgrade authority; aqui definimos o admin como autoridade.
    fn set_upgrade_authority(&mut self, authority: Pubkey) {
        let key = program_data();
        let mut acc = self.svm.get_account(&key).unwrap();
        // UpgradeableLoaderState::ProgramData = tag u32 (3) + slot u64 + Option<Pubkey>
        acc.data[12] = 1;
        acc.data[13..45].copy_from_slice(authority.as_ref());
        self.svm.set_account(key, acc).unwrap();
    }

    fn create_mint(&mut self) {
        let mut data = vec![0u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint {
            mint_authority: Some(self.admin.pubkey()).into(),
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.set_token_program_account(self.mint, data);
    }

    fn set_token_program_account(&mut self, key: Pubkey, data: Vec<u8>) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                key,
                solana_account::Account { lamports, data, owner: spl_token::ID, executable: false, rent_epoch: 0 },
            )
            .unwrap();
    }

    fn ata(&self, owner: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, &self.mint)
    }

    /// Cria a ATA de USDC do dono com saldo (escrita direta no estado).
    fn token_account(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let key = self.ata(owner);
        let mut data = vec![0u8; spl_token::state::Account::LEN];
        spl_token::state::Account {
            mint: self.mint,
            owner: *owner,
            amount,
            delegate: None.into(),
            state: spl_token::state::AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.set_token_program_account(key, data);
        key
    }

    fn balance(&self, token: &Pubkey) -> u64 {
        let acc = self.svm.get_account(token).unwrap();
        spl_token::state::Account::unpack(&acc.data).unwrap().amount
    }

    fn account<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).expect("conta inexistente");
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.send_logs(ix, signers).map(|_| ())
    }

    /// Como `send`, mas devolve os logs da transação (para conferir eventos).
    fn send_logs(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<Vec<String>, String> {
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend(signers.iter().copied().filter(|k| k.pubkey() != self.payer.pubkey()));
        let program_id = ix.program_id;
        let tx = Transaction::new_signed_with_payer(&[ix], Some(&self.payer.pubkey()), &all, self.svm.latest_blockhash());
        let res = self
            .svm
            .send_transaction(tx)
            .map(|m| {
                // CU_REPORT=1 imprime o consumo de cada transação (checklist de CU do review).
                if std::env::var_os("CU_REPORT").is_some() {
                    eprintln!("CU {} {}", m.compute_units_consumed, m.logs.iter().find(|l| l.contains("Instruction:")).map_or("", |l| l.as_str()));
                }
                // Com CU_REPORT=1 só mede (recalibrar a tabela); sem ela, confere os tetos.
                if program_id == solvers::ID && std::env::var_os("CU_REPORT").is_none() {
                    assert_cu_ceiling(&m.logs, m.compute_units_consumed);
                }
                m.logs
            })
            .map_err(|e| format!("{:?}", e.meta.logs));
        self.svm.expire_blockhash();
        res
    }

    fn params(&self, min_stake: u64) -> ConfigParams {
        ConfigParams {
            verifier: self.verifier.pubkey(),
            usage_authority: self.usage.pubkey(),
            fee_bps: FEE_BPS,
            min_stake,
            min_price: MIN_PRICE,
        }
    }

    fn init_config(&mut self, admin: &Keypair, min_stake: u64) -> Result<(), String> {
        let params = self.params(min_stake);
        self.init_config_with(admin, params)
    }

    fn init_config_with(&mut self, admin: &Keypair, params: ConfigParams) -> Result<(), String> {
        let ix = Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::InitializeConfig {
                admin: admin.pubkey(),
                config: config_pda(),
                program: solvers::ID,
                program_data: program_data(),
                usdc_mint: self.mint,
                treasury: self.treasury,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: solvers::instruction::InitializeConfig { args: params }.data(),
        };
        self.send(ix, &[admin])
    }

    fn update_min_stake(&mut self, min_stake: u64) {
        let params = self.params(min_stake);
        self.update_config_with(params).unwrap();
    }

    fn update_fee(&mut self, fee_bps: u16) -> Result<Vec<String>, String> {
        let params = ConfigParams { fee_bps, ..self.params(0) };
        self.update_config_with(params)
    }

    fn update_config_with(&mut self, params: ConfigParams) -> Result<Vec<String>, String> {
        let ix = Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::UpdateConfig { admin: self.admin.pubkey(), config: config_pda() }
                .to_account_metas(None),
            data: solvers::instruction::UpdateConfig { args: params }.data(),
        };
        let admin = self.admin.insecure_clone();
        self.send_logs(ix, &[&admin])
    }
}

fn b64_decode(s: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let (mut out, mut acc, mut bits) = (Vec::new(), 0u32, 0u32);
    for c in s.bytes().filter(|&c| c != b'=') {
        acc = (acc << 6) | ALPHABET.iter().position(|&a| a == c).expect("base64 inválido") as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

/// Eventos do tipo `T` emitidos nos logs ("Program data:" = discriminator + borsh).
fn events<T: Discriminator + AnchorDeserialize>(logs: &[String]) -> Vec<T> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .map(|d| b64_decode(d.trim()))
        .filter(|d| d.starts_with(T::DISCRIMINATOR))
        .map(|d| T::deserialize(&mut &d[T::DISCRIMINATOR.len()..]).unwrap())
        .collect()
}

struct TestAgent {
    key: Pubkey,
    creator: Keypair,
    creator_usdc: Pubkey,
    collection: Pubkey,
}

fn register(env: &mut Env, price: u64, price_per_use: u64) -> Result<TestAgent, String> {
    register_with(env, price, price_per_use, |_| {})
}

/// Como `register`, mas deixa o teste alterar os argumentos (strings longas, bps, agent_id repetido).
fn register_with(
    env: &mut Env,
    price: u64,
    price_per_use: u64,
    tweak: impl FnOnce(&mut RegisterAgentArgs),
) -> Result<TestAgent, String> {
    let creator = new_keypair();
    env.svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    let creator_usdc = env.token_account(&creator.pubkey(), 100 * USDC);
    let id: [u8; 16] = unique_key().to_bytes()[..16].try_into().unwrap();
    let mut args = RegisterAgentArgs {
        agent_id: id,
        name: "Front-end React".into(),
        metadata_uri: "https://example.com/meta.json".into(),
        version: "1.0.0".into(),
        version_hash: [7; 32],
        price,
        price_per_use,
        royalty_bps: 500,
    };
    tweak(&mut args);
    let key = agent_pda(&args.agent_id);
    let collection = new_keypair();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::RegisterAgent {
            payer: env.payer.pubkey(),
            creator: creator.pubkey(),
            config: config_pda(),
            agent: key,
            collection: collection.pubkey(),
            collection_authority: pda(&[COLLECTION_AUTHORITY_SEED]),
            creator_usdc,
            stake_vault: pda(&[STAKE_SEED, key.as_ref()]),
            usdc_mint: env.mint,
            mpl_core_program: mpl_core::ID,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::RegisterAgent { args }.data(),
    };
    env.send(ix, &[&creator, &collection])?;
    Ok(TestAgent { key, creator, creator_usdc, collection: collection.pubkey() })
}

fn approve(env: &mut Env, agent: &TestAgent) {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetAgentStatus { admin: env.admin.pubkey(), config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::ApproveAgent {}.data(),
    };
    let admin = env.admin.insecure_clone();
    env.send(ix, &[&admin]).unwrap();
}

fn purchase_at(env: &mut Env, agent: &TestAgent, buyer: &Keypair, expected_price: u64) -> Result<Pubkey, String> {
    let asset = new_keypair();
    let buyer_usdc = env.ata(&buyer.pubkey());
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::PurchaseLicense {
            payer: env.payer.pubkey(),
            buyer: buyer.pubkey(),
            config: config_pda(),
            agent: agent.key,
            collection: agent.collection,
            collection_authority: pda(&[COLLECTION_AUTHORITY_SEED]),
            asset: asset.pubkey(),
            buyer_usdc,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            reputation: rep_pda(&buyer.pubkey()),
            mpl_core_program: mpl_core::ID,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::PurchaseLicense { expected_price }.data(),
    };
    env.send(ix, &[buyer, &asset])?;
    Ok(asset.pubkey())
}

fn purchase(env: &mut Env, agent: &TestAgent, buyer: &Keypair) -> Result<Pubkey, String> {
    let price = env.account::<Agent>(&agent.key).price;
    purchase_at(env, agent, buyer, price)
}

fn review_with_license(env: &mut Env, agent: &TestAgent, author: &Keypair, asset: Pubkey, rating: u8) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SubmitReview {
            payer: env.payer.pubkey(),
            author: author.pubkey(),
            agent: agent.key,
            review: pda(&[REVIEW_SEED, agent.key.as_ref(), author.pubkey().as_ref()]),
            license_asset: asset,
            license_review: pda(&[LICENSE_REVIEW_SEED, asset.as_ref()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::SubmitReview { rating, content_hash: [1; 32] }.data(),
    };
    env.send(ix, &[author])
}

fn review_with_credits(env: &mut Env, agent: &TestAgent, author: &Keypair, rating: u8) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SubmitReviewWithCredits {
            payer: env.payer.pubkey(),
            author: author.pubkey(),
            agent: agent.key,
            review: pda(&[REVIEW_SEED, agent.key.as_ref(), author.pubkey().as_ref()]),
            credits: pda(&[CREDITS_SEED, agent.key.as_ref(), author.pubkey().as_ref()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::SubmitReviewWithCredits { rating, content_hash: [1; 32] }.data(),
    };
    env.send(ix, &[author])
}

/// Transfere a licença (asset Metaplex Core) para outra carteira, via TransferV1.
fn transfer_asset(env: &mut Env, asset: Pubkey, collection: Pubkey, from: &Keypair, to: Pubkey) {
    let ix = mpl_core::instructions::TransferV1Builder::new()
        .asset(asset)
        .collection(Some(collection))
        .payer(env.payer.pubkey())
        .authority(Some(from.pubkey()))
        .new_owner(to)
        .instruction();
    let ix = Instruction {
        program_id: ix.program_id,
        accounts: ix
            .accounts
            .into_iter()
            .map(|a| AccountMeta { pubkey: a.pubkey, is_signer: a.is_signer, is_writable: a.is_writable })
            .collect(),
        data: ix.data,
    };
    env.send(ix, &[from]).unwrap();
}

fn new_buyer(env: &mut Env, usdc: u64) -> (Keypair, Pubkey) {
    let buyer = new_keypair();
    let ata = env.token_account(&buyer.pubkey(), usdc);
    (buyer, ata)
}

#[test]
fn purchase_happy_path_splits_payment_and_mints_license() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 50 * USDC);

    let asset = purchase(&mut env, &agent, &buyer).unwrap();

    assert_eq!(env.balance(&buyer_usdc), 38 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 1_200_000);
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 10_800_000);

    let a: Agent = env.account(&agent.key);
    assert_eq!(a.total_sales, 1);
    let rep: UserReputation = env.account(&rep_pda(&buyer.pubkey()));
    assert_eq!(rep.purchases, 1);

    let data = env.svm.get_account(&asset).unwrap();
    assert_eq!(data.owner, mpl_core::ID);
    let base = mpl_core::accounts::BaseAssetV1::from_bytes(&data.data).unwrap();
    assert_eq!(base.owner, buyer.pubkey());
    assert_eq!(base.update_authority, mpl_core::types::UpdateAuthority::Collection(agent.collection));
    // O comprador não pagou SOL nenhum: a plataforma patrocinou taxa e rent.
    assert!(env.svm.get_account(&buyer.pubkey()).is_none_or(|a| a.lamports == 0));
}

#[test]
fn purchase_fails_if_price_changed_after_build() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 50 * USDC);
    let err = purchase_at(&mut env, &agent, &buyer, 10 * USDC).unwrap_err();
    assert!(err.contains("PriceChanged"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 50 * USDC);
}

#[test]
fn purchase_of_pending_agent_fails() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let (buyer, _) = new_buyer(&mut env, 50 * USDC);
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
}

#[test]
fn only_upgrade_authority_initializes_config() {
    let mut env = Env::build(false);
    let intruder = new_keypair();
    env.svm.airdrop(&intruder.pubkey(), 1_000_000_000).unwrap();
    let err = env.init_config(&intruder, 0).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let admin = env.admin.insecure_clone();
    env.init_config(&admin, 0).unwrap();
}

#[test]
fn register_below_min_price_fails_and_stake_is_locked() {
    let mut env = Env::new();
    let err = register(&mut env, 2 * USDC, 0).err().unwrap();
    assert!(err.contains("PriceTooLow"), "{err}");

    env.update_min_stake(10 * USDC);
    let agent = register(&mut env, 5 * USDC, 0).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 90 * USDC);
    assert_eq!(env.balance(&pda(&[STAKE_SEED, agent.key.as_ref()])), 10 * USDC);
    let a: Agent = env.account(&agent.key);
    assert_eq!(a.stake, 10 * USDC);
    assert_eq!(a.status, AgentStatus::Pending);
}

#[test]
fn review_requires_license_and_updates_rating() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 50 * USDC);
    let (stranger, _) = new_buyer(&mut env, 0);

    let err = review_with_credits(&mut env, &agent, &stranger, 5).unwrap_err();
    assert!(err.contains("AccountNotInitialized") || err.contains("NoLicense"), "{err}");

    let asset = purchase(&mut env, &agent, &buyer).unwrap();
    // Asset de outra pessoa não serve como prova.
    let err = review_with_license(&mut env, &agent, &stranger, asset, 5).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");

    review_with_license(&mut env, &agent, &buyer, asset, 4).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (4, 1));

    // Editar a avaliação substitui a nota anterior.
    review_with_license(&mut env, &agent, &buyer, asset, 2).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (2, 1));
}

#[test]
fn transferred_license_cannot_review_again() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 50 * USDC);
    let asset = purchase(&mut env, &agent, &buyer).unwrap();
    review_with_license(&mut env, &agent, &buyer, asset, 5).unwrap();

    let other = new_keypair();
    transfer_asset(&mut env, asset, agent.collection, &buyer, other.pubkey());
    let err = review_with_license(&mut env, &agent, &other, asset, 5).unwrap_err();
    assert!(err.contains("LicenseAlreadyReviewed"), "{err}");
    let a: Agent = env.account(&agent.key);
    assert_eq!(a.rating_count, 1);
}

fn buy_credits(env: &mut Env, agent: &TestAgent, buyer: &Keypair, amount: u32, max_total: u64) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::BuyCredits {
            payer: env.payer.pubkey(),
            buyer: buyer.pubkey(),
            config: config_pda(),
            agent: agent.key,
            credits: pda(&[CREDITS_SEED, agent.key.as_ref(), buyer.pubkey().as_ref()]),
            reputation: rep_pda(&buyer.pubkey()),
            buyer_usdc: env.ata(&buyer.pubkey()),
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::BuyCredits { amount, max_total }.data(),
    };
    env.send(ix, &[buyer])
}

#[test]
fn credits_buy_consume_and_review() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, USDC / 2).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 20 * USDC);
    let credits = pda(&[CREDITS_SEED, agent.key.as_ref(), buyer.pubkey().as_ref()]);

    // Pacote abaixo do mínimo (2 x 0,50 = 1 USDC) é recusado.
    let err = buy_credits(&mut env, &agent, &buyer, 2, 10 * USDC).unwrap_err();
    assert!(err.contains("PriceTooLow"), "{err}");
    // Teto menor que o total (preço mudou) é recusado.
    let err = buy_credits(&mut env, &agent, &buyer, 10, 4 * USDC).unwrap_err();
    assert!(err.contains("PriceChanged"), "{err}");

    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 15 * USDC);
    let rep: UserReputation = env.account(&rep_pda(&buyer.pubkey()));
    assert_eq!(rep.purchases, 1);

    let consume = |env: &mut Env| {
        let ix = Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::ConsumeCredit {
                usage_authority: env.usage.pubkey(),
                config: config_pda(),
                agent: agent.key,
                credits,
            }
            .to_account_metas(None),
            data: solvers::instruction::ConsumeCredit {}.data(),
        };
        let usage = env.usage.insecure_clone();
        env.send(ix, &[&usage])
    };
    for _ in 0..10 {
        consume(&mut env).unwrap();
    }
    let err = consume(&mut env).unwrap_err();
    assert!(err.contains("NoCredits"), "{err}");

    let a: Agent = env.account(&agent.key);
    assert_eq!(a.verified_uses, 10);
    // Quem comprou créditos pode avaliar mesmo depois de gastá-los.
    review_with_credits(&mut env, &agent, &buyer, 5).unwrap();
}

struct TestEscrow {
    key: Pubkey,
    vault: Pubkey,
}

fn create_escrow(env: &mut Env, agent: &TestAgent, buyer: &Keypair, amounts: &[u64]) -> Result<TestEscrow, String> {
    create_escrow_days(env, agent, buyer, amounts, 0)
}

fn create_escrow_days(
    env: &mut Env,
    agent: &TestAgent,
    buyer: &Keypair,
    amounts: &[u64],
    delivery_days: u16,
) -> Result<TestEscrow, String> {
    create_escrow_full(env, agent, buyer, 1, amounts, REVIEW_WINDOW, delivery_days)
}

/// Todos os parâmetros de `create_escrow` (nonce, janela de revisão, prazo de entrega).
fn create_escrow_full(
    env: &mut Env,
    agent: &TestAgent,
    buyer: &Keypair,
    nonce: u64,
    amounts: &[u64],
    review_window_secs: i64,
    delivery_days: u16,
) -> Result<TestEscrow, String> {
    let key = pda(&[ESCROW_SEED, buyer.pubkey().as_ref(), agent.key.as_ref(), &nonce.to_le_bytes()]);
    let vault = pda(&[ESCROW_VAULT_SEED, key.as_ref()]);
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CreateEscrow {
            payer: env.payer.pubkey(),
            buyer: buyer.pubkey(),
            config: config_pda(),
            agent: agent.key,
            escrow: key,
            vault,
            buyer_usdc: env.ata(&buyer.pubkey()),
            reputation: rep_pda(&buyer.pubkey()),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::CreateEscrow {
            nonce,
            milestones: amounts.iter().map(|&amount| MilestoneInput { amount, criteria_hash: [9; 32] }).collect(),
            review_window_secs,
            delivery_days,
        }
        .data(),
    };
    env.send(ix, &[buyer])?;
    Ok(TestEscrow { key, vault })
}

fn mark_passed(env: &mut Env, escrow: &TestEscrow, index: u8) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::MarkPassed { verifier: env.verifier.pubkey(), config: config_pda(), escrow: escrow.key }
            .to_account_metas(None),
        data: solvers::instruction::MarkPassed { index, deliverable_hash: [3; 32] }.data(),
    };
    let verifier = env.verifier.insecure_clone();
    env.send(ix, &[&verifier])
}

fn release(env: &mut Env, agent: &TestAgent, escrow: &TestEscrow, caller: &Keypair, index: u8) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ReleaseMilestone {
            caller: caller.pubkey(),
            config: config_pda(),
            agent: agent.key,
            escrow: escrow.key,
            vault: escrow.vault,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ReleaseMilestone { index }.data(),
    };
    env.send(ix, &[caller])
}

fn warp(env: &mut Env, secs: i64) {
    let mut clock: solana_clock::Clock = env.svm.get_sysvar();
    clock.unix_timestamp += secs;
    env.svm.set_sysvar(&clock);
}

fn close(env: &mut Env, escrow: &TestEscrow, buyer: &Pubkey, caller: &Keypair) -> Result<Vec<String>, String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CloseEscrow {
            caller: caller.pubkey(),
            rent_payer: env.payer.pubkey(),
            escrow: escrow.key,
            vault: escrow.vault,
            buyer_usdc: env.ata(buyer),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::CloseEscrow {}.data(),
    };
    env.send_logs(ix, &[caller])
}

#[test]
fn escrow_below_minimum_is_rejected() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 30 * USDC);
    let err = create_escrow(&mut env, &agent, &buyer, &[USDC]).err().unwrap();
    assert!(err.contains("PriceTooLow"), "{err}");
}

#[test]
fn escrow_auto_release_after_window() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();
    assert_eq!(env.balance(&escrow.vault), 20 * USDC);

    let keeper = new_keypair();
    // Antes de passar nos testes, terceiros não liberam.
    let err = release(&mut env, &agent, &escrow, &keeper, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    mark_passed(&mut env, &escrow, 0).unwrap();
    let err = release(&mut env, &agent, &escrow, &keeper, 0).unwrap_err();
    assert!(err.contains("AutoReleaseNotReached"), "{err}");

    warp(&mut env, REVIEW_WINDOW + 1);
    release(&mut env, &agent, &escrow, &keeper, 0).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), USDC);

    // O comprador aprova a segunda etapa direto.
    release(&mut env, &agent, &escrow, &buyer, 1).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Completed);
    assert_eq!(env.balance(&escrow.vault), 0);

    // Alguém manda 1 unidade de USDC para o cofre: o fechamento devolve ao comprador.
    let mut vault = env.svm.get_account(&escrow.vault).unwrap();
    let mut state = spl_token::state::Account::unpack(&vault.data).unwrap();
    state.amount = 1;
    state.pack_into_slice(&mut vault.data);
    env.svm.set_account(escrow.vault, vault).unwrap();

    // Só quem pagou o rent (a plataforma) fecha: terceiros e o próprio comprador são recusados.
    let err = close(&mut env, &escrow, &buyer.pubkey(), &keeper).unwrap_err();
    assert!(err.contains("NotRentPayer"), "{err}");
    let err = close(&mut env, &escrow, &buyer.pubkey(), &buyer).unwrap_err();
    assert!(err.contains("NotRentPayer"), "{err}");
    assert!(env.svm.get_account(&escrow.key).is_some_and(|a| a.lamports > 0));

    let before = env.svm.get_account(&env.payer.pubkey()).unwrap().lamports;
    let payer = env.payer.insecure_clone();
    let logs = close(&mut env, &escrow, &buyer.pubkey(), &payer).unwrap();
    let closed = events::<solvers::events::EscrowClosed>(&logs);
    assert_eq!(closed.len(), 1);
    assert_eq!((closed[0].escrow, closed[0].agent, closed[0].buyer), (escrow.key, agent.key, buyer.pubkey()));
    assert!(env.svm.get_account(&escrow.key).is_none_or(|a| a.lamports == 0));
    assert!(env.svm.get_account(&env.payer.pubkey()).unwrap().lamports > before);
    assert_eq!(env.balance(&buyer_usdc), 10 * USDC + 1);
}

fn dispute(env: &mut Env, escrow: &TestEscrow, buyer: &Keypair, index: u8) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::OpenDispute { buyer: buyer.pubkey(), escrow: escrow.key, reputation: rep_pda(&buyer.pubkey()) }
            .to_account_metas(None),
        data: solvers::instruction::OpenDispute { index, reason_hash: [5; 32] }.data(),
    };
    env.send(ix, &[buyer])
}

fn resolve(env: &mut Env, agent: &TestAgent, escrow: &TestEscrow, buyer: &Pubkey, index: u8, refund: bool) -> Result<(), String> {
    let admin = env.admin.insecure_clone();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ResolveDispute {
            admin: admin.pubkey(),
            config: config_pda(),
            agent: agent.key,
            escrow: escrow.key,
            vault: escrow.vault,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            buyer_usdc: env.ata(buyer),
            buyer_reputation: rep_pda(buyer),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ResolveDispute { index, refund }.data(),
    };
    env.send(ix, &[&admin])
}

#[test]
fn dispute_refund_and_reject() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();

    mark_passed(&mut env, &escrow, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Disputed);

    // Etapa contestada não pode ser liberada pelo caminho normal.
    let err = release(&mut env, &agent, &escrow, &buyer, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Só o admin resolve.
    let buyer_clone = buyer.insecure_clone();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ResolveDispute {
            admin: buyer_clone.pubkey(),
            config: config_pda(),
            agent: agent.key,
            escrow: escrow.key,
            vault: escrow.vault,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            buyer_usdc,
            buyer_reputation: rep_pda(&buyer.pubkey()),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ResolveDispute { index: 0, refund: true }.data(),
    };
    let err = env.send(ix, &[&buyer_clone]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");

    // Etapa 0: comprador tinha razão -> reembolso, criador perde a disputa.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, true).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    let a: Agent = env.account(&agent.key);
    assert_eq!(a.disputes_lost, 1);

    // Etapa 1: criador tinha razão -> paga, comprador perde a disputa.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 1, false).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 109 * USDC);
    let rep: UserReputation = env.account(&rep_pda(&buyer.pubkey()));
    assert_eq!((rep.disputes_opened, rep.disputes_lost), (2, 1));
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Completed);
}

#[test]
fn dispute_after_window_is_rejected_and_bad_buyer_is_blocked() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC]).unwrap();
    mark_passed(&mut env, &escrow, 0).unwrap();
    warp(&mut env, REVIEW_WINDOW + 1);
    let err = dispute(&mut env, &escrow, &buyer, 0).unwrap_err();
    assert!(err.contains("DisputeWindowClosed"), "{err}");

    // Comprador com 3 disputas perdidas não cria garantia.
    let rep_key = rep_pda(&buyer.pubkey());
    let mut acc = env.svm.get_account(&rep_key).unwrap();
    let mut rep: UserReputation = env.account(&rep_key);
    rep.disputes_lost = MAX_BUYER_DISPUTES_LOST;
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&rep, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(rep_key, acc).unwrap();

    let agent2 = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent2);
    let err = create_escrow(&mut env, &agent2, &buyer, &[5 * USDC]).err().unwrap();
    assert!(err.contains("BuyerNotEligible"), "{err}");
}

#[test]
fn only_verifier_marks_passed_and_only_admin_approves() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetAgentStatus { admin: agent.creator.pubkey(), config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::ApproveAgent {}.data(),
    };
    let creator = agent.creator.insecure_clone();
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");

    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC]).unwrap();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::MarkPassed { verifier: buyer.pubkey(), config: config_pda(), escrow: escrow.key }
            .to_account_metas(None),
        data: solvers::instruction::MarkPassed { index: 0, deliverable_hash: [3; 32] }.data(),
    };
    let err = env.send(ix, &[&buyer]).unwrap_err();
    assert!(err.contains("NotVerifier"), "{err}");
}

fn current_time(env: &Env) -> i64 {
    env.svm.get_sysvar::<solana_clock::Clock>().unix_timestamp
}

fn cancel_ix(env: &Env, escrow: &TestEscrow, signer: &Pubkey, destination: Pubkey, index: u8) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CancelUndelivered {
            buyer: *signer,
            escrow: escrow.key,
            vault: escrow.vault,
            buyer_usdc: destination,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::CancelUndelivered { index }.data(),
    }
}

fn cancel(env: &mut Env, escrow: &TestEscrow, buyer: &Keypair, index: u8) -> Result<Vec<String>, String> {
    let ix = cancel_ix(env, escrow, &buyer.pubkey(), env.ata(&buyer.pubkey()), index);
    env.send_logs(ix, &[buyer])
}

fn stale(env: &mut Env, escrow: &TestEscrow, caller: &Keypair, buyer: &Pubkey, index: u8) -> Result<Vec<String>, String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ResolveStaleDispute {
            caller: caller.pubkey(),
            escrow: escrow.key,
            vault: escrow.vault,
            buyer_usdc: env.ata(buyer),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ResolveStaleDispute { index }.data(),
    };
    env.send_logs(ix, &[caller])
}

#[test]
fn create_escrow_delivery_days_and_fee_snapshot() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let now = current_time(&env);

    // 0 = prazo padrão; o escrow guarda a taxa vigente e nenhuma etapa nasce contestada.
    let (b0, _) = new_buyer(&mut env, 30 * USDC);
    let e0 = create_escrow_days(&mut env, &agent, &b0, &[10 * USDC], 0).unwrap();
    let e: Escrow = env.account(&e0.key);
    assert_eq!(e.delivery_deadline, now + DEFAULT_DELIVERY_DAYS as i64 * 86_400);
    assert_eq!(e.fee_bps, FEE_BPS);
    assert_eq!(e.milestones[0].disputed_at, 0);

    let (b30, _) = new_buyer(&mut env, 30 * USDC);
    let e30 = create_escrow_days(&mut env, &agent, &b30, &[10 * USDC], 30).unwrap();
    let e: Escrow = env.account(&e30.key);
    assert_eq!(e.delivery_deadline, now + 30 * 86_400);

    let (b60, _) = new_buyer(&mut env, 30 * USDC);
    let e60 = create_escrow_days(&mut env, &agent, &b60, &[10 * USDC], MAX_DELIVERY_DAYS).unwrap();
    let e: Escrow = env.account(&e60.key);
    assert_eq!(e.delivery_deadline, now + MAX_DELIVERY_DAYS as i64 * 86_400);

    // Acima do máximo é recusado e nada é cobrado.
    let (b61, b61_usdc) = new_buyer(&mut env, 30 * USDC);
    let err = create_escrow_days(&mut env, &agent, &b61, &[10 * USDC], 61).err().unwrap();
    assert!(err.contains("InvalidDeliveryDays"), "{err}");
    assert_eq!(env.balance(&b61_usdc), 30 * USDC);
}

#[test]
fn fee_is_snapshotted_at_creation_and_immune_to_update_config() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();

    // O admin sobe a taxa de 10% para 20% depois da criação.
    env.update_fee(2_000).unwrap();
    assert_eq!(env.account::<Config>(&config_pda()).fee_bps, 2_000);

    // Liberação: a taxa continua 10%.
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();
    assert_eq!(env.balance(&env.treasury.clone()), USDC);
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);

    // Resolução de disputa a favor do criador: também 10%.
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 1, false).unwrap();
    assert_eq!(env.balance(&env.treasury.clone()), 2 * USDC);
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 18 * USDC);

    // Um escrow novo já nasce com a taxa nova.
    let (buyer2, _) = new_buyer(&mut env, 30 * USDC);
    let escrow2 = create_escrow(&mut env, &agent, &buyer2, &[10 * USDC]).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow2.key).fee_bps, 2_000);
}

#[test]
fn update_config_caps_fee_and_emits_event() {
    let mut env = Env::new();
    let err = env.update_fee(2_001).unwrap_err();
    assert!(err.contains("FeeTooHigh"), "{err}");
    assert_eq!(env.account::<Config>(&config_pda()).fee_bps, FEE_BPS);

    let logs = env.update_fee(2_000).unwrap();
    let evs = events::<solvers::events::ConfigUpdated>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].fee_bps, 2_000);
    assert_eq!(evs[0].verifier, env.verifier.pubkey());
    assert_eq!(evs[0].usage_authority, env.usage.pubkey());
    assert_eq!((evs[0].min_stake, evs[0].min_price), (0, MIN_PRICE));

    // A inicialização também respeita o teto.
    let mut env = Env::build(false);
    let admin = env.admin.insecure_clone();
    let params = ConfigParams { fee_bps: 2_001, ..env.params(0) };
    let err = env.init_config_with(&admin, params).unwrap_err();
    assert!(err.contains("FeeTooHigh"), "{err}");
}

#[test]
fn update_pricing_emits_event() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::UpdatePricing { creator: agent.creator.pubkey(), config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::UpdatePricing { price: 20 * USDC, price_per_use: USDC }.data(),
    };
    let creator = agent.creator.insecure_clone();
    let logs = env.send_logs(ix, &[&creator]).unwrap();
    let evs = events::<solvers::events::PricingUpdated>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].agent, evs[0].price, evs[0].price_per_use), (agent.key, 20 * USDC, USDC));
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.price, a.price_per_use), (20 * USDC, USDC));
}

#[test]
fn cancel_undelivered_refunds_pending_milestones_after_deadline() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow_days(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC, 5 * USDC], 7).unwrap();
    let deadline = env.account::<Escrow>(&escrow.key).delivery_deadline;
    assert_eq!(env.balance(&buyer_usdc), 5 * USDC);

    // Antes do prazo: recusado, nada se move.
    let err = cancel(&mut env, &escrow, &buyer, 0).unwrap_err();
    assert!(err.contains("DeliveryDeadlineNotReached"), "{err}");
    // No segundo exato do prazo ainda não vale (só depois).
    let to_deadline = deadline - current_time(&env);
    warp(&mut env, to_deadline);
    let err = cancel(&mut env, &escrow, &buyer, 0).unwrap_err();
    assert!(err.contains("DeliveryDeadlineNotReached"), "{err}");
    assert_eq!(env.balance(&escrow.vault), 25 * USDC);

    // Etapa entregue (Passed) não é cancelável, mesmo vencido o prazo.
    mark_passed(&mut env, &escrow, 2).unwrap();
    warp(&mut env, 1);
    let err = cancel(&mut env, &escrow, &buyer, 2).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Só o comprador cancela.
    let keeper = new_keypair();
    let ix = cancel_ix(&env, &escrow, &keeper.pubkey(), buyer_usdc, 0);
    let err = env.send(ix, &[&keeper]).unwrap_err();
    assert!(err.contains("NotBuyer"), "{err}");
    // Nem desviar o dinheiro para outra conta: o destino tem que ser do comprador.
    let (_, other_usdc) = new_buyer(&mut env, 0);
    let ix = cancel_ix(&env, &escrow, &buyer.pubkey(), other_usdc, 0);
    assert!(env.send(ix, &[&buyer]).is_err());
    // Índice inexistente.
    let err = cancel(&mut env, &escrow, &buyer, 9).unwrap_err();
    assert!(err.contains("InvalidMilestoneIndex"), "{err}");

    // Vencido: devolve a etapa inteira, sem taxa, e emite MilestoneUpdated.
    let logs = cancel(&mut env, &escrow, &buyer, 0).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 15 * USDC);
    assert_eq!(env.balance(&escrow.vault), 15 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 0);
    let evs = events::<solvers::events::MilestoneUpdated>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].escrow, evs[0].index, evs[0].status), (escrow.key, 0, MilestoneStatus::Refunded as u8));
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.milestones[0].status, MilestoneStatus::Refunded);
    assert_eq!(e.status, EscrowStatus::Active);

    // Segunda chamada na mesma etapa: recusada, sem dupla devolução.
    let err = cancel(&mut env, &escrow, &buyer, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 15 * USDC);
    assert_eq!(env.balance(&escrow.vault), 15 * USDC);

    // Cancelar a etapa 1 e liberar a 2 (Passed): o escrow termina Completed, cofre zerado.
    cancel(&mut env, &escrow, &buyer, 1).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 25 * USDC);
    release(&mut env, &agent, &escrow, &buyer, 2).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Completed);
    assert_eq!(env.balance(&escrow.vault), 0);
}

#[test]
fn cancel_all_undelivered_refunds_escrow_and_allows_close() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();
    warp(&mut env, DEFAULT_DELIVERY_DAYS as i64 * 86_400 + 1);
    cancel(&mut env, &escrow, &buyer, 0).unwrap();
    cancel(&mut env, &escrow, &buyer, 1).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 30 * USDC);
    assert_eq!(env.balance(&escrow.vault), 0);
    assert_eq!(env.account::<Escrow>(&escrow.key).status, EscrowStatus::Refunded);
    // Sem reputação afetada: ninguém perdeu disputa.
    assert_eq!(env.account::<Agent>(&agent.key).disputes_lost, 0);

    let payer = env.payer.insecure_clone();
    close(&mut env, &escrow, &buyer.pubkey(), &payer).unwrap();
    assert!(env.svm.get_account(&escrow.key).is_none_or(|a| a.lamports == 0));
}

#[test]
fn stale_dispute_refunds_buyer_only_after_sla() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    // Prazo de entrega de 1 dia: já vencido quando o SLA de 7 dias termina.
    let escrow = create_escrow_days(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC], 1).unwrap();
    let keeper = new_keypair();

    // Sem disputa aberta, não há o que resolver.
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    let opened = current_time(&env);
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.milestones[0].disputed_at, opened);
    assert_eq!(e.milestones[1].disputed_at, 0);
    assert_eq!(e.status, EscrowStatus::Disputed);

    // Antes do SLA (faltando 1 segundo): recusado.
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("DisputeSlaNotReached"), "{err}");
    warp(&mut env, DISPUTE_SLA_SECS - 1);
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("DisputeSlaNotReached"), "{err}");
    assert_eq!(env.balance(&escrow.vault), 20 * USDC);

    // Destino que não é a ATA do comprador é recusado.
    let (_, other_usdc) = new_buyer(&mut env, 0);
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ResolveStaleDispute {
            caller: keeper.pubkey(),
            escrow: escrow.key,
            vault: escrow.vault,
            buyer_usdc: other_usdc,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ResolveStaleDispute { index: 0 }.data(),
    };
    warp(&mut env, 1);
    assert!(env.send(ix, &[&keeper]).is_err());

    // No SLA (>=): qualquer um devolve tudo ao comprador, sem taxa e sem mexer na reputação.
    let logs = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    assert_eq!(env.balance(&escrow.vault), 10 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 0);
    let resolved = events::<solvers::events::DisputeResolved>(&logs);
    assert_eq!(resolved.len(), 1);
    assert_eq!((resolved[0].escrow, resolved[0].index, resolved[0].refunded), (escrow.key, 0, true));
    let updated = events::<solvers::events::MilestoneUpdated>(&logs);
    assert_eq!(updated.len(), 1);
    assert_eq!(updated[0].status, MilestoneStatus::Refunded as u8);
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.milestones[0].status, MilestoneStatus::Refunded);
    assert_eq!(e.status, EscrowStatus::Active);
    assert_eq!(env.account::<Agent>(&agent.key).disputes_lost, 0);
    assert_eq!(env.account::<UserReputation>(&rep_pda(&buyer.pubkey())).disputes_lost, 0);

    // Dupla chamada e julgamento tardio do admin: recusados, sem segunda devolução.
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, true).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, false).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    assert_eq!(env.balance(&escrow.vault), 10 * USDC);
}

#[test]
fn admin_resolution_excludes_stale_dispute() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC]).unwrap();
    mark_passed(&mut env, &escrow, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    warp(&mut env, DISPUTE_SLA_SECS);

    // O admin ainda pode julgar depois do SLA, desde que chegue antes do resgate automático.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, false).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);
    let keeper = new_keypair();
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    assert_eq!(env.balance(&escrow.vault), 0);
}

#[test]
fn stale_dispute_on_pending_milestone_also_waits_for_delivery_deadline() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow_days(&mut env, &agent, &buyer, &[10 * USDC], 30).unwrap();
    let deadline = env.account::<Escrow>(&escrow.key).delivery_deadline;
    let keeper = new_keypair();

    // Contesta no dia 1 uma etapa que nunca foi entregue; open_dispute não mexe em passed_at.
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow.key).milestones[0].passed_at, 0);

    // 7 dias depois, mas antes do prazo de entrega: recusado.
    warp(&mut env, DISPUTE_SLA_SECS);
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("DeliveryDeadlineNotReached"), "{err}");
    assert_eq!(env.balance(&escrow.vault), 10 * USDC);

    // No segundo exato do prazo ainda não vale; depois dele, reembolsa.
    let to_deadline = deadline - current_time(&env);
    warp(&mut env, to_deadline);
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("DeliveryDeadlineNotReached"), "{err}");
    warp(&mut env, 1);
    stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 30 * USDC);
    assert_eq!(env.balance(&escrow.vault), 0);
    assert_eq!(env.account::<Escrow>(&escrow.key).status, EscrowStatus::Refunded);
}

#[test]
fn stale_dispute_on_delivered_milestone_needs_admin_judgment() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow_days(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC], 1).unwrap();
    let keeper = new_keypair();

    // O relógio do LiteSVM começa em 0, que é o valor sentinela de passed_at: usa um horário real.
    warp(&mut env, 1_700_000_000);

    // Entregue (Passed) e contestada dentro da janela de revisão; passed_at continua gravado.
    mark_passed(&mut env, &escrow, 0).unwrap();
    mark_passed(&mut env, &escrow, 1).unwrap();
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    assert_ne!(env.account::<Escrow>(&escrow.key).milestones[0].passed_at, 0);

    // Mesmo com o SLA e o prazo de entrega vencidos, e mesmo muito depois, o automático recusa.
    for secs in [DISPUTE_SLA_SECS, 30 * 86_400] {
        warp(&mut env, secs);
        let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
        assert!(err.contains("StaleDisputeNeedsJudgment"), "{err}");
    }
    assert_eq!(env.balance(&escrow.vault), 20 * USDC);
    assert_eq!(env.balance(&buyer_usdc), 10 * USDC);

    // O admin ainda julga: reembolso numa etapa e pagamento ao criador (com a taxa) na outra.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, true).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 1, false).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), USDC);
    assert_eq!(env.balance(&escrow.vault), 0);
    assert_eq!(env.account::<Escrow>(&escrow.key).status, EscrowStatus::Completed);
}

/// O comprador (dono da ATA) passa o dono da própria ATA de USDC para outra chave, via
/// SetAuthority(AccountOwner). No token program clássico isso é permitido e a conta não pode ser
/// recriada naquele endereço (a ATA é determinística por dono+mint).
fn swap_ata_owner(env: &mut Env, buyer: &Keypair, new_owner: &Pubkey) {
    let ata = env.ata(&buyer.pubkey());
    let ix = spl_token::instruction::set_authority(
        &spl_token::ID,
        &ata,
        Some(new_owner),
        spl_token::instruction::AuthorityType::AccountOwner,
        &buyer.pubkey(),
        &[],
    )
    .unwrap();
    let ix = Instruction {
        program_id: ix.program_id,
        accounts: ix
            .accounts
            .into_iter()
            .map(|a| AccountMeta { pubkey: a.pubkey, is_signer: a.is_signer, is_writable: a.is_writable })
            .collect(),
        data: ix.data,
    };
    env.send(ix, &[buyer]).unwrap();
    let acc = env.svm.get_account(&ata).unwrap();
    assert_eq!(spl_token::state::Account::unpack(&acc.data).unwrap().owner, *new_owner);
}

/// Comportamento desejado: o comprador não consegue travar a resolução da disputa trocando o dono
/// da sua ATA. Quando a etapa vai para o criador (refund=false) a ATA do comprador nem é usada, então
/// a resolução precisa funcionar; senão o comprador contesta, troca o dono e extorque o criador.
#[test]
fn buyer_ata_owner_swap_nao_trava_disputa() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();
    mark_passed(&mut env, &escrow, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 0).unwrap();

    swap_ata_owner(&mut env, &buyer, &unique_key());

    // O admin dá razão ao criador: a etapa é paga a ele (com a taxa) e o comprador perde a disputa.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, false)
        .expect("resolve_dispute(refund=false) travou com a ATA do comprador trocada");
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), USDC);
    assert_eq!(env.balance(&escrow.vault), 10 * USDC);
    assert_eq!(env.account::<UserReputation>(&rep_pda(&buyer.pubkey())).disputes_lost, 1);
    assert_eq!(env.account::<Escrow>(&escrow.key).milestones[0].status, MilestoneStatus::Approved);
}

/// Comportamento desejado: a plataforma consegue fechar um escrow encerrado (e recuperar o rent)
/// mesmo que o comprador tenha trocado o dono da sua ATA depois de receber/pagar tudo.
#[test]
fn buyer_ata_owner_swap_nao_trava_fechamento() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, _) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC]).unwrap();
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow.key).status, EscrowStatus::Completed);
    assert_eq!(env.balance(&escrow.vault), 0);

    swap_ata_owner(&mut env, &buyer, &unique_key());

    let payer = env.payer.insecure_clone();
    close(&mut env, &escrow, &buyer.pubkey(), &payer)
        .expect("close_escrow travou com a ATA do comprador trocada");
    assert!(env.svm.get_account(&escrow.key).is_none_or(|a| a.lamports == 0));
}

/// Reembolso depois da troca de dono: o destino continua sendo o endereço da ATA derivada do
/// comprador (a validação é por endereço + mint), e o saldo chega lá.
#[test]
fn buyer_ata_owner_swap_reembolso_vai_para_a_ata_derivada() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    swap_ata_owner(&mut env, &buyer, &unique_key());

    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 0, true).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    assert_eq!(env.balance(&escrow.vault), 10 * USDC);
    assert_eq!(env.account::<Agent>(&agent.key).disputes_lost, 1);

    // Uma conta de USDC qualquer (não é a ATA derivada) continua recusada como destino.
    let (_, other_usdc) = new_buyer(&mut env, 0);
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    let admin = env.admin.insecure_clone();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ResolveDispute {
            admin: admin.pubkey(),
            config: config_pda(),
            agent: agent.key,
            escrow: escrow.key,
            vault: escrow.vault,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            buyer_usdc: other_usdc,
            buyer_reputation: rep_pda(&buyer.pubkey()),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ResolveDispute { index: 1, refund: true }.data(),
    };
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintAddress"), "{err}");
    assert_eq!(env.balance(&other_usdc), 0);
}

// ---------------------------------------------------------------------------------------------
// Transferência de admin em duas etapas, troca do tesouro e aporte de stake.
// ---------------------------------------------------------------------------------------------

fn pending_admin_pda() -> Pubkey {
    pda(&[PENDING_ADMIN_SEED, config_pda().as_ref()])
}

fn lamports(env: &Env, key: &Pubkey) -> u64 {
    env.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

/// Chave com SOL, fora do `env.payer` (que paga as taxas de todas as transações do harness).
fn funded(env: &mut Env) -> Keypair {
    let k = new_keypair();
    env.svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    k
}

fn propose_admin(env: &mut Env, rent_payer: &Keypair, admin: &Keypair, new_admin: Pubkey) -> Result<Vec<String>, String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ProposeAdmin {
            payer: rent_payer.pubkey(),
            admin: admin.pubkey(),
            config: config_pda(),
            pending_admin: pending_admin_pda(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ProposeAdmin { new_admin }.data(),
    };
    env.send_logs(ix, &[admin, rent_payer])
}

fn accept_admin_with(env: &mut Env, signer: &Keypair, rent_payer: Pubkey) -> Result<Vec<String>, String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::AcceptAdmin {
            new_admin: signer.pubkey(),
            config: config_pda(),
            pending_admin: pending_admin_pda(),
            rent_payer,
        }
        .to_account_metas(None),
        data: solvers::instruction::AcceptAdmin {}.data(),
    };
    env.send_logs(ix, &[signer])
}

fn cancel_admin_transfer_with(env: &mut Env, signer: &Keypair, rent_payer: Pubkey) -> Result<Vec<String>, String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CancelAdminTransfer {
            admin: signer.pubkey(),
            config: config_pda(),
            pending_admin: pending_admin_pda(),
            rent_payer,
        }
        .to_account_metas(None),
        data: solvers::instruction::CancelAdminTransfer {}.data(),
    };
    env.send_logs(ix, &[signer])
}

fn update_config_as(env: &mut Env, signer: &Keypair, params: ConfigParams) -> Result<Vec<String>, String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::UpdateConfig { admin: signer.pubkey(), config: config_pda() }.to_account_metas(None),
        data: solvers::instruction::UpdateConfig { args: params }.data(),
    };
    env.send_logs(ix, &[signer])
}

fn approve_as(env: &mut Env, signer: &Keypair, agent: &TestAgent) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetAgentStatus { admin: signer.pubkey(), config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::ApproveAgent {}.data(),
    };
    env.send(ix, &[signer])
}

#[test]
fn admin_transfer_two_steps_happy_path() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let sponsor = funded(&mut env);
    let new_admin = funded(&mut env);
    let sponsor_before = lamports(&env, &sponsor.pubkey());

    let logs = propose_admin(&mut env, &sponsor, &admin, new_admin.pubkey()).unwrap();
    let evs = events::<solvers::events::AdminTransferProposed>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].admin, evs[0].new_admin), (admin.pubkey(), new_admin.pubkey()));
    let pending: PendingAdmin = env.account(&pending_admin_pda());
    assert_eq!(pending.new_admin, new_admin.pubkey());
    assert_eq!(pending.rent_payer, sponsor.pubkey());
    assert_eq!(pending.bump, Pubkey::find_program_address(&[PENDING_ADMIN_SEED, config_pda().as_ref()], &solvers::ID).1);
    let rent = lamports(&env, &pending_admin_pda());
    assert_eq!(lamports(&env, &sponsor.pubkey()), sponsor_before - rent);
    // Proposta não troca nada: o admin continua o mesmo e o indicado ainda não manda.
    assert_eq!(env.account::<Config>(&config_pda()).admin, admin.pubkey());
    let params = env.params(0);
    let err = update_config_as(&mut env, &new_admin, params).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");

    // Aceitar fecha a proposta e devolve o rent a quem pagou (não ao novo admin).
    let new_before = lamports(&env, &new_admin.pubkey());
    let logs = accept_admin_with(&mut env, &new_admin, sponsor.pubkey()).unwrap();
    let evs = events::<solvers::events::AdminTransferred>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].old_admin, evs[0].new_admin), (admin.pubkey(), new_admin.pubkey()));
    assert_eq!(env.account::<Config>(&config_pda()).admin, new_admin.pubkey());
    assert!(env.svm.get_account(&pending_admin_pda()).is_none_or(|a| a.lamports == 0));
    assert_eq!(lamports(&env, &sponsor.pubkey()), sponsor_before);
    assert_eq!(lamports(&env, &new_admin.pubkey()), new_before);

    // O admin antigo perde o acesso (update_config e approve_agent); o novo passa a mandar.
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let params = env.params(0);
    let err = update_config_as(&mut env, &admin, params).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let err = approve_as(&mut env, &admin, &agent).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let params = ConfigParams { min_price: 7 * USDC, ..env.params(0) };
    update_config_as(&mut env, &new_admin, params).unwrap();
    assert_eq!(env.account::<Config>(&config_pda()).min_price, 7 * USDC);
    approve_as(&mut env, &new_admin, &agent).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);

    // A PDA fechada pode ser recriada: o novo admin devolve o cargo ao antigo.
    propose_admin(&mut env, &sponsor, &new_admin, admin.pubkey()).unwrap();
    accept_admin_with(&mut env, &admin, sponsor.pubkey()).unwrap();
    assert_eq!(env.account::<Config>(&config_pda()).admin, admin.pubkey());
    assert_eq!(lamports(&env, &sponsor.pubkey()), sponsor_before);
}

#[test]
fn admin_transfer_rejects_wrong_signers_and_missing_proposal() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let sponsor = funded(&mut env);
    let new_admin = funded(&mut env);
    let stranger = funded(&mut env);

    // Sem proposta, aceitar e cancelar falham (a PDA não existe).
    let err = accept_admin_with(&mut env, &new_admin, sponsor.pubkey()).unwrap_err();
    assert!(err.contains("AccountNotInitialized"), "{err}");
    let err = cancel_admin_transfer_with(&mut env, &admin, sponsor.pubkey()).unwrap_err();
    assert!(err.contains("AccountNotInitialized"), "{err}");

    // Propor exige o admin; chave nula e o próprio admin são recusados.
    let err = propose_admin(&mut env, &sponsor, &stranger, new_admin.pubkey()).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let err = propose_admin(&mut env, &sponsor, &admin, Pubkey::default()).unwrap_err();
    assert!(err.contains("InvalidNewAdmin"), "{err}");
    let err = propose_admin(&mut env, &sponsor, &admin, admin.pubkey()).unwrap_err();
    assert!(err.contains("InvalidNewAdmin"), "{err}");
    assert!(env.svm.get_account(&pending_admin_pda()).is_none_or(|a| a.lamports == 0));

    propose_admin(&mut env, &sponsor, &admin, new_admin.pubkey()).unwrap();
    // Segunda proposta falha enquanto a primeira existir (init, não init_if_needed).
    let err = propose_admin(&mut env, &sponsor, &admin, stranger.pubkey()).unwrap_err();
    assert!(err.contains("already in use"), "{err}");
    assert_eq!(env.account::<PendingAdmin>(&pending_admin_pda()).new_admin, new_admin.pubkey());

    // Aceitar: só o indicado (nem o admin atual, nem um estranho); e o rent só vai a quem pagou.
    let err = accept_admin_with(&mut env, &stranger, sponsor.pubkey()).unwrap_err();
    assert!(err.contains("NotPendingAdmin"), "{err}");
    let err = accept_admin_with(&mut env, &admin, sponsor.pubkey()).unwrap_err();
    assert!(err.contains("NotPendingAdmin"), "{err}");
    let err = accept_admin_with(&mut env, &new_admin, stranger.pubkey()).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    // Cancelar: só o admin atual, e também com o destino do rent fixo.
    let err = cancel_admin_transfer_with(&mut env, &new_admin, sponsor.pubkey()).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let err = cancel_admin_transfer_with(&mut env, &admin, stranger.pubkey()).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    assert_eq!(env.account::<Config>(&config_pda()).admin, admin.pubkey());

    // Depois do cancel (evento + rent devolvido) dá para propor de novo, a outra pessoa.
    let sponsor_before_cancel = lamports(&env, &sponsor.pubkey());
    let logs = cancel_admin_transfer_with(&mut env, &admin, sponsor.pubkey()).unwrap();
    let evs = events::<solvers::events::AdminTransferCancelled>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].admin, evs[0].new_admin), (admin.pubkey(), new_admin.pubkey()));
    assert!(env.svm.get_account(&pending_admin_pda()).is_none_or(|a| a.lamports == 0));
    assert!(lamports(&env, &sponsor.pubkey()) > sponsor_before_cancel);
    // O indicado cancelado não consegue mais aceitar.
    let err = accept_admin_with(&mut env, &new_admin, sponsor.pubkey()).unwrap_err();
    assert!(err.contains("AccountNotInitialized"), "{err}");
    propose_admin(&mut env, &sponsor, &admin, stranger.pubkey()).unwrap();
    assert_eq!(env.account::<PendingAdmin>(&pending_admin_pda()).new_admin, stranger.pubkey());
}

/// Quem pagou o rent pode ser o próprio admin (mesma chave como signer e como destino mutável do
/// rent): contas `Signer`/`UncheckedAccount` não entram na checagem de duplicadas do Anchor 1.x.
#[test]
fn admin_transfer_works_when_admin_is_also_the_rent_payer() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let new_admin = funded(&mut env);
    let before = lamports(&env, &admin.pubkey());

    propose_admin(&mut env, &admin, &admin, new_admin.pubkey()).unwrap();
    assert_eq!(env.account::<PendingAdmin>(&pending_admin_pda()).rent_payer, admin.pubkey());
    cancel_admin_transfer_with(&mut env, &admin, admin.pubkey()).unwrap();
    assert_eq!(lamports(&env, &admin.pubkey()), before);

    // O próprio indicado pode ter pago o rent: aceitar com new_admin == rent_payer.
    propose_admin(&mut env, &new_admin, &admin, new_admin.pubkey()).unwrap();
    let new_before = lamports(&env, &new_admin.pubkey());
    accept_admin_with(&mut env, &new_admin, new_admin.pubkey()).unwrap();
    assert!(lamports(&env, &new_admin.pubkey()) > new_before);
    assert_eq!(env.account::<Config>(&config_pda()).admin, new_admin.pubkey());
}

fn set_treasury_ix(env: &Env, signer: &Pubkey, new_treasury: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetTreasury {
            admin: *signer,
            config: config_pda(),
            usdc_mint: env.mint,
            new_treasury,
        }
        .to_account_metas(None),
        data: solvers::instruction::SetTreasury {}.data(),
    }
}

/// Conta de token com mint, dono e estado arbitrários (escrita direta no estado).
fn raw_token_account(env: &mut Env, mint: Pubkey, owner: &Pubkey, state: spl_token::state::AccountState) -> Pubkey {
    let key = unique_key();
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint,
        owner: *owner,
        amount: 0,
        delegate: None.into(),
        state,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    env.set_token_program_account(key, data);
    key
}

#[test]
fn set_treasury_updates_config_and_purchases_pay_new_treasury() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let old_treasury = env.treasury;
    let new_treasury = env.token_account(&unique_key(), 0);
    let admin = env.admin.insecure_clone();

    let ix = set_treasury_ix(&env, &admin.pubkey(), new_treasury);
    let logs = env.send_logs(ix, &[&admin]).unwrap();
    let evs = events::<solvers::events::TreasuryUpdated>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].old_treasury, evs[0].new_treasury), (old_treasury, new_treasury));
    assert_eq!(env.account::<Config>(&config_pda()).treasury, new_treasury);

    // A compra usa o novo tesouro; o antigo é recusado (has_one = treasury).
    let (buyer, _) = new_buyer(&mut env, 50 * USDC);
    env.treasury = old_treasury;
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    env.treasury = new_treasury;
    purchase(&mut env, &agent, &buyer).unwrap();
    assert_eq!(env.balance(&new_treasury), 1_200_000);
    assert_eq!(env.balance(&old_treasury), 0);
}

#[test]
fn set_treasury_rejects_non_admin_wrong_mint_frozen_and_uninitialized() {
    let mut env = Env::new();
    let old_treasury = env.treasury;
    let admin = env.admin.insecure_clone();
    let stranger = funded(&mut env);
    let good = env.token_account(&unique_key(), 0);

    let ix = set_treasury_ix(&env, &stranger.pubkey(), good);
    let err = env.send(ix, &[&stranger]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");

    let other_mint = unique_key();
    let wrong_mint = raw_token_account(&mut env, other_mint, &unique_key(), spl_token::state::AccountState::Initialized);
    let ix = set_treasury_ix(&env, &admin.pubkey(), wrong_mint);
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintTokenMint"), "{err}");

    let mint = env.mint;
    let frozen = raw_token_account(&mut env, mint, &unique_key(), spl_token::state::AccountState::Frozen);
    let ix = set_treasury_ix(&env, &admin.pubkey(), frozen);
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("InvalidTokenAccount"), "{err}");

    // Conta de token ainda não inicializada (dados zerados) e conta que nem existe.
    let uninit = raw_token_account(&mut env, mint, &unique_key(), spl_token::state::AccountState::Uninitialized);
    let ix = set_treasury_ix(&env, &admin.pubkey(), uninit);
    assert!(env.send(ix, &[&admin]).is_err());
    let ix = set_treasury_ix(&env, &admin.pubkey(), unique_key());
    assert!(env.send(ix, &[&admin]).is_err());

    assert_eq!(env.account::<Config>(&config_pda()).treasury, old_treasury);
}

/// Tesouro com delegate, close_authority ou valor delegado de terceiros é recusado: o terceiro
/// poderia esvaziar/fechar a conta (com saldo zero) e travar compras e liberações da plataforma.
#[test]
fn set_treasury_rejects_delegate_and_close_authority() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let mint = env.mint;
    let third = unique_key();
    let make = |env: &mut Env, delegate: Option<Pubkey>, close_authority: Option<Pubkey>, delegated_amount: u64| {
        let key = unique_key();
        let mut data = vec![0u8; spl_token::state::Account::LEN];
        spl_token::state::Account {
            mint,
            owner: unique_key(),
            amount: 0,
            delegate: delegate.into(),
            state: spl_token::state::AccountState::Initialized,
            is_native: None.into(),
            delegated_amount,
            close_authority: close_authority.into(),
        }
        .pack_into_slice(&mut data);
        env.set_token_program_account(key, data);
        key
    };
    let old_treasury = env.treasury;
    for (delegate, close_authority, delegated) in
        [(None, Some(third), 0), (Some(third), None, 0), (Some(third), None, 5), (Some(third), Some(third), 0)]
    {
        let bad = make(&mut env, delegate, close_authority, delegated);
        let ix = set_treasury_ix(&env, &admin.pubkey(), bad);
        let err = env.send(ix, &[&admin]).unwrap_err();
        assert!(err.contains("InvalidTokenAccount"), "{err}");
    }
    assert_eq!(env.account::<Config>(&config_pda()).treasury, old_treasury);

    // Conta de outro dono, sem delegate nem close_authority, continua aceita.
    let good = make(&mut env, None, None, 0);
    let ix = set_treasury_ix(&env, &admin.pubkey(), good);
    env.send(ix, &[&admin]).unwrap();
    assert_eq!(env.account::<Config>(&config_pda()).treasury, good);
}

/// Confisco completo pelo fluxo novo: propõe, espera as 72 h e executa.
fn slash(env: &mut Env, agent: &TestAgent, amount: u64) -> Result<(), String> {
    propose(env, agent, amount)?;
    warp(env, SLASH_DELAY_SECS);
    execute(env, agent).map(|_| ())
}

fn top_up_ix(env: &Env, agent: &TestAgent, creator: &Pubkey, source: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::TopUpStake {
            creator: *creator,
            config: config_pda(),
            agent: agent.key,
            stake_vault: pda(&[STAKE_SEED, agent.key.as_ref()]),
            creator_usdc: source,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::TopUpStake { amount }.data(),
    }
}

#[test]
fn top_up_stake_after_slash_allows_reapproval() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let vault = pda(&[STAKE_SEED, agent.key.as_ref()]);
    approve(&mut env, &agent);
    let creator = agent.creator.insecure_clone();

    slash(&mut env, &agent, 4 * USDC).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.stake, a.status), (6 * USDC, AgentStatus::Suspended));
    assert_eq!(env.balance(&vault), 6 * USDC);
    // Com stake abaixo do mínimo o solver não volta.
    let admin = env.admin.insecure_clone();
    let err = approve_as(&mut env, &admin, &agent).unwrap_err();
    assert!(err.contains("InsufficientStake"), "{err}");

    // Só o criador aporta, e o valor precisa ser maior que zero.
    let (intruder, intruder_usdc) = new_buyer(&mut env, 20 * USDC);
    let ix = top_up_ix(&env, &agent, &intruder.pubkey(), intruder_usdc, 4 * USDC);
    let err = env.send(ix, &[&intruder]).unwrap_err();
    assert!(err.contains("NotCreator"), "{err}");
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 0);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("InvalidAmount"), "{err}");
    // Origem de outro dono é recusada (o criador assina, mas a conta não é dele).
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), intruder_usdc, 4 * USDC);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("ConstraintTokenOwner"), "{err}");
    assert_eq!(env.balance(&intruder_usdc), 20 * USDC);
    assert_eq!(env.account::<Agent>(&agent.key).stake, 6 * USDC);

    let creator_before = env.balance(&agent.creator_usdc);
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 4 * USDC);
    let logs = env.send_logs(ix, &[&creator]).unwrap();
    let evs = events::<solvers::events::StakeToppedUp>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(
        (evs[0].agent, evs[0].creator, evs[0].amount, evs[0].stake),
        (agent.key, creator.pubkey(), 4 * USDC, 10 * USDC)
    );
    assert_eq!(env.account::<Agent>(&agent.key).stake, 10 * USDC);
    assert_eq!(env.balance(&vault), 10 * USDC);
    assert_eq!(env.balance(&agent.creator_usdc), creator_before - 4 * USDC);
    // Aportar não reativa sozinho: o admin ainda precisa aprovar.
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Suspended);
    approve(&mut env, &agent);
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
}

#[test]
fn top_up_stake_works_on_pending_agent_and_checks_funds_and_overflow() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let creator = agent.creator.insecure_clone();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Pending);

    // Aporte de agente ainda pendente (qualquer status vale).
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 5 * USDC);
    env.send(ix, &[&creator]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).stake, 15 * USDC);

    // Saldo insuficiente: o token program recusa e nada muda.
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 1_000 * USDC);
    assert!(env.send(ix, &[&creator]).is_err());
    assert_eq!(env.account::<Agent>(&agent.key).stake, 15 * USDC);

    // Estouro de u64 no stake registrado é recusado antes da transferência.
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, u64::MAX);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("MathOverflow"), "{err}");
}

// ---------------------------------------------------------------------------------------------
// Cobertura de QA: instruções sem teste, erros sem teste negativo, limites (0, u32::MAX, u64::MAX,
// segundo exato dos prazos), contas trocadas e teto de CU.
// ---------------------------------------------------------------------------------------------

/// Horário realista: o relógio do LiteSVM começa em 0, que é o sentinela de `passed_at`/`disputed_at`.
const T0: i64 = 1_700_000_000;

fn set_time(env: &mut Env, ts: i64) {
    let mut clock: solana_clock::Clock = env.svm.get_sysvar();
    clock.unix_timestamp = ts;
    env.svm.set_sysvar(&clock);
}

/// Edita uma conta do programa direto no estado (reputação, créditos, saldos de teste).
fn write_account<T: AccountDeserialize + anchor_lang::AccountSerialize>(env: &mut Env, key: &Pubkey, edit: impl FnOnce(&mut T)) {
    let mut acc = env.svm.get_account(key).expect("conta inexistente");
    let mut value = T::try_deserialize(&mut acc.data.as_slice()).unwrap();
    edit(&mut value);
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(*key, acc).unwrap();
}

fn admin_kp(env: &Env) -> Keypair {
    env.admin.insecure_clone()
}
fn verifier_kp(env: &Env) -> Keypair {
    env.verifier.insecure_clone()
}
fn usage_kp(env: &Env) -> Keypair {
    env.usage.insecure_clone()
}

fn active_agent(env: &mut Env, price: u64, price_per_use: u64) -> TestAgent {
    let agent = register(env, price, price_per_use).unwrap();
    approve(env, &agent);
    agent
}

/// Troca uma conta (por endereço) em todas as metas de uma instrução.
fn swap_account(ix: &mut Instruction, from: &Pubkey, to: Pubkey) {
    let mut hit = false;
    for m in ix.accounts.iter_mut().filter(|m| m.pubkey == *from) {
        m.pubkey = to;
        hit = true;
    }
    assert!(hit, "a conta {from} não faz parte da instrução");
}

/// A meta continua na instrução, mas sem assinatura: simula quem cita a chave de outro.
fn unsign(ix: &mut Instruction, key: &Pubkey) {
    let mut hit = false;
    for m in ix.accounts.iter_mut().filter(|m| m.pubkey == *key) {
        m.is_signer = false;
        hit = true;
    }
    assert!(hit, "a conta {key} não faz parte da instrução");
}

fn status_ix(signer: &Pubkey, agent: &TestAgent, approve: bool) -> Instruction {
    let accounts = solvers::accounts::SetAgentStatus { admin: *signer, config: config_pda(), agent: agent.key }
        .to_account_metas(None);
    let data = if approve {
        solvers::instruction::ApproveAgent {}.data()
    } else {
        solvers::instruction::SuspendAgent {}.data()
    };
    Instruction { program_id: solvers::ID, accounts, data }
}

fn update_version_ix(signer: &Pubkey, agent: &TestAgent, version: &str, hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::UpdateVersion { creator: *signer, agent: agent.key }.to_account_metas(None),
        data: solvers::instruction::UpdateVersion { version: version.to_string(), version_hash: hash }.data(),
    }
}

fn update_pricing_ix(signer: &Pubkey, agent: &TestAgent, price: u64, price_per_use: u64) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::UpdatePricing { creator: *signer, config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::UpdatePricing { price, price_per_use }.data(),
    }
}

fn set_eval_ix(signer: &Pubkey, agent: &TestAgent, score_bps: u16, hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetEval { verifier: *signer, config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::SetEval { eval_score_bps: score_bps, eval_hash: hash }.data(),
    }
}

fn record_usage_ix(signer: &Pubkey, agent: &TestAgent, count: u64, root: [u8; 32]) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::RecordUsageBatch { usage_authority: *signer, config: config_pda(), agent: agent.key }
            .to_account_metas(None),
        data: solvers::instruction::RecordUsageBatch { count, merkle_root: root }.data(),
    }
}

fn credits_pda(agent: &TestAgent, owner: &Pubkey) -> Pubkey {
    pda(&[CREDITS_SEED, agent.key.as_ref(), owner.as_ref()])
}

fn consume_ix(signer: &Pubkey, agent: &TestAgent, credits: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ConsumeCredit {
            usage_authority: *signer,
            config: config_pda(),
            agent: agent.key,
            credits,
        }
        .to_account_metas(None),
        data: solvers::instruction::ConsumeCredit {}.data(),
    }
}

fn buy_credits_ix(env: &Env, agent: &TestAgent, buyer: &Pubkey, amount: u32, max_total: u64) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::BuyCredits {
            payer: env.payer.pubkey(),
            buyer: *buyer,
            config: config_pda(),
            agent: agent.key,
            credits: credits_pda(agent, buyer),
            reputation: rep_pda(buyer),
            buyer_usdc: env.ata(buyer),
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::BuyCredits { amount, max_total }.data(),
    }
}

fn purchase_ix(env: &Env, agent: &TestAgent, buyer: &Pubkey, asset: &Pubkey, expected_price: u64) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::PurchaseLicense {
            payer: env.payer.pubkey(),
            buyer: *buyer,
            config: config_pda(),
            agent: agent.key,
            collection: agent.collection,
            collection_authority: pda(&[COLLECTION_AUTHORITY_SEED]),
            asset: *asset,
            buyer_usdc: env.ata(buyer),
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            reputation: rep_pda(buyer),
            mpl_core_program: mpl_core::ID,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::PurchaseLicense { expected_price }.data(),
    }
}

fn release_ix(env: &Env, agent: &TestAgent, escrow: &TestEscrow, caller: &Pubkey, index: u8) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ReleaseMilestone {
            caller: *caller,
            config: config_pda(),
            agent: agent.key,
            escrow: escrow.key,
            vault: escrow.vault,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ReleaseMilestone { index }.data(),
    }
}

fn mark_passed_ix(signer: &Pubkey, escrow: Pubkey, index: u8) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::MarkPassed { verifier: *signer, config: config_pda(), escrow }.to_account_metas(None),
        data: solvers::instruction::MarkPassed { index, deliverable_hash: [3; 32] }.data(),
    }
}

fn dispute_ix(signer: &Pubkey, escrow: &TestEscrow, index: u8) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::OpenDispute { buyer: *signer, escrow: escrow.key, reputation: rep_pda(signer) }
            .to_account_metas(None),
        data: solvers::instruction::OpenDispute { index, reason_hash: [5; 32] }.data(),
    }
}

fn resolve_ix(env: &Env, agent: &TestAgent, escrow: &TestEscrow, signer: &Pubkey, buyer: &Pubkey, index: u8, refund: bool) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ResolveDispute {
            admin: *signer,
            config: config_pda(),
            agent: agent.key,
            escrow: escrow.key,
            vault: escrow.vault,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            buyer_usdc: env.ata(buyer),
            buyer_reputation: rep_pda(buyer),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ResolveDispute { index, refund }.data(),
    }
}

// ----------------------------------------------------------------------------------- admin ----

#[test]
fn suspend_agent_blocks_new_sales_but_keeps_open_escrows_payable() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC]).unwrap();

    // Só o admin suspende: o criador e o verificador são recusados.
    let (creator, verifier, admin) = (agent.creator.insecure_clone(), verifier_kp(&env), admin_kp(&env));
    for signer in [&creator, &verifier] {
        let err = env.send(status_ix(&signer.pubkey(), &agent, false), &[signer]).unwrap_err();
        assert!(err.contains("NotAdmin"), "{err}");
    }
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);

    let logs = env.send_logs(status_ix(&admin.pubkey(), &agent, false), &[&admin]).unwrap();
    let evs = events::<solvers::events::AgentStatusChanged>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].agent, evs[0].status), (agent.key, AgentStatus::Suspended as u8));
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Suspended);

    // Vendas novas param: licença, créditos e garantia.
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
    let err = buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
    let (buyer2, _) = new_buyer(&mut env, 30 * USDC);
    let err = create_escrow(&mut env, &agent, &buyer2, &[10 * USDC]).err().unwrap();
    assert!(err.contains("AgentNotActive"), "{err}");

    // O que já está no cofre continua pagável: suspender não prende o dinheiro do comprador.
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow.key).status, EscrowStatus::Completed);
    assert_eq!(env.balance(&escrow.vault), 0);

    // Suspender de novo é inofensivo; aprovar reativa; aprovar quem já está ativo é recusado.
    env.send(status_ix(&admin.pubkey(), &agent, false), &[&admin]).unwrap();
    env.send(status_ix(&admin.pubkey(), &agent, true), &[&admin]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
    let err = env.send(status_ix(&admin.pubkey(), &agent, true), &[&admin]).unwrap_err();
    assert!(err.contains("AgentNotPending"), "{err}");
    purchase(&mut env, &agent, &buyer).unwrap();

    // Um solver ainda pendente também pode ser suspenso (e depois aprovado).
    let pending = register(&mut env, 12 * USDC, 0).unwrap();
    env.send(status_ix(&admin.pubkey(), &pending, false), &[&admin]).unwrap();
    assert_eq!(env.account::<Agent>(&pending.key).status, AgentStatus::Suspended);
    approve(&mut env, &pending);
    assert_eq!(env.account::<Agent>(&pending.key).status, AgentStatus::Active);
}

#[test]
fn config_rejects_bps_above_100_percent_second_init_and_non_admin() {
    let mut env = Env::build(false);
    let admin = admin_kp(&env);
    // 10_001 e u16::MAX: InvalidBps (vem antes do teto de 20% de FeeTooHigh).
    for fee_bps in [10_001, u16::MAX] {
        let params = ConfigParams { fee_bps, ..env.params(0) };
        let err = env.init_config_with(&admin, params).unwrap_err();
        assert!(err.contains("InvalidBps"), "{fee_bps}: {err}");
    }
    assert!(env.svm.get_account(&config_pda()).is_none());
    // 10_000 (100%) passa de 20%: FeeTooHigh. 0% é válido.
    let params = ConfigParams { fee_bps: 10_000, ..env.params(0) };
    let err = env.init_config_with(&admin, params).unwrap_err();
    assert!(err.contains("FeeTooHigh"), "{err}");
    let params = ConfigParams { fee_bps: 0, ..env.params(0) };
    env.init_config_with(&admin, params).unwrap();

    // A config não é reinicializável (init), nem para o admin.
    let err = env.init_config(&admin, 0).unwrap_err();
    assert!(err.contains("already in use"), "{err}");
    assert_eq!(env.account::<Config>(&config_pda()).fee_bps, 0);

    // update_config: só o admin; bps inválido; limites aceitos.
    let stranger = funded(&mut env);
    let params = env.params(0);
    let err = update_config_as(&mut env, &stranger, params).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let err = env.update_fee(u16::MAX).unwrap_err();
    assert!(err.contains("InvalidBps"), "{err}");
    let err = env.update_fee(10_001).unwrap_err();
    assert!(err.contains("InvalidBps"), "{err}");
    let params = ConfigParams { min_stake: u64::MAX, min_price: u64::MAX, fee_bps: 0, ..env.params(0) };
    update_config_as(&mut env, &admin, params).unwrap();
    let cfg: Config = env.account(&config_pda());
    assert_eq!((cfg.min_stake, cfg.min_price, cfg.fee_bps), (u64::MAX, u64::MAX, 0));
}

// ---------------------------------------------------------------------------------- publicação ----

#[test]
fn register_validates_lengths_bps_prices_and_duplicates() {
    let mut env = Env::new();

    // No limite exato (em bytes) tudo passa: nome 32, URI 200, versão 16; royalty 100%.
    let agent = register_with(&mut env, MIN_PRICE, MIN_PRICE, |a| {
        a.name = "n".repeat(MAX_NAME_LEN);
        a.metadata_uri = "u".repeat(MAX_URI_LEN);
        a.version = "v".repeat(MAX_VERSION_LEN);
        a.royalty_bps = MAX_BPS;
    })
    .unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.metadata_uri.len(), a.version.len(), a.royalty_bps), (MAX_URI_LEN, MAX_VERSION_LEN, MAX_BPS));
    // Texto multibyte: o limite é em bytes ("é" ocupa 2). 16 x "é" = 32 passa; 17 x "é" = 34 não.
    register_with(&mut env, MIN_PRICE, 0, |a| a.name = "é".repeat(16)).unwrap();
    // Preço e preço por uso no teto de u64 (não há máximo de preço).
    register_with(&mut env, u64::MAX, u64::MAX, |_| {}).unwrap();

    let too_long: [(&str, Box<dyn Fn(&mut RegisterAgentArgs)>); 5] = [
        ("nome", Box::new(|a: &mut RegisterAgentArgs| a.name = "n".repeat(MAX_NAME_LEN + 1))),
        ("nome multibyte", Box::new(|a: &mut RegisterAgentArgs| a.name = "é".repeat(17))),
        ("uri", Box::new(|a: &mut RegisterAgentArgs| a.metadata_uri = "u".repeat(MAX_URI_LEN + 1))),
        ("versão", Box::new(|a: &mut RegisterAgentArgs| a.version = "v".repeat(MAX_VERSION_LEN + 1))),
        ("uri longa", Box::new(|a: &mut RegisterAgentArgs| a.metadata_uri = "u".repeat(400))),
    ];
    for (what, tweak) in too_long {
        let err = register_with(&mut env, 12 * USDC, 0, |a| tweak(a)).err().unwrap();
        assert!(err.contains("StringTooLong"), "{what}: {err}");
    }

    // Royalty acima de 100%.
    for bps in [MAX_BPS + 1, u16::MAX] {
        let err = register_with(&mut env, 12 * USDC, 0, |a| a.royalty_bps = bps).err().unwrap();
        assert!(err.contains("InvalidBps"), "{bps}: {err}");
    }
    // Preço: 0 e um abaixo do mínimo; preço por uso acima do preço.
    for price in [0, MIN_PRICE - 1] {
        let err = register_with(&mut env, price, 0, |_| {}).err().unwrap();
        assert!(err.contains("PriceTooLow"), "{price}: {err}");
    }
    let err = register(&mut env, MIN_PRICE, MIN_PRICE + 1).err().unwrap();
    assert!(err.contains("InvalidAmount"), "{err}");
    let err = register(&mut env, MIN_PRICE, u64::MAX).err().unwrap();
    assert!(err.contains("InvalidAmount"), "{err}");

    // O mesmo agent_id não registra duas vezes (init), e a falha não mexe no stake nem no saldo.
    let first = register(&mut env, 12 * USDC, 0).unwrap();
    let id = env.account::<Agent>(&first.key).agent_id;
    let err = register_with(&mut env, 12 * USDC, 0, |a| a.agent_id = id).err().unwrap();
    assert!(err.contains("already in use"), "{err}");
    assert_eq!(env.account::<Agent>(&first.key).creator, first.creator.pubkey());
    assert_eq!(env.account::<Agent>(&first.key).status, AgentStatus::Pending);

    // Stake maior que o saldo do criador: a transferência falha e nenhum solver nasce.
    env.update_min_stake(1_000 * USDC);
    let err = register(&mut env, 12 * USDC, 0).err().unwrap();
    assert!(err.contains("insufficient funds"), "{err}");
}

#[test]
fn update_version_resets_eval_and_enforces_creator_and_length() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (creator, verifier, admin) = (agent.creator.insecure_clone(), verifier_kp(&env), admin_kp(&env));
    env.send(set_eval_ix(&verifier.pubkey(), &agent, 9_000, [8; 32]), &[&verifier]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).eval_score_bps, 9_000);

    let logs = env.send_logs(update_version_ix(&creator.pubkey(), &agent, "2.0.0", [4; 32]), &[&creator]).unwrap();
    let evs = events::<solvers::events::AgentVersionUpdated>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].agent, evs[0].version.as_str(), evs[0].version_hash), (agent.key, "2.0.0", [4; 32]));
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.version.as_str(), a.version_hash), ("2.0.0", [4; 32]));
    // A nota de desempenho valia só para a versão anterior.
    assert_eq!((a.eval_score_bps, a.eval_hash), (0, [0; 32]));
    // Preço, stake e status não mudam.
    assert_eq!((a.price, a.status), (12 * USDC, AgentStatus::Active));

    // Só o criador do solver: nem o admin nem outro criador.
    let other = register(&mut env, 12 * USDC, 0).unwrap();
    for signer in [&admin, &other.creator] {
        let err = env.send(update_version_ix(&signer.pubkey(), &agent, "9.9.9", [1; 32]), &[signer]).unwrap_err();
        assert!(err.contains("NotCreator"), "{err}");
    }
    assert_eq!(env.account::<Agent>(&agent.key).version, "2.0.0");

    // Limite: 16 bytes passam (também vazio e multibyte), 17 não.
    let (max_ascii, max_multibyte) = ("v".repeat(MAX_VERSION_LEN), "é".repeat(8));
    for ok in ["", max_ascii.as_str(), max_multibyte.as_str()] {
        env.send(update_version_ix(&creator.pubkey(), &agent, ok, [1; 32]), &[&creator]).unwrap();
        assert_eq!(env.account::<Agent>(&agent.key).version, ok);
    }
    for bad in ["v".repeat(MAX_VERSION_LEN + 1), "é".repeat(9)] {
        let err = env.send(update_version_ix(&creator.pubkey(), &agent, &bad, [1; 32]), &[&creator]).unwrap_err();
        assert!(err.contains("StringTooLong"), "{err}");
    }
}

#[test]
fn set_eval_only_verifier_and_score_bounds() {
    let mut env = Env::new();
    // Funciona em qualquer status (aqui, ainda pendente).
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let (creator, verifier, admin, usage) = (agent.creator.insecure_clone(), verifier_kp(&env), admin_kp(&env), usage_kp(&env));

    let logs = env.send_logs(set_eval_ix(&verifier.pubkey(), &agent, 8_765, [6; 32]), &[&verifier]).unwrap();
    let evs = events::<solvers::events::EvalUpdated>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].agent, evs[0].score_bps, evs[0].eval_hash), (agent.key, 8_765, [6; 32]));
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.eval_score_bps, a.eval_hash), (8_765, [6; 32]));

    // Os dois extremos válidos.
    for bps in [0, MAX_BPS] {
        env.send(set_eval_ix(&verifier.pubkey(), &agent, bps, [1; 32]), &[&verifier]).unwrap();
        assert_eq!(env.account::<Agent>(&agent.key).eval_score_bps, bps);
    }
    // Acima de 100%: recusado e a nota anterior fica.
    for bps in [MAX_BPS + 1, u16::MAX] {
        let err = env.send(set_eval_ix(&verifier.pubkey(), &agent, bps, [2; 32]), &[&verifier]).unwrap_err();
        assert!(err.contains("InvalidBps"), "{bps}: {err}");
    }
    assert_eq!(env.account::<Agent>(&agent.key).eval_score_bps, MAX_BPS);

    // Só o verificador: admin, criador e usage authority são recusados.
    for signer in [&admin, &creator, &usage] {
        let err = env.send(set_eval_ix(&signer.pubkey(), &agent, 5_000, [3; 32]), &[signer]).unwrap_err();
        assert!(err.contains("NotVerifier"), "{err}");
    }
    assert_eq!(env.account::<Agent>(&agent.key).eval_hash, [1; 32]);
}

#[test]
fn update_pricing_permissions_limits_and_effects_on_sales() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC);
    let (creator, admin) = (agent.creator.insecure_clone(), admin_kp(&env));
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);

    for signer in [&admin, &buyer] {
        let err = env.send(update_pricing_ix(&signer.pubkey(), &agent, 20 * USDC, 0), &[signer]).unwrap_err();
        assert!(err.contains("NotCreator"), "{err}");
    }
    // Abaixo do mínimo (0 e um a menos) e preço por uso acima do preço.
    for price in [0, MIN_PRICE - 1] {
        let err = env.send(update_pricing_ix(&creator.pubkey(), &agent, price, 0), &[&creator]).unwrap_err();
        assert!(err.contains("PriceTooLow"), "{price}: {err}");
    }
    for ppu in [MIN_PRICE + 1, u64::MAX] {
        let err = env.send(update_pricing_ix(&creator.pubkey(), &agent, MIN_PRICE, ppu), &[&creator]).unwrap_err();
        assert!(err.contains("InvalidAmount"), "{ppu}: {err}");
    }
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.price, a.price_per_use), (12 * USDC, USDC));

    // Limites aceitos: preço == mínimo com ppu == preço; depois u64::MAX.
    env.send(update_pricing_ix(&creator.pubkey(), &agent, MIN_PRICE, MIN_PRICE), &[&creator]).unwrap();
    env.send(update_pricing_ix(&creator.pubkey(), &agent, u64::MAX, u64::MAX), &[&creator]).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.price, a.price_per_use), (u64::MAX, u64::MAX));

    // O comprador que viu o preço antigo não paga o novo (PriceChanged), nem no pacote de créditos.
    let err = purchase_at(&mut env, &agent, &buyer, 12 * USDC).unwrap_err();
    assert!(err.contains("PriceChanged"), "{err}");
    let err = buy_credits(&mut env, &agent, &buyer, 1, 12 * USDC).unwrap_err();
    assert!(err.contains("PriceChanged"), "{err}");

    // Preço por uso 0 desliga os créditos.
    env.send(update_pricing_ix(&creator.pubkey(), &agent, 20 * USDC, 0), &[&creator]).unwrap();
    let err = buy_credits(&mut env, &agent, &buyer, 10, 100 * USDC).unwrap_err();
    assert!(err.contains("PayPerUseDisabled"), "{err}");
    purchase(&mut env, &agent, &buyer).unwrap();
    assert_eq!(env.balance(&env.treasury.clone()), 2 * USDC);
}

// --------------------------------------------------------------------------- uso e créditos ----

#[test]
fn record_usage_batch_authority_amount_and_overflow() {
    let mut env = Env::new();
    // Não exige solver ativo: aqui ele está pendente.
    let agent = register(&mut env, 12 * USDC, USDC).unwrap();
    let (usage, verifier, admin, creator) = (usage_kp(&env), verifier_kp(&env), admin_kp(&env), agent.creator.insecure_clone());

    let logs = env.send_logs(record_usage_ix(&usage.pubkey(), &agent, 7, [9; 32]), &[&usage]).unwrap();
    let evs = events::<solvers::events::UsageRecorded>(&logs);
    assert_eq!(evs.len(), 1);
    assert_eq!((evs[0].agent, evs[0].count, evs[0].merkle_root), (agent.key, 7, [9; 32]));
    env.send(record_usage_ix(&usage.pubkey(), &agent, 5, [1; 32]), &[&usage]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).verified_uses, 12);

    // Só a usage authority: nem o verificador, nem o admin, nem o criador.
    for signer in [&verifier, &admin, &creator] {
        let err = env.send(record_usage_ix(&signer.pubkey(), &agent, 1, [0; 32]), &[signer]).unwrap_err();
        assert!(err.contains("NotUsageAuthority"), "{err}");
    }
    // Contagem 0 não vale.
    let err = env.send(record_usage_ix(&usage.pubkey(), &agent, 0, [0; 32]), &[&usage]).unwrap_err();
    assert!(err.contains("InvalidAmount"), "{err}");
    assert_eq!(env.account::<Agent>(&agent.key).verified_uses, 12);

    // u64::MAX cabe (12 + (MAX - 12)); um a mais estoura sem mudar o contador.
    env.send(record_usage_ix(&usage.pubkey(), &agent, u64::MAX - 12, [0; 32]), &[&usage]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).verified_uses, u64::MAX);
    for count in [1, u64::MAX] {
        let err = env.send(record_usage_ix(&usage.pubkey(), &agent, count, [0; 32]), &[&usage]).unwrap_err();
        assert!(err.contains("MathOverflow"), "{count}: {err}");
    }
    assert_eq!(env.account::<Agent>(&agent.key).verified_uses, u64::MAX);
}

#[test]
fn consume_credit_authority_substitution_and_usage_counter_overflow() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let other = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 50 * USDC);
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    buy_credits(&mut env, &other, &buyer, 10, 5 * USDC).unwrap();
    let credits = credits_pda(&agent, &buyer.pubkey());
    let (usage, verifier, admin) = (usage_kp(&env), verifier_kp(&env), admin_kp(&env));

    for signer in [&verifier, &admin, &buyer] {
        let err = env.send(consume_ix(&signer.pubkey(), &agent, credits), &[signer]).unwrap_err();
        assert!(err.contains("NotUsageAuthority"), "{err}");
    }
    // Créditos de outro solver (mesmo dono) não servem para este: as seeds amarram agente e dono.
    let err = env
        .send(consume_ix(&usage.pubkey(), &agent, credits_pda(&other, &buyer.pubkey())), &[&usage])
        .unwrap_err();
    assert!(err.contains("ConstraintSeeds") || err.contains("ConstraintHasOne"), "{err}");
    // Uma conta de outro tipo no lugar dos créditos: discriminador não confere.
    let err = env.send(consume_ix(&usage.pubkey(), &agent, rep_pda(&buyer.pubkey())), &[&usage]).unwrap_err();
    assert!(err.contains("AccountDiscriminatorMismatch"), "{err}");
    assert_eq!(env.account::<Credits>(&credits).remaining, 10);

    // Consumo normal e contador de usos verificados no teto: consumir estoura e nada muda.
    env.send(consume_ix(&usage.pubkey(), &agent, credits), &[&usage]).unwrap();
    env.send(record_usage_ix(&usage.pubkey(), &agent, u64::MAX - 1, [0; 32]), &[&usage]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).verified_uses, u64::MAX);
    let err = env.send(consume_ix(&usage.pubkey(), &agent, credits), &[&usage]).unwrap_err();
    assert!(err.contains("MathOverflow"), "{err}");
    let c: Credits = env.account(&credits);
    assert_eq!((c.remaining, c.purchased), (9, 10));
}

#[test]
fn buy_credits_errors_limits_and_accumulation() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 100 * USDC);
    let treasury = env.treasury;

    // Quantidade 0.
    let err = buy_credits(&mut env, &agent, &buyer, 0, 5 * USDC).unwrap_err();
    assert!(err.contains("InvalidAmount"), "{err}");
    // Pacote um centavo abaixo do mínimo (9 x 0,50 = 4,50) e exatamente no mínimo (10 x 0,50 = 5).
    let err = buy_credits(&mut env, &agent, &buyer, 9, 100 * USDC).unwrap_err();
    assert!(err.contains("PriceTooLow"), "{err}");
    // Teto de preço: total - 1 e 0 falham; total passa.
    for max in [0, 5 * USDC - 1] {
        let err = buy_credits(&mut env, &agent, &buyer, 10, max).unwrap_err();
        assert!(err.contains("PriceChanged"), "{max}: {err}");
    }
    assert!(env.svm.get_account(&credits_pda(&agent, &buyer.pubkey())).is_none());
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, u64::MAX).unwrap();
    let c: Credits = env.account(&credits_pda(&agent, &buyer.pubkey()));
    assert_eq!((c.remaining, c.purchased, c.owner, c.agent), (20, 20, buyer.pubkey(), agent.key));
    assert_eq!(env.account::<UserReputation>(&rep_pda(&buyer.pubkey())).purchases, 2);
    // Cada pacote: 10% para a tesouraria e 90% para o criador.
    assert_eq!(env.balance(&buyer_usdc), 90 * USDC);
    assert_eq!(env.balance(&treasury), USDC);
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);

    // Solver ainda pendente e solver sem pagamento por uso.
    let pending = register(&mut env, 12 * USDC, USDC).unwrap();
    let err = buy_credits(&mut env, &pending, &buyer, 10, 100 * USDC).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
    let flat = active_agent(&mut env, 12 * USDC, 0);
    let err = buy_credits(&mut env, &flat, &buyer, 10, 100 * USDC).unwrap_err();
    assert!(err.contains("PayPerUseDisabled"), "{err}");

    // Contas trocadas: criador de outro solver e programa de token falso.
    let mut ix = buy_credits_ix(&env, &agent, &buyer.pubkey(), 10, 5 * USDC);
    swap_account(&mut ix, &agent.creator_usdc, flat.creator_usdc);
    let err = env.send(ix, &[&buyer]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    let mut ix = buy_credits_ix(&env, &agent, &buyer.pubkey(), 10, 5 * USDC);
    swap_account(&mut ix, &spl_token::ID, unique_key());
    let err = env.send(ix, &[&buyer]).unwrap_err();
    assert!(err.contains("InvalidProgramId"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 90 * USDC);
}

#[test]
fn buy_credits_math_overflow_points() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC);
    let creator = agent.creator.insecure_clone();
    let (rich, rich_usdc) = new_buyer(&mut env, 10_000 * USDC);

    // preço por uso x quantidade estoura u64: price_per_use = u64::MAX com 2 pacotes (e com u32::MAX).
    env.send(update_pricing_ix(&creator.pubkey(), &agent, u64::MAX, u64::MAX), &[&creator]).unwrap();
    for amount in [2, 1_000, u32::MAX] {
        let err = buy_credits(&mut env, &agent, &rich, amount, u64::MAX).unwrap_err();
        assert!(err.contains("MathOverflow"), "{amount}: {err}");
    }
    // Um pacote custa u64::MAX: o cálculo passa e a transferência falha por saldo (não por overflow).
    let err = buy_credits(&mut env, &agent, &rich, 1, u64::MAX).unwrap_err();
    assert!(err.contains("insufficient funds") && !err.contains("MathOverflow"), "{err}");

    // Saldo de créditos u32 estoura: 1 micro-USDC por crédito, u32::MAX créditos (4.294,97 USDC).
    env.send(update_pricing_ix(&creator.pubkey(), &agent, 12 * USDC, 1), &[&creator]).unwrap();
    buy_credits(&mut env, &agent, &rich, u32::MAX, u64::MAX).unwrap();
    let c: Credits = env.account(&credits_pda(&agent, &rich.pubkey()));
    assert_eq!((c.remaining, c.purchased), (u32::MAX, u32::MAX));
    let balance = env.balance(&rich_usdc);
    // Qualquer pacote acima do mínimo agora estoura `remaining`, e nada é cobrado.
    for amount in [5_000_000, u32::MAX] {
        let err = buy_credits(&mut env, &agent, &rich, amount, u64::MAX).unwrap_err();
        assert!(err.contains("MathOverflow"), "{amount}: {err}");
    }
    assert_eq!(env.balance(&rich_usdc), balance);
    let c: Credits = env.account(&credits_pda(&agent, &rich.pubkey()));
    assert_eq!((c.remaining, c.purchased), (u32::MAX, u32::MAX));
}

// -------------------------------------------------------------------------------- avaliações ----

fn review_pda(agent: &TestAgent, author: &Pubkey) -> Pubkey {
    pda(&[REVIEW_SEED, agent.key.as_ref(), author.as_ref()])
}

#[test]
fn review_rating_bounds_license_validation_and_aggregation() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let other = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    let asset = purchase(&mut env, &agent, &buyer).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();

    // Nota 0, 6 e 255: recusadas nos dois caminhos e nenhuma avaliação nasce.
    for rating in [0, 6, 255] {
        let err = review_with_license(&mut env, &agent, &buyer, asset, rating).unwrap_err();
        assert!(err.contains("InvalidRating"), "licença {rating}: {err}");
        let err = review_with_credits(&mut env, &agent, &buyer, rating).unwrap_err();
        assert!(err.contains("InvalidRating"), "créditos {rating}: {err}");
    }
    assert!(env.svm.get_account(&review_pda(&agent, &buyer.pubkey())).is_none());
    assert!(env.svm.get_account(&pda(&[LICENSE_REVIEW_SEED, asset.as_ref()])).is_none());
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (0, 0));

    // Extremos válidos: 5 e depois 1 pela licença; 3 pelos créditos edita a mesma avaliação (uma por carteira).
    review_with_license(&mut env, &agent, &buyer, asset, 5).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (5, 1));
    review_with_license(&mut env, &agent, &buyer, asset, 1).unwrap();
    review_with_credits(&mut env, &agent, &buyer, 3).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (3, 1));
    assert_eq!(env.account::<Review>(&review_pda(&agent, &buyer.pubkey())).rating, 3);

    // Licença de OUTRO solver não prova nada para este.
    let (b2, _) = new_buyer(&mut env, 100 * USDC);
    let foreign = purchase(&mut env, &other, &b2).unwrap();
    let err = review_with_license(&mut env, &agent, &b2, foreign, 5).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");
    // Conta que não é do mpl-core (aqui, a ATA de USDC) e conta do mpl-core que não é um asset (a coleção).
    let b2_ata = env.ata(&b2.pubkey());
    let err = review_with_license(&mut env, &agent, &b2, b2_ata, 5).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");
    let err = review_with_license(&mut env, &agent, &b2, agent.collection, 5).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");
    // Conta do mpl-core que diz ser um asset mas está truncada: InvalidLicenseAccount.
    let broken = unique_key();
    env.svm
        .set_account(
            broken,
            solana_account::Account {
                lamports: 1_000_000,
                data: vec![mpl_core::types::Key::AssetV1 as u8, 0, 0, 0],
                owner: mpl_core::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let err = review_with_license(&mut env, &agent, &b2, broken, 5).unwrap_err();
    assert!(err.contains("InvalidLicenseAccount"), "{err}");
    // Sem créditos nem licença: sem conta de créditos, nada a provar.
    let err = review_with_credits(&mut env, &agent, &b2, 5).unwrap_err();
    assert!(err.contains("AccountNotInitialized") || err.contains("NoLicense"), "{err}");

    // Quem passou a licença adiante deixa de poder avaliar; o novo dono avalia.
    let friend = new_keypair();
    transfer_asset(&mut env, foreign, other.collection, &b2, friend.pubkey());
    let err = review_with_license(&mut env, &other, &b2, foreign, 4).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");
    review_with_license(&mut env, &other, &friend, foreign, 4).unwrap();

    // Agregação com três autores e edições: soma e contagem acompanham.
    let (b3, _) = new_buyer(&mut env, 100 * USDC);
    let asset3 = purchase(&mut env, &agent, &b3).unwrap();
    review_with_license(&mut env, &agent, &b3, asset3, 4).unwrap();
    let (b4, _) = new_buyer(&mut env, 100 * USDC);
    buy_credits(&mut env, &agent, &b4, 10, 5 * USDC).unwrap();
    review_with_credits(&mut env, &agent, &b4, 5).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (3 + 4 + 5, 3));
    review_with_credits(&mut env, &agent, &b4, 1).unwrap();
    review_with_license(&mut env, &agent, &buyer, asset, 5).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (5 + 4 + 1, 3));
}

// ------------------------------------------------------------------------------- compra ----

#[test]
fn purchase_rejects_swapped_accounts_bad_funds_and_fake_programs() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let other = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 50 * USDC);
    let (poor, _) = new_buyer(&mut env, USDC);
    let (thief, thief_usdc) = new_buyer(&mut env, 50 * USDC);
    let treasury = env.treasury;
    let price = 12 * USDC;

    // Preço esperado 0 e u64::MAX nunca casam com o preço do solver.
    for expected in [0, u64::MAX, price - 1, price + 1] {
        let err = purchase_at(&mut env, &agent, &buyer, expected).unwrap_err();
        assert!(err.contains("PriceChanged"), "{expected}: {err}");
    }

    let run = |env: &mut Env, tweak: &dyn Fn(&mut Instruction)| -> String {
        let asset = new_keypair();
        let mut ix = purchase_ix(env, &agent, &buyer.pubkey(), &asset.pubkey(), price);
        tweak(&mut ix);
        env.send(ix, &[&buyer, &asset]).unwrap_err()
    };
    // Tesouro, conta do criador, coleção e mint trocados.
    let wrong_treasury = env.token_account(&unique_key(), 0);
    let err = run(&mut env, &|ix| swap_account(ix, &treasury, wrong_treasury));
    assert!(err.contains("ConstraintHasOne"), "tesouro: {err}");
    let err = run(&mut env, &|ix| swap_account(ix, &agent.creator_usdc, other.creator_usdc));
    assert!(err.contains("ConstraintHasOne"), "criador: {err}");
    let err = run(&mut env, &|ix| swap_account(ix, &agent.collection, other.collection));
    assert!(err.contains("ConstraintHasOne"), "coleção: {err}");
    let fake_mint = unique_key();
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint { mint_authority: None.into(), supply: 0, decimals: 6, is_initialized: true, freeze_authority: None.into() }
        .pack_into_slice(&mut data);
    env.set_token_program_account(fake_mint, data);
    let mint = env.mint;
    let err = run(&mut env, &|ix| swap_account(ix, &mint, fake_mint));
    assert!(err.contains("ConstraintHasOne") || err.contains("ConstraintTokenMint"), "mint: {err}");
    // Pagar com a conta de USDC de outra pessoa (a assinatura é do comprador, o dono da conta é o ladrão).
    let err = run(&mut env, &|ix| swap_account(ix, &buyer_usdc, thief_usdc));
    assert!(err.contains("ConstraintTokenOwner"), "conta alheia: {err}");
    // Programas falsos: token, mpl-core e system.
    let err = run(&mut env, &|ix| swap_account(ix, &spl_token::ID, unique_key()));
    assert!(err.contains("InvalidProgramId"), "token: {err}");
    let err = run(&mut env, &|ix| swap_account(ix, &mpl_core::ID, unique_key()));
    assert!(err.contains("ConstraintAddress"), "mpl-core: {err}");
    let err = run(&mut env, &|ix| swap_account(ix, &system_program::ID, unique_key()));
    assert!(err.contains("InvalidProgramId"), "system: {err}");
    // O asset precisa assinar (senão qualquer endereço existente seria "criado").
    let asset = new_keypair();
    let mut ix = purchase_ix(&env, &agent, &buyer.pubkey(), &asset.pubkey(), price);
    unsign(&mut ix, &asset.pubkey());
    assert!(env.send(ix, &[&buyer]).is_err());
    let _ = &thief;

    // Saldo insuficiente.
    let err = purchase(&mut env, &agent, &poor).unwrap_err();
    assert!(err.contains("insufficient funds"), "{err}");

    // Nada disso moveu dinheiro nem criou reputação/vendas.
    assert_eq!(env.balance(&buyer_usdc), 50 * USDC);
    assert_eq!((env.balance(&treasury), env.balance(&agent.creator_usdc)), (0, 100 * USDC));
    assert!(env.svm.get_account(&rep_pda(&buyer.pubkey())).is_none());
    assert_eq!(env.account::<Agent>(&agent.key).total_sales, 0);
}

#[test]
fn fee_split_rounding_zero_fee_and_u64_max_conserve_funds() {
    let mut env = Env::new();
    let treasury = env.treasury;

    // Preço que não divide por 10: a taxa arredonda para baixo e o resto fica com o criador.
    let a1 = active_agent(&mut env, 5_000_009, 0);
    let (b1, _) = new_buyer(&mut env, 50 * USDC);
    purchase(&mut env, &a1, &b1).unwrap();
    assert_eq!(env.balance(&treasury), 500_000);
    assert_eq!(env.balance(&a1.creator_usdc), 100 * USDC + 4_500_009);

    // Taxa 0%: a tesouraria não recebe nada (transferência de 0 é pulada) e o criador recebe tudo.
    env.update_fee(0).unwrap();
    purchase(&mut env, &a1, &b1).unwrap();
    assert_eq!(env.balance(&treasury), 500_000);
    assert_eq!(env.balance(&a1.creator_usdc), 100 * USDC + 4_500_009 + 5_000_009);
    let escrow = create_escrow(&mut env, &a1, &b1, &[10 * USDC]).unwrap();
    release(&mut env, &a1, &escrow, &b1, 0).unwrap();
    assert_eq!(env.balance(&treasury), 500_000);
    assert_eq!(env.balance(&a1.creator_usdc), 100 * USDC + 4_500_009 + 5_000_009 + 10 * USDC);

    // u64::MAX com taxa de 20%: o cálculo é em u128, nada estoura e a soma bate para a conta.
    env.update_fee(2_000).unwrap();
    let fee = (u64::MAX as u128 * 2_000 / 10_000) as u64;
    let a2 = active_agent(&mut env, u64::MAX, 0);
    let (rich, rich_usdc) = new_buyer(&mut env, u64::MAX);
    let before = env.balance(&treasury);
    purchase(&mut env, &a2, &rich).unwrap();
    assert_eq!(env.balance(&rich_usdc), 0);
    assert_eq!(env.balance(&treasury), before + fee);
    assert_eq!(env.balance(&a2.creator_usdc), 100 * USDC + (u64::MAX - fee));

    // Mesma conta numa garantia de u64::MAX: cofre cheio, liberação divide, cofre zera.
    let a3 = active_agent(&mut env, 12 * USDC, 0);
    let (rich2, rich2_usdc) = new_buyer(&mut env, u64::MAX);
    let before = env.balance(&treasury);
    let escrow = create_escrow(&mut env, &a3, &rich2, &[u64::MAX]).unwrap();
    assert_eq!((env.balance(&rich2_usdc), env.balance(&escrow.vault)), (0, u64::MAX));
    assert_eq!(env.account::<Escrow>(&escrow.key).total, u64::MAX);
    release(&mut env, &a3, &escrow, &rich2, 0).unwrap();
    assert_eq!(env.balance(&escrow.vault), 0);
    assert_eq!(env.balance(&treasury), before + fee);
    assert_eq!(env.balance(&a3.creator_usdc), 100 * USDC + (u64::MAX - fee));
}

// ------------------------------------------------------------------------------- garantia ----

const MAX_REVIEW_WINDOW_SECS: i64 = 30 * 24 * 3600;

#[test]
fn create_escrow_milestone_count_amounts_and_totals() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 1_000 * USDC);
    let new = |env: &mut Env, nonce: u64, amounts: &[u64]| create_escrow_full(env, &agent, &buyer, nonce, amounts, REVIEW_WINDOW, 0);

    // Número de etapas: 0 e 6 recusados; 1 e 5 aceitos.
    let err = new(&mut env, 1, &[]).err().unwrap();
    assert!(err.contains("InvalidMilestones"), "{err}");
    let err = new(&mut env, 1, &[USDC; MAX_MILESTONES + 1]).err().unwrap();
    assert!(err.contains("InvalidMilestones"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 1_000 * USDC);

    let five = new(&mut env, 1, &[USDC; MAX_MILESTONES]).unwrap();
    let e: Escrow = env.account(&five.key);
    assert_eq!((e.milestones.len(), e.total, e.status), (MAX_MILESTONES, 5 * USDC, EscrowStatus::Active));
    assert!(e.milestones.iter().all(|m| m.status == MilestoneStatus::Pending && m.amount == USDC));
    assert_eq!(env.balance(&five.vault), 5 * USDC);

    // Etapa de valor 0 em qualquer posição.
    for amounts in [&[0][..], &[5 * USDC, 0], &[0, 5 * USDC]] {
        let err = new(&mut env, 2, amounts).err().unwrap();
        assert!(err.contains("InvalidAmount"), "{amounts:?}: {err}");
    }
    // Total um abaixo do mínimo recusa; exatamente o mínimo passa.
    let err = new(&mut env, 2, &[MIN_PRICE - 1]).err().unwrap();
    assert!(err.contains("PriceTooLow"), "{err}");
    let err = new(&mut env, 2, &[MIN_PRICE / 2, MIN_PRICE / 2 - 1]).err().unwrap();
    assert!(err.contains("PriceTooLow"), "{err}");
    new(&mut env, 2, &[MIN_PRICE]).unwrap();

    // Soma das etapas estoura u64: recusado antes de qualquer transferência.
    for amounts in [&[u64::MAX, 1][..], &[1, u64::MAX], &[u64::MAX, u64::MAX], &[u64::MAX / 2 + 1, u64::MAX / 2 + 1]] {
        let err = new(&mut env, 3, amounts).err().unwrap();
        assert!(err.contains("MathOverflow"), "{amounts:?}: {err}");
    }
    // Uma etapa de u64::MAX não estoura, mas o comprador não tem o saldo.
    let err = new(&mut env, 3, &[u64::MAX]).err().unwrap();
    assert!(err.contains("insufficient funds"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 1_000 * USDC - 5 * USDC - MIN_PRICE);
}

#[test]
fn create_escrow_review_window_delivery_days_and_eligibility_bounds() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, _) = new_buyer(&mut env, 1_000 * USDC);
    let mut nonce = 0;

    // Janela de revisão: 59 s e 30 dias + 1 s fora; 0, negativos e extremos de i64 também.
    for window in [i64::MIN, -1, 0, 59, MAX_REVIEW_WINDOW_SECS + 1, i64::MAX] {
        nonce += 1;
        let err = create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], window, 0).err().unwrap();
        assert!(err.contains("InvalidReviewWindow"), "{window}: {err}");
    }
    // 60 s e 30 dias exatos entram, e a janela fica gravada.
    for window in [60, MAX_REVIEW_WINDOW_SECS] {
        nonce += 1;
        let e = create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], window, 0).unwrap();
        assert_eq!(env.account::<Escrow>(&e.key).review_window_secs, window);
    }
    // Prazo de entrega acima de 60 dias, inclusive u16::MAX.
    for days in [MAX_DELIVERY_DAYS + 1, 1_000, u16::MAX] {
        nonce += 1;
        let err = create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], REVIEW_WINDOW, days).err().unwrap();
        assert!(err.contains("InvalidDeliveryDays"), "{days}: {err}");
    }
    // Um dia (mínimo explícito) fica gravado.
    nonce += 1;
    let now = current_time(&env);
    let e = create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], REVIEW_WINDOW, 1).unwrap();
    assert_eq!(env.account::<Escrow>(&e.key).delivery_deadline, now + 86_400);

    // Elegibilidade: com 2 disputas perdidas ainda cria; com 3 não.
    let rep = rep_pda(&buyer.pubkey());
    write_account::<UserReputation>(&mut env, &rep, |r| r.disputes_lost = MAX_BUYER_DISPUTES_LOST - 1);
    nonce += 1;
    create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], REVIEW_WINDOW, 0).unwrap();
    write_account::<UserReputation>(&mut env, &rep, |r| r.disputes_lost = MAX_BUYER_DISPUTES_LOST);
    nonce += 1;
    let err = create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("BuyerNotEligible"), "{err}");
    write_account::<UserReputation>(&mut env, &rep, |r| r.disputes_lost = u32::MAX);
    let err = create_escrow_full(&mut env, &agent, &buyer, nonce, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("BuyerNotEligible"), "{err}");
}

#[test]
fn create_escrow_rejects_inactive_agent_reused_nonce_and_missing_funds() {
    let mut env = Env::new();
    let pending = register(&mut env, 12 * USDC, 0).unwrap();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 12 * USDC);

    let err = create_escrow_full(&mut env, &pending, &buyer, 1, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("AgentNotActive"), "{err}");

    // Saldo menor que o total: falha e não sobra escrow nem cobrança.
    let err = create_escrow_full(&mut env, &agent, &buyer, 1, &[10 * USDC, 10 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("insufficient funds"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 12 * USDC);

    // O mesmo nonce não cria duas garantias (init), mas outro nonce cria; os endereços são distintos.
    let first = create_escrow_full(&mut env, &agent, &buyer, 7, &[5 * USDC], REVIEW_WINDOW, 0).unwrap();
    let err = create_escrow_full(&mut env, &agent, &buyer, 7, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("already in use"), "{err}");
    assert_eq!(env.account::<Escrow>(&first.key).total, 5 * USDC);
    let second = create_escrow_full(&mut env, &agent, &buyer, u64::MAX, &[5 * USDC], REVIEW_WINDOW, 0).unwrap();
    assert_ne!(first.key, second.key);
    assert_eq!(env.account::<Escrow>(&second.key).nonce, u64::MAX);
    assert_eq!(env.balance(&buyer_usdc), 2 * USDC);
}

/// O relógio perto de i64::MAX: os somas com `checked_add` devolvem MathOverflow em vez de dar a volta.
#[test]
fn escrow_time_arithmetic_near_i64_max() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 100 * USDC);

    // now + 1 dia passa de i64::MAX por 1 segundo: delivery_deadline estoura.
    set_time(&mut env, i64::MAX - 86_400 + 1);
    let err = create_escrow_full(&mut env, &agent, &buyer, 1, &[10 * USDC], REVIEW_WINDOW, 1).err().unwrap();
    assert!(err.contains("MathOverflow"), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 100 * USDC);

    // Um segundo antes cabe exatamente: o prazo é i64::MAX.
    set_time(&mut env, i64::MAX - 86_400);
    let escrow = create_escrow_full(&mut env, &agent, &buyer, 1, &[10 * USDC, 10 * USDC], REVIEW_WINDOW, 1).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow.key).delivery_deadline, i64::MAX);

    // Disputa aberta nesse horário: disputed_at + 7 dias estoura no resgate automático.
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    let keeper = new_keypair();
    let err = stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("MathOverflow"), "{err}");
    assert_eq!(env.balance(&escrow.vault), 20 * USDC);
    assert_eq!(env.account::<Escrow>(&escrow.key).milestones[0].status, MilestoneStatus::Disputed);

    // mark_passed soma `now + review_window` sem checked_*: com o relógio em i64::MAX a transação aborta
    // (overflow-checks do perfil release) e a etapa continua Pending. Só acontece com relógio absurdo.
    warp(&mut env, 86_400);
    assert_eq!(current_time(&env), i64::MAX);
    let err = mark_passed(&mut env, &escrow, 1).unwrap_err();
    assert!(err.contains("attempt to add with overflow") || err.contains("MathOverflow"), "{err}");
    assert_eq!(env.account::<Escrow>(&escrow.key).milestones[1].status, MilestoneStatus::Pending);
}

#[test]
fn milestone_index_and_status_guards() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    set_time(&mut env, T0);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 100 * USDC);
    let (rival, _) = new_buyer(&mut env, 50 * USDC);
    purchase(&mut env, &agent, &rival).unwrap(); // dá reputação ao rival, para o teste de NotBuyer
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC, 5 * USDC]).unwrap();
    let (admin, verifier) = (admin_kp(&env), verifier_kp(&env));
    let (creator_usdc, treasury) = (agent.creator_usdc, env.treasury);

    // Índice fora da faixa em todas as instruções que recebem índice.
    for index in [3, 200, u8::MAX] {
        let err = mark_passed(&mut env, &escrow, index).unwrap_err();
        assert!(err.contains("InvalidMilestoneIndex"), "mark_passed {index}: {err}");
        let err = release(&mut env, &agent, &escrow, &buyer, index).unwrap_err();
        assert!(err.contains("InvalidMilestoneIndex"), "release {index}: {err}");
        let err = dispute(&mut env, &escrow, &buyer, index).unwrap_err();
        assert!(err.contains("InvalidMilestoneIndex"), "open_dispute {index}: {err}");
        let err = resolve(&mut env, &agent, &escrow, &buyer.pubkey(), index, true).unwrap_err();
        assert!(err.contains("InvalidMilestoneIndex"), "resolve {index}: {err}");
    }

    // Etapa 0: entregue uma vez só; aprovada uma vez só (sem pagamento em dobro).
    mark_passed(&mut env, &escrow, 0).unwrap();
    let err = mark_passed(&mut env, &escrow, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();
    let paid = env.balance(&creator_usdc);
    let vault_left = env.balance(&escrow.vault);
    let keeper = new_keypair();
    warp(&mut env, REVIEW_WINDOW + 1);
    for caller in [&buyer, &keeper] {
        let err = release(&mut env, &agent, &escrow, caller, 0).unwrap_err();
        assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    }
    assert_eq!((env.balance(&creator_usdc), env.balance(&escrow.vault)), (paid, vault_left));
    // Etapa aprovada: não entrega de novo nem se contesta.
    let err = mark_passed(&mut env, &escrow, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = dispute(&mut env, &escrow, &buyer, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Só o comprador abre disputa; e com a reputação dele, não a de outro.
    let err = env.send(dispute_ix(&rival.pubkey(), &escrow, 1), &[&rival]).unwrap_err();
    assert!(err.contains("NotBuyer"), "{err}");
    let mut ix = dispute_ix(&buyer.pubkey(), &escrow, 1);
    swap_account(&mut ix, &rep_pda(&buyer.pubkey()), rep_pda(&rival.pubkey()));
    let err = env.send(ix, &[&buyer]).unwrap_err();
    assert!(err.contains("ConstraintSeeds"), "{err}");

    // Etapa 1 contestada: não segue o caminho feliz, nem entrega, nem nova contestação.
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    assert_eq!(env.account::<UserReputation>(&rep_pda(&buyer.pubkey())).disputes_opened, 1);
    for caller in [&buyer, &keeper] {
        let err = release(&mut env, &agent, &escrow, caller, 1).unwrap_err();
        assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    }
    let err = mark_passed(&mut env, &escrow, 1).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = dispute(&mut env, &escrow, &buyer, 1).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Resolver exige etapa Disputed (a 2 é Pending) e as contas certas.
    let err = resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 2, true).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let mut ix = resolve_ix(&env, &agent, &escrow, &admin.pubkey(), &buyer.pubkey(), 1, true);
    swap_account(&mut ix, &rep_pda(&buyer.pubkey()), rep_pda(&rival.pubkey()));
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintSeeds"), "{err}");
    let other = active_agent(&mut env, 12 * USDC, 0);
    let mut ix = resolve_ix(&env, &agent, &escrow, &admin.pubkey(), &buyer.pubkey(), 1, false);
    swap_account(&mut ix, &creator_usdc, other.creator_usdc);
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    let mut ix = resolve_ix(&env, &agent, &escrow, &admin.pubkey(), &buyer.pubkey(), 1, false);
    swap_account(&mut ix, &treasury, other.creator_usdc);
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    // O verificador não resolve disputa (papel é do admin).
    let ix = resolve_ix(&env, &agent, &escrow, &verifier.pubkey(), &buyer.pubkey(), 1, true);
    let err = env.send(ix, &[&verifier]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");

    // Fechar exige escrow encerrado: Active e Disputed não fecham.
    let payer = env.payer.insecure_clone();
    let err = close(&mut env, &escrow, &buyer.pubkey(), &payer).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Etapa reembolsada pelo admin: não se contesta, entrega ou libera depois.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 1, true).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 100 * USDC - 15 * USDC + 5 * USDC);
    let err = dispute(&mut env, &escrow, &buyer, 1).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = release(&mut env, &agent, &escrow, &buyer, 1).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = mark_passed(&mut env, &escrow, 1).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let err = close(&mut env, &escrow, &buyer.pubkey(), &payer).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");
    let _ = verifier;
}

#[test]
fn escrow_account_substitution_and_type_cosplay_are_rejected() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let other = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[10 * USDC, 10 * USDC]).unwrap();
    let treasury = env.treasury;
    let payer = env.payer.insecure_clone();

    let tamper = |env: &mut Env, f: &dyn Fn(&mut Instruction)| -> String {
        let mut ix = release_ix(env, &agent, &escrow, &buyer.pubkey(), 0);
        f(&mut ix);
        env.send(ix, &[&buyer]).unwrap_err()
    };
    let err = tamper(&mut env, &|ix| swap_account(ix, &agent.creator_usdc, other.creator_usdc));
    assert!(err.contains("ConstraintHasOne"), "criador: {err}");
    let wrong_treasury = env.token_account(&unique_key(), 0);
    let err = tamper(&mut env, &|ix| swap_account(ix, &treasury, wrong_treasury));
    assert!(err.contains("ConstraintHasOne"), "tesouro: {err}");
    // Outro solver (com a conta de criador dele) no lugar do solver da garantia.
    let err = tamper(&mut env, &|ix| {
        swap_account(ix, &agent.key, other.key);
        swap_account(ix, &agent.creator_usdc, other.creator_usdc);
    });
    assert!(err.contains("ConstraintHasOne"), "solver: {err}");
    let err = tamper(&mut env, &|ix| swap_account(ix, &spl_token::ID, unique_key()));
    assert!(err.contains("InvalidProgramId"), "token: {err}");
    // Cofre de outro escrow no lugar do cofre: a seed do cofre amarra o escrow.
    let (b2, _) = new_buyer(&mut env, 50 * USDC);
    let escrow2 = create_escrow(&mut env, &agent, &b2, &[10 * USDC]).unwrap();
    let err = tamper(&mut env, &|ix| swap_account(ix, &escrow.vault, escrow2.vault));
    assert!(err.contains("ConstraintSeeds"), "cofre: {err}");
    assert_eq!((env.balance(&escrow.vault), env.balance(&escrow2.vault)), (20 * USDC, 10 * USDC));

    // Type cosplay: conta de outro tipo no lugar do escrow / da config / do solver.
    let verifier = verifier_kp(&env);
    let err = env.send(mark_passed_ix(&verifier.pubkey(), agent.key, 0), &[&verifier]).unwrap_err();
    assert!(err.contains("AccountDiscriminatorMismatch"), "{err}");
    let admin = admin_kp(&env);
    let mut ix = status_ix(&admin.pubkey(), &agent, true);
    swap_account(&mut ix, &config_pda(), agent.key);
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("AccountDiscriminatorMismatch"), "{err}");
    let mut ix = set_eval_ix(&verifier.pubkey(), &agent, 1, [0; 32]);
    swap_account(&mut ix, &agent.key, config_pda());
    let err = env.send(ix, &[&verifier]).unwrap_err();
    assert!(err.contains("AccountDiscriminatorMismatch"), "{err}");

    // close_escrow: a conta que recebe o rent é a gravada no escrow (não a do chamador).
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();
    release(&mut env, &agent, &escrow, &buyer, 1).unwrap();
    let thief = unique_key();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CloseEscrow {
            caller: payer.pubkey(),
            rent_payer: thief,
            escrow: escrow.key,
            vault: escrow.vault,
            buyer_usdc: env.ata(&buyer.pubkey()),
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::CloseEscrow {}.data(),
    };
    let err = env.send(ix, &[&payer]).unwrap_err();
    assert!(err.contains("ConstraintAddress"), "{err}");
    // O destino de sobra tem que ser a ATA do comprador.
    let (_, stranger_usdc) = new_buyer(&mut env, 0);
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CloseEscrow {
            caller: payer.pubkey(),
            rent_payer: payer.pubkey(),
            escrow: escrow.key,
            vault: escrow.vault,
            buyer_usdc: stranger_usdc,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::CloseEscrow {}.data(),
    };
    let err = env.send(ix, &[&payer]).unwrap_err();
    assert!(err.contains("ConstraintAddress"), "{err}");
    close(&mut env, &escrow, &buyer.pubkey(), &payer).unwrap();
}

#[test]
fn escrow_deadlines_exact_second_boundaries() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, 0);
    set_time(&mut env, T0);
    let (buyer, _) = new_buyer(&mut env, 200 * USDC);
    let keeper = new_keypair();

    // Três etapas entregues no mesmo segundo; janela de revisão de 3.600 s.
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC, 5 * USDC]).unwrap();
    for i in 0..3 {
        mark_passed(&mut env, &escrow, i).unwrap();
    }
    let e: Escrow = env.account(&escrow.key);
    assert!(e.milestones.iter().all(|m| m.passed_at == T0));
    assert_eq!(e.auto_release_at, T0 + REVIEW_WINDOW);

    // Um segundo antes do fim da janela: terceiro não libera, comprador ainda contesta.
    warp(&mut env, REVIEW_WINDOW - 1);
    let err = release(&mut env, &agent, &escrow, &keeper, 0).unwrap_err();
    assert!(err.contains("AutoReleaseNotReached"), "{err}");
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    // No segundo exato (passed_at + janela): a contestação fecha e a liberação automática abre.
    warp(&mut env, 1);
    let err = dispute(&mut env, &escrow, &buyer, 2).unwrap_err();
    assert!(err.contains("DisputeWindowClosed"), "{err}");
    release(&mut env, &agent, &escrow, &keeper, 0).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow.key).milestones[0].status, MilestoneStatus::Approved);
    // O comprador ainda aprova depois da janela; a etapa contestada continua contestada.
    release(&mut env, &agent, &escrow, &buyer, 2).unwrap();
    let err = release(&mut env, &agent, &escrow, &keeper, 1).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Cada etapa tem a própria janela: entregar a etapa 1 depois não adia a liberação da etapa 0.
    let second = create_escrow_full(&mut env, &agent, &buyer, 2, &[5 * USDC, 5 * USDC], REVIEW_WINDOW, 0).unwrap();
    mark_passed(&mut env, &second, 0).unwrap();
    warp(&mut env, REVIEW_WINDOW / 2);
    mark_passed(&mut env, &second, 1).unwrap();
    warp(&mut env, REVIEW_WINDOW / 2);
    release(&mut env, &agent, &second, &keeper, 0).unwrap();
    let err = release(&mut env, &agent, &second, &keeper, 1).unwrap_err();
    assert!(err.contains("AutoReleaseNotReached"), "{err}");

    // Resgate de disputa parada: SLA e prazo de entrega vencem no mesmo segundo (7 dias).
    let third = create_escrow_full(&mut env, &agent, &buyer, 3, &[5 * USDC], REVIEW_WINDOW, 7).unwrap();
    dispute(&mut env, &third, &buyer, 0).unwrap();
    warp(&mut env, DISPUTE_SLA_SECS - 1);
    let err = stale(&mut env, &third, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("DisputeSlaNotReached"), "{err}");
    // No segundo exato do SLA o prazo de entrega (deadline) ainda vale: só depois dele reembolsa.
    warp(&mut env, 1);
    let err = stale(&mut env, &third, &keeper, &buyer.pubkey(), 0).unwrap_err();
    assert!(err.contains("DeliveryDeadlineNotReached"), "{err}");
    warp(&mut env, 1);
    stale(&mut env, &third, &keeper, &buyer.pubkey(), 0).unwrap();
    assert_eq!(env.account::<Escrow>(&third.key).status, EscrowStatus::Refunded);
}

// ------------------------------------------------------------- compra própria e duplicadas ----

/// Anchor 1.x recusa a mesma conta mutável duas vezes. Estes testes fixam o resultado das combinações
/// que a revisão listou: compra do próprio solver, tesouro igual à conta do criador e garantia
/// em que comprador e criador são a mesma carteira.
#[test]
fn self_dealing_and_shared_destination_accounts_hit_duplicate_mutable_check() {
    let mut env = Env::new();
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let creator = agent.creator.insecure_clone();
    let dup = "ConstraintDuplicateMutableAccount";

    // Criador compra o próprio solver (licença e créditos): buyer_usdc == creator_usdc.
    let asset = new_keypair();
    let ix = purchase_ix(&env, &agent, &creator.pubkey(), &asset.pubkey(), 12 * USDC);
    let err = env.send(ix, &[&creator, &asset]).unwrap_err();
    assert!(err.contains(dup), "{err}");
    let ix = buy_credits_ix(&env, &agent, &creator.pubkey(), 10, 5 * USDC);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains(dup), "{err}");
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC);

    // Tesouro igual à conta do criador (o admin aponta o tesouro para a ATA de um criador).
    let admin = admin_kp(&env);
    let old_treasury = env.treasury;
    env.send(set_treasury_ix(&env, &admin.pubkey(), agent.creator_usdc), &[&admin]).unwrap();
    env.treasury = agent.creator_usdc;
    let (buyer, buyer_usdc) = new_buyer(&mut env, 50 * USDC);
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains(dup), "{err}");
    assert_eq!(env.balance(&buyer_usdc), 50 * USDC);
    env.send(set_treasury_ix(&env, &admin.pubkey(), old_treasury), &[&admin]).unwrap();
    env.treasury = old_treasury;
    purchase(&mut env, &agent, &buyer).unwrap();

    // Garantia com comprador == criador: criar, entregar, aprovar e cancelar funcionam (não usam as duas
    // contas juntas), mas o admin não consegue julgar (buyer_usdc == creator_usdc) em nenhum sentido.
    set_time(&mut env, T0);
    let escrow = create_escrow_days(&mut env, &agent, &creator, &[5 * USDC, 5 * USDC, 5 * USDC], 7).unwrap();
    mark_passed(&mut env, &escrow, 0).unwrap();
    dispute(&mut env, &escrow, &creator, 0).unwrap();
    dispute(&mut env, &escrow, &creator, 1).unwrap();
    for refund in [true, false] {
        let err = resolve(&mut env, &agent, &escrow, &creator.pubkey(), 0, refund).unwrap_err();
        assert!(err.contains(dup), "{err}");
    }
    // A etapa nunca entregue sai pelo resgate automático; a entregue e contestada fica sem saída
    // (só afeta o dono da carteira, que é comprador e criador ao mesmo tempo).
    let keeper = new_keypair();
    warp(&mut env, 7 * 86_400 + 1);
    let err = stale(&mut env, &escrow, &keeper, &creator.pubkey(), 0).unwrap_err();
    assert!(err.contains("StaleDisputeNeedsJudgment"), "{err}");
    stale(&mut env, &escrow, &keeper, &creator.pubkey(), 1).unwrap();
    assert_eq!(env.account::<Escrow>(&escrow.key).milestones[1].status, MilestoneStatus::Refunded);
    cancel(&mut env, &escrow, &creator, 2).unwrap();
    assert_eq!(env.balance(&escrow.vault), 5 * USDC);
}

// --------------------------------------------------------------------------------- assinaturas ----

#[test]
fn every_authority_must_sign_not_just_be_named() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC]).unwrap();
    mark_passed(&mut env, &escrow, 1).unwrap();
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    let (admin, verifier, usage, creator) = (env.admin.pubkey(), env.verifier.pubkey(), env.usage.pubkey(), agent.creator.pubkey());
    let asset = new_keypair();
    let pending = register(&mut env, 12 * USDC, 0).unwrap();

    // (instrução, chave citada sem assinar)
    let mut cases: Vec<(&str, Instruction, Pubkey)> = vec![
        ("approve_agent", status_ix(&admin, &pending, true), admin),
        ("suspend_agent", status_ix(&admin, &agent, false), admin),
        ("propose_slash", propose_slash_ix(&env.payer.pubkey(), &admin, &agent, USDC, [1; 32]), admin),
        ("execute_slash", execute_ix(&env, &admin, &agent, env.payer.pubkey()), admin),
        ("cancel_slash", cancel_slash_ix(&admin, &agent, env.payer.pubkey()), admin),
        ("extend_stake_exit", extend_exit_ix(&admin, &agent, [1; 32]), admin),
        ("contest_slash", contest_ix(&creator, &agent, [1; 32]), creator),
        ("request_stake_exit", request_exit_ix(&env.payer.pubkey(), &creator, &agent), creator),
        ("cancel_stake_exit", cancel_exit_ix(&creator, &agent, env.payer.pubkey()), creator),
        ("withdraw_stake", withdraw_ix(&env, &creator, &agent, env.payer.pubkey(), agent.creator_usdc), creator),
        ("update_config", {
            Instruction {
                program_id: solvers::ID,
                accounts: solvers::accounts::UpdateConfig { admin, config: config_pda() }.to_account_metas(None),
                data: solvers::instruction::UpdateConfig { args: env.params(0) }.data(),
            }
        }, admin),
        ("set_eval", set_eval_ix(&verifier, &agent, 100, [0; 32]), verifier),
        ("mark_passed", mark_passed_ix(&verifier, escrow.key, 0), verifier),
        ("update_version", update_version_ix(&creator, &agent, "9", [0; 32]), creator),
        ("update_pricing", update_pricing_ix(&creator, &agent, 20 * USDC, 0), creator),
        ("top_up_stake", top_up_ix(&env, &agent, &creator, agent.creator_usdc, USDC), creator),
        ("record_usage_batch", record_usage_ix(&usage, &agent, 1, [0; 32]), usage),
        ("consume_credit", consume_ix(&usage, &agent, credits_pda(&agent, &buyer.pubkey())), usage),
        ("purchase_license", purchase_ix(&env, &agent, &buyer.pubkey(), &asset.pubkey(), 12 * USDC), buyer.pubkey()),
        ("buy_credits", buy_credits_ix(&env, &agent, &buyer.pubkey(), 10, 5 * USDC), buyer.pubkey()),
        ("open_dispute", dispute_ix(&buyer.pubkey(), &escrow, 0), buyer.pubkey()),
        ("release_milestone", release_ix(&env, &agent, &escrow, &buyer.pubkey(), 0), buyer.pubkey()),
        ("cancel_undelivered", cancel_ix(&env, &escrow, &buyer.pubkey(), env.ata(&buyer.pubkey()), 0), buyer.pubkey()),
        ("resolve_dispute", resolve_ix(&env, &agent, &escrow, &admin, &buyer.pubkey(), 1, true), admin),
        ("resolve_stale_dispute", Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::ResolveStaleDispute {
                caller: buyer.pubkey(),
                escrow: escrow.key,
                vault: escrow.vault,
                buyer_usdc: env.ata(&buyer.pubkey()),
                usdc_mint: env.mint,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: solvers::instruction::ResolveStaleDispute { index: 1 }.data(),
        }, buyer.pubkey()),
        ("set_treasury", set_treasury_ix(&env, &admin, env.treasury), admin),
        ("set_pause", set_pause_ix(&admin, PAUSE_ENTRIES), admin),
        ("set_guardian", set_guardian_ix(&admin, Pubkey::default()), admin),
        ("migrate_config", migrate_ix(&env.payer.pubkey(), &admin, config_pda()), admin),
    ];
    for (name, ix, key) in cases.iter_mut() {
        unsign(ix, key);
        let extra: Vec<&Keypair> = if *name == "purchase_license" { vec![&asset] } else { vec![] };
        let err = env.send(ix.clone(), &extra).unwrap_err();
        assert!(err.contains("AccountNotSigner"), "{name}: {err}");
    }
    // A conferência não mudou nada.
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
    assert_eq!(env.account::<Credits>(&credits_pda(&agent, &buyer.pubkey())).remaining, 10);
    assert_eq!(env.account::<Agent>(&pending.key).status, AgentStatus::Pending);
}

// ------------------------------------------------------------------------ governança v2 ----
// Config v2 (migração do v1 da devnet) e pausa de emergência.

/// Config v1 como está na devnet: 179 bytes de dados (ordem dos campos do v1) + discriminador de `Config`.
#[derive(anchor_lang::AnchorSerialize, anchor_lang::AnchorDeserialize, Clone, Debug, PartialEq)]
struct ConfigV1 {
    admin: Pubkey,
    verifier: Pubkey,
    usage_authority: Pubkey,
    treasury: Pubkey,
    usdc_mint: Pubkey,
    fee_bps: u16,
    min_stake: u64,
    min_price: u64,
    bump: u8,
}

impl ConfigV1 {
    fn of(env: &Env) -> Self {
        ConfigV1 {
            admin: env.admin.pubkey(),
            verifier: env.verifier.pubkey(),
            usage_authority: env.usage.pubkey(),
            treasury: env.treasury,
            usdc_mint: env.mint,
            fee_bps: FEE_BPS,
            min_stake: 0,
            min_price: MIN_PRICE,
            bump: Pubkey::find_program_address(&[CONFIG_SEED], &solvers::ID).1,
        }
    }

    fn bytes(&self) -> Vec<u8> {
        let mut data = Config::DISCRIMINATOR.to_vec();
        anchor_lang::AnchorSerialize::serialize(self, &mut data).unwrap();
        assert_eq!(data.len(), CONFIG_V1_LEN);
        data
    }
}

/// Grava `data` em `key` como conta do programa, com rent para o tamanho dos próprios dados.
fn put_program_account(env: &mut Env, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    env.svm
        .set_account(key, solana_account::Account { lamports, data, owner, executable: false, rent_epoch: 0 })
        .unwrap();
}

/// Env sem `initialize_config`, com o Config v1 sintético da devnet no endereço do PDA.
fn env_with_config_v1() -> (Env, ConfigV1) {
    let mut env = Env::build(false);
    let v1 = ConfigV1::of(&env);
    put_program_account(&mut env, config_pda(), solvers::ID, v1.bytes());
    (env, v1)
}

fn migrate_ix(payer: &Pubkey, authority: &Pubkey, config: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::MigrateConfig {
            payer: *payer,
            authority: *authority,
            config,
            program: solvers::ID,
            program_data: program_data(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::MigrateConfig {}.data(),
    }
}

fn migrate(env: &mut Env, payer: &Keypair, authority: &Keypair, config: Pubkey) -> Result<Vec<String>, String> {
    env.send_logs(migrate_ix(&payer.pubkey(), &authority.pubkey(), config), &[payer, authority])
}

fn rent_for(env: &Env, len: usize) -> u64 {
    env.svm.minimum_balance_for_rent_exemption(len)
}

fn set_pause_ix(signer: &Pubkey, flags: u8) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetPause { signer: *signer, config: config_pda() }.to_account_metas(None),
        data: solvers::instruction::SetPause { flags }.data(),
    }
}

fn set_pause(env: &mut Env, signer: &Keypair, flags: u8) -> Result<Vec<String>, String> {
    env.send_logs(set_pause_ix(&signer.pubkey(), flags), &[signer])
}

fn set_guardian_ix(admin: &Pubkey, new_guardian: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SetGuardian { admin: *admin, config: config_pda() }.to_account_metas(None),
        data: solvers::instruction::SetGuardian { new_guardian }.data(),
    }
}

fn set_guardian(env: &mut Env, signer: &Keypair, new_guardian: Pubkey) -> Result<Vec<String>, String> {
    env.send_logs(set_guardian_ix(&signer.pubkey(), new_guardian), &[signer])
}

fn config_of(env: &Env) -> Config {
    env.account::<Config>(&config_pda())
}

#[test]
fn migrate_config_before_migration_readers_fail_and_non_authority_is_refused() {
    let (mut env, _) = env_with_config_v1();
    let admin = admin_kp(&env);
    let payer = funded(&mut env);

    // (a) Antes de migrar, toda instrução que lê `Account<Config>` falha: a conta v1 é curta demais.
    let params = env.params(0);
    let err = update_config_as(&mut env, &admin, params).unwrap_err();
    assert!(err.contains("AccountDidNotDeserialize"), "{err}");
    let err = set_pause(&mut env, &admin, 1).unwrap_err();
    assert!(err.contains("AccountDidNotDeserialize"), "{err}");

    // (b) Só a upgrade authority migra: admin do Config que não é a authority, verificador e estranhos não.
    env.set_upgrade_authority(unique_key());
    for signer in [admin.insecure_clone(), verifier_kp(&env), funded(&mut env)] {
        let err = migrate(&mut env, &payer, &signer, config_pda()).unwrap_err();
        assert!(err.contains("NotAdmin"), "{err}");
    }
    // Quem paga o rent não vira autoridade.
    let err = migrate(&mut env, &payer, &payer, config_pda()).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    assert_eq!(env.svm.get_account(&config_pda()).unwrap().data.len(), CONFIG_V1_LEN);
}

#[test]
fn migrate_config_preserves_v1_bytes_zeroes_the_rest_and_runs_once() {
    let (mut env, v1) = env_with_config_v1();
    let before = env.svm.get_account(&config_pda()).unwrap();
    assert_eq!(before.data.len(), 187);
    assert_eq!(before.lamports, rent_for(&env, 187));
    let (admin, payer) = (admin_kp(&env), funded(&mut env));
    let payer_before = lamports(&env, &payer.pubkey());

    // (c) Migra: os 187 bytes v1 ficam idênticos, `layout_version` = 2 e o resto zerado.
    migrate(&mut env, &payer, &admin, config_pda()).unwrap();
    let after = env.svm.get_account(&config_pda()).unwrap();
    assert_eq!(after.data.len(), 8 + Config::INIT_SPACE);
    assert_eq!(after.data.len(), 285);
    assert_eq!(after.data[..CONFIG_V1_LEN], before.data[..]);
    assert_eq!(after.data[CONFIG_V1_LEN], CONFIG_LAYOUT_VERSION);
    assert!(after.data[CONFIG_V1_LEN + 1..].iter().all(|b| *b == 0));
    assert_eq!(after.owner, solvers::ID);
    // O pagador do rent cobriu só a diferença e a conta ficou isenta de rent.
    assert_eq!(after.lamports, rent_for(&env, 285));
    assert_eq!(payer_before - lamports(&env, &payer.pubkey()), rent_for(&env, 285) - rent_for(&env, 187));
    let cfg = config_of(&env);
    assert_eq!((cfg.admin, cfg.verifier, cfg.usage_authority, cfg.treasury, cfg.usdc_mint), (v1.admin, v1.verifier, v1.usage_authority, v1.treasury, v1.usdc_mint));
    assert_eq!((cfg.fee_bps, cfg.min_stake, cfg.min_price, cfg.bump), (v1.fee_bps, v1.min_stake, v1.min_price, v1.bump));
    assert_eq!((cfg.layout_version, cfg.pause_flags, cfg.guardian, cfg._reserved), (2, 0, Pubkey::default(), [0u8; 64]));

    // (d) Segunda chamada: o tamanho já é o v2 e nada muda (nem o rent).
    let err = migrate(&mut env, &payer, &admin, config_pda()).unwrap_err();
    assert!(err.contains("ConfigAlreadyMigrated"), "{err}");
    assert_eq!(env.svm.get_account(&config_pda()).unwrap().data, after.data);
    assert_eq!(lamports(&env, &config_pda()), rent_for(&env, 285));
}

#[test]
fn migrate_config_then_normal_flow_works_and_keeps_new_fields() {
    let (mut env, _) = env_with_config_v1();
    // Pagador = authority (caso do Squads, em que o cofre assina e paga): o mesmo signer nas duas contas.
    let admin = admin_kp(&env);
    migrate(&mut env, &admin, &admin, config_pda()).unwrap();

    // (e) Compra, créditos e garantia passam sobre o Config migrado.
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    purchase(&mut env, &agent, &buyer).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC]).unwrap();
    mark_passed(&mut env, &escrow, 0).unwrap();
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();

    // Pausa e guardian funcionam, e `update_config` (que regrava o Config) não toca nos campos novos.
    let guardian = new_keypair().pubkey();
    set_guardian(&mut env, &admin, guardian).unwrap();
    set_pause(&mut env, &admin, PAUSE_ENTRIES).unwrap();
    let params = ConfigParams { fee_bps: 500, ..env.params(0) };
    env.update_config_with(params).unwrap();
    let cfg = config_of(&env);
    assert_eq!((cfg.fee_bps, cfg.layout_version, cfg.pause_flags, cfg.guardian), (500, 2, PAUSE_ENTRIES, guardian));
    assert_eq!(env.svm.get_account(&config_pda()).unwrap().data.len(), 285);
}

#[test]
fn migrate_config_refuses_accounts_that_are_not_the_v1_config() {
    let (mut env, v1) = env_with_config_v1();
    let (admin, payer) = (admin_kp(&env), funded(&mut env));
    let v1_bytes = v1.bytes();

    // (f) Endereço que não é o PDA do Config (mesmo dono, mesmo tamanho, mesmo discriminador).
    let impostor = unique_key();
    put_program_account(&mut env, impostor, solvers::ID, v1_bytes.clone());
    let err = migrate(&mut env, &payer, &admin, impostor).unwrap_err();
    assert!(err.contains("ConstraintSeeds"), "{err}");
    let err = migrate(&mut env, &payer, &admin, unique_key()).unwrap_err();
    assert!(err.contains("ConstraintSeeds"), "{err}");

    // PDA certo, dono errado (outro programa ou o sistema).
    for owner in [system_program::ID, spl_token::ID] {
        put_program_account(&mut env, config_pda(), owner, v1_bytes.clone());
        let err = migrate(&mut env, &payer, &admin, config_pda()).unwrap_err();
        assert!(err.contains("ConstraintOwner"), "{err}");
    }

    // PDA e dono certos, mas outro discriminador (um Agent não vira Config).
    let mut cosplay = v1_bytes.clone();
    cosplay[..8].copy_from_slice(Agent::DISCRIMINATOR);
    put_program_account(&mut env, config_pda(), solvers::ID, cosplay.clone());
    let err = migrate(&mut env, &payer, &admin, config_pda()).unwrap_err();
    assert!(err.contains("AccountDiscriminatorMismatch"), "{err}");
    assert_eq!(env.svm.get_account(&config_pda()).unwrap().data, cosplay);

    // Tamanho que não é o v1 (nem o v2): nunca é redimensionado.
    for len in [CONFIG_V1_LEN + 1, CONFIG_V1_LEN + 98, CONFIG_V1_LEN - 1] {
        let mut data = v1_bytes.clone();
        data.resize(len, 0);
        put_program_account(&mut env, config_pda(), solvers::ID, data);
        let err = migrate(&mut env, &payer, &admin, config_pda()).unwrap_err();
        assert!(err.contains("ConfigAlreadyMigrated"), "{err}");
        assert_eq!(env.svm.get_account(&config_pda()).unwrap().data.len(), len);
    }
}

#[test]
fn config_v2_is_the_v1_prefix_and_v1_readers_still_decode_it() {
    // `initialize_config` já cria o v2.
    let mut env = Env::new();
    let acc = env.svm.get_account(&config_pda()).unwrap();
    assert_eq!(acc.data.len(), 285);
    let cfg = config_of(&env);
    assert_eq!((cfg.layout_version, cfg.pause_flags, cfg.guardian, cfg._reserved), (2, 0, Pubkey::default(), [0u8; 64]));

    // Leitor v1 (mesma ordem de campos, borsh que não exige consumir o buffer inteiro, como o
    // `try_deserialize_unchecked` do binário antigo) lê o v2 e vê os mesmos valores.
    let mut rest = &acc.data[8..];
    assert_eq!(&acc.data[..8], Config::DISCRIMINATOR);
    let v1 = ConfigV1::deserialize(&mut rest).unwrap();
    assert_eq!(v1, ConfigV1::of(&env));
    assert_eq!(rest.len(), 98);
    assert_eq!(rest[0], 2);

    // O código atual relê o v2 e o regrava por inteiro (só o prefixo v1 muda, a cauda fica).
    let guardian = unique_key();
    let admin = admin_kp(&env);
    set_guardian(&mut env, &admin, guardian).unwrap();
    set_pause(&mut env, &admin, PAUSE_PAYMENTS).unwrap();
    let before = env.svm.get_account(&config_pda()).unwrap().data;
    env.update_fee(500).unwrap();
    let after = env.svm.get_account(&config_pda()).unwrap().data;
    assert_eq!(after.len(), 285);
    assert_eq!(after[CONFIG_V1_LEN..], before[CONFIG_V1_LEN..]);
    assert_ne!(after[..CONFIG_V1_LEN], before[..CONFIG_V1_LEN]);
}

/// Binário ANTIGO (programa de antes da governança v2) sobre um Config v2: ele precisa ler e regravar
/// sem perder a cauda. Exige o `.so` do commit anterior em `SOLVERS_V1_SO` (sem a variável, o teste só avisa).
#[test]
fn previous_binary_reads_and_rewrites_a_v2_config_without_losing_the_tail() {
    let Some(old_so) = std::env::var_os("SOLVERS_V1_SO") else {
        eprintln!("SOLVERS_V1_SO não definido: teste com o binário anterior pulado");
        return;
    };
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(solvers::ID, old_so).expect("SOLVERS_V1_SO inválido");
    let admin = new_keypair();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let config = Config {
        admin: admin.pubkey(),
        verifier: unique_key(),
        usage_authority: unique_key(),
        treasury: unique_key(),
        usdc_mint: unique_key(),
        fee_bps: FEE_BPS,
        min_stake: 7,
        min_price: MIN_PRICE,
        bump: Pubkey::find_program_address(&[CONFIG_SEED], &solvers::ID).1,
        layout_version: 2,
        pause_flags: PAUSE_MASK,
        guardian: unique_key(),
        _reserved: [0; 64],
    };
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&config, &mut data).unwrap();
    assert_eq!(data.len(), 285);
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(config_pda(), solana_account::Account { lamports, data, owner: solvers::ID, executable: false, rent_epoch: 0 })
        .unwrap();

    let params = ConfigParams { verifier: config.verifier, usage_authority: config.usage_authority, fee_bps: 500, min_stake: 7, min_price: MIN_PRICE };
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::UpdateConfig { admin: admin.pubkey(), config: config_pda() }.to_account_metas(None),
        data: solvers::instruction::UpdateConfig { args: params }.data(),
    };
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&admin.pubkey()), &[&admin], svm.latest_blockhash());
    svm.send_transaction(tx).unwrap_or_else(|e| panic!("binário anterior recusou o Config v2: {:?}", e.meta.logs));

    let mut expected = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&Config { fee_bps: 500, ..config }, &mut expected).unwrap();
    assert_eq!(svm.get_account(&config_pda()).unwrap().data, expected);
}

#[test]
fn set_pause_and_guardian_permissions_and_events() {
    let mut env = Env::new();
    let (admin, guardian, stranger) = (admin_kp(&env), new_keypair(), new_keypair());

    // Sem guardian configurado, ninguém além do admin mexe na pausa.
    let err = set_pause(&mut env, &guardian, PAUSE_ENTRIES).unwrap_err();
    assert!(err.contains("NotPauseAuthority"), "{err}");

    // Só o admin define o guardian (nem o próprio guardian, nem estranhos).
    for signer in [&guardian, &stranger] {
        let err = set_guardian(&mut env, signer, guardian.pubkey()).unwrap_err();
        assert!(err.contains("NotAdmin"), "{err}");
    }
    let logs = set_guardian(&mut env, &admin, guardian.pubkey()).unwrap();
    let ev = events::<solvers::events::GuardianChanged>(&logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].admin, ev[0].old_guardian, ev[0].new_guardian), (admin.pubkey(), Pubkey::default(), guardian.pubkey()));
    assert_eq!(config_of(&env).guardian, guardian.pubkey());

    // Estranho não pausa.
    let err = set_pause(&mut env, &stranger, PAUSE_ENTRIES).unwrap_err();
    assert!(err.contains("NotPauseAuthority"), "{err}");
    assert_eq!(config_of(&env).pause_flags, 0);

    // O guardian liga bits, inclusive acrescentando outros, e repetir o mesmo valor é aceito.
    let logs = set_pause(&mut env, &guardian, PAUSE_ENTRIES).unwrap();
    let ev = events::<solvers::events::PauseChanged>(&logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].by, ev[0].old_flags, ev[0].new_flags), (guardian.pubkey(), 0, PAUSE_ENTRIES));
    set_pause(&mut env, &guardian, PAUSE_MASK).unwrap();
    set_pause(&mut env, &guardian, PAUSE_MASK).unwrap();
    assert_eq!(config_of(&env).pause_flags, PAUSE_MASK);

    // ...mas nunca desliga: nem tudo, nem um bit só.
    for flags in [0, PAUSE_ENTRIES, PAUSE_PAYMENTS] {
        let err = set_pause(&mut env, &guardian, flags).unwrap_err();
        assert!(err.contains("GuardianCannotUnpause"), "{err}");
    }
    assert_eq!(config_of(&env).pause_flags, PAUSE_MASK);

    // Bits fora de 0 e 1 são recusados para o guardian e para o admin.
    for flags in [0b100, 0xFF, PAUSE_MASK | 0b1000_0000] {
        for signer in [&guardian, &admin] {
            let err = set_pause(&mut env, signer, flags).unwrap_err();
            assert!(err.contains("InvalidPauseFlags"), "{err}");
        }
    }
    assert_eq!(config_of(&env).pause_flags, PAUSE_MASK);

    // O admin liga e desliga, em qualquer combinação.
    let logs = set_pause(&mut env, &admin, 0).unwrap();
    let ev = events::<solvers::events::PauseChanged>(&logs);
    assert_eq!((ev[0].by, ev[0].old_flags, ev[0].new_flags), (admin.pubkey(), PAUSE_MASK, 0));
    for flags in [PAUSE_PAYMENTS, PAUSE_ENTRIES, PAUSE_MASK, 0] {
        set_pause(&mut env, &admin, flags).unwrap();
        assert_eq!(config_of(&env).pause_flags, flags);
    }

    // Com só o bit 1 ligado, o guardian não pode trocá-lo pelo bit 0 (isso removeria o bit 1).
    set_pause(&mut env, &admin, PAUSE_PAYMENTS).unwrap();
    let err = set_pause(&mut env, &guardian, PAUSE_ENTRIES).unwrap_err();
    assert!(err.contains("GuardianCannotUnpause"), "{err}");

    // Guardian removido (Pubkey::default()) perde o poder; o admin segue com ele.
    let logs = set_guardian(&mut env, &admin, Pubkey::default()).unwrap();
    let ev = events::<solvers::events::GuardianChanged>(&logs);
    assert_eq!((ev[0].old_guardian, ev[0].new_guardian), (guardian.pubkey(), Pubkey::default()));
    let err = set_pause(&mut env, &guardian, PAUSE_MASK).unwrap_err();
    assert!(err.contains("NotPauseAuthority"), "{err}");
    assert_eq!(config_of(&env).pause_flags, PAUSE_PAYMENTS);
    set_pause(&mut env, &admin, PAUSE_MASK).unwrap();
    assert_eq!(config_of(&env).pause_flags, PAUSE_MASK);
}

#[test]
fn pause_blocks_entries_and_payments_each_by_its_own_bit() {
    let mut env = Env::new();
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 300 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC, 5 * USDC]).unwrap();
    dispute(&mut env, &escrow, &buyer, 2).unwrap();
    let admin = admin_kp(&env);

    // Bit 0 (entradas): as quatro entradas param; os pagamentos seguem.
    set_pause(&mut env, &admin, PAUSE_ENTRIES).unwrap();
    let err = register(&mut env, 12 * USDC, 0).err().unwrap();
    assert!(err.contains("Error Code: Paused."), "register_agent: {err}");
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("Error Code: Paused."), "purchase_license: {err}");
    let err = buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap_err();
    assert!(err.contains("Error Code: Paused."), "buy_credits: {err}");
    let err = create_escrow_full(&mut env, &agent, &buyer, 2, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("Error Code: Paused."), "create_escrow: {err}");
    assert!(env.svm.get_account(&pda(&[ESCROW_SEED, buyer.pubkey().as_ref(), agent.key.as_ref(), &2u64.to_le_bytes()])).is_none());
    mark_passed(&mut env, &escrow, 0).unwrap();

    // Bit 1 (pagamentos): as duas instruções que movem dinheiro param; as entradas voltam. `mark_passed`
    // não pausa (não move dinheiro; senão o prazo de entrega venceria com o verificador impedido).
    set_pause(&mut env, &admin, PAUSE_PAYMENTS).unwrap();
    mark_passed(&mut env, &escrow, 1).unwrap();
    let err = release(&mut env, &agent, &escrow, &buyer, 1).unwrap_err();
    assert!(err.contains("Error Code: Paused."), "release_milestone: {err}");
    let err = resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 2, true).unwrap_err();
    assert!(err.contains("Error Code: Paused."), "resolve_dispute: {err}");
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(
        e.milestones.iter().map(|m| m.status).collect::<Vec<_>>(),
        [MilestoneStatus::Passed, MilestoneStatus::Passed, MilestoneStatus::Disputed]
    );
    assert_eq!(env.balance(&escrow.vault), 15 * USDC);
    register(&mut env, 12 * USDC, 0).unwrap();
    purchase(&mut env, &agent, &buyer).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    create_escrow_full(&mut env, &agent, &buyer, 2, &[5 * USDC], REVIEW_WINDOW, 0).unwrap();

    // Pausa desligada: as mesmas instruções passam.
    set_pause(&mut env, &admin, 0).unwrap();
    release(&mut env, &agent, &escrow, &buyer, 1).unwrap();
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 2, true).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(
        e.milestones.iter().map(|m| m.status).collect::<Vec<_>>(),
        [MilestoneStatus::Passed, MilestoneStatus::Approved, MilestoneStatus::Refunded]
    );
}

#[test]
fn buyer_exits_and_admin_instructions_never_pause() {
    let mut env = Env::new();
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 100 * USDC);
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    // Prazo de entrega de 1 dia: vence antes do SLA de 7 dias da disputa.
    let escrow = create_escrow_days(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC], 1).unwrap();
    let admin = admin_kp(&env);
    set_pause(&mut env, &admin, PAUSE_MASK).unwrap();

    // Tudo pausado: o comprador ainda abre disputa...
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    // ...e, vencidos os prazos, recupera o dinheiro (cancelamento por atraso e disputa parada).
    warp(&mut env, DISPUTE_SLA_SECS + 1);
    cancel(&mut env, &escrow, &buyer, 1).unwrap();
    let keeper = new_keypair();
    stale(&mut env, &escrow, &keeper, &buyer.pubkey(), 0).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 100 * USDC - 5 * USDC);
    assert_eq!(env.balance(&escrow.vault), 0);
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Refunded);
    // ...e a plataforma ainda fecha o escrow encerrado.
    let payer = env.payer.insecure_clone();
    close(&mut env, &escrow, &buyer.pubkey(), &payer).unwrap();
    assert!(env.svm.get_account(&escrow.key).is_none_or(|a| a.lamports == 0));
    assert_eq!(config_of(&env).pause_flags, PAUSE_MASK);

    // Administração e operações que não são entrada nem pagamento seguem funcionando.
    env.send(status_ix(&admin.pubkey(), &agent, false), &[&admin]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Suspended);
    env.send(status_ix(&admin.pubkey(), &agent, true), &[&admin]).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
    let params = ConfigParams { fee_bps: 700, ..env.params(0) };
    update_config_as(&mut env, &admin, params).unwrap();
    assert_eq!(config_of(&env).fee_bps, 700);
    let creator = agent.creator.insecure_clone();
    env.send(update_pricing_ix(&creator.pubkey(), &agent, 13 * USDC, USDC / 2), &[&creator]).unwrap();
    let usage = usage_kp(&env);
    env.send(record_usage_ix(&usage.pubkey(), &agent, 3, [1; 32]), &[&usage]).unwrap();
    env.send(consume_ix(&usage.pubkey(), &agent, credits_pda(&agent, &buyer.pubkey())), &[&usage]).unwrap();
    set_guardian(&mut env, &admin, unique_key()).unwrap();
    set_pause(&mut env, &admin, 0).unwrap();
}

// ------------------------------------------------------------------- governança v2: stake ----
// Saída do criador (30 dias + 2 extensões), confisco em duas etapas (72 h) e `min_stake` aplicado,
// sempre com `min_stake` > 0 (a devnet tem 0, mas o código precisa estar pronto).

const EXIT_DELAY: i64 = STAKE_EXIT_DELAY_SECS;

fn stake_exit_pda(agent: &TestAgent) -> Pubkey {
    pda(&[STAKE_EXIT_SEED, agent.key.as_ref()])
}

fn slash_pda(agent: &TestAgent) -> Pubkey {
    pda(&[SLASH_SEED, agent.key.as_ref()])
}

fn vault_pda(agent: &TestAgent) -> Pubkey {
    pda(&[STAKE_SEED, agent.key.as_ref()])
}

fn request_exit_ix(payer: &Pubkey, creator: &Pubkey, agent: &TestAgent) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::RequestStakeExit {
            payer: *payer,
            creator: *creator,
            agent: agent.key,
            stake_exit: stake_exit_pda(agent),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::RequestStakeExit {}.data(),
    }
}

fn request_exit(env: &mut Env, agent: &TestAgent) -> Result<Vec<String>, String> {
    let creator = agent.creator.insecure_clone();
    let ix = request_exit_ix(&env.payer.pubkey(), &creator.pubkey(), agent);
    env.send_logs(ix, &[&creator])
}

fn extend_exit_ix(admin: &Pubkey, agent: &TestAgent, reason_hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ExtendStakeExit {
            admin: *admin,
            config: config_pda(),
            agent: agent.key,
            stake_exit: stake_exit_pda(agent),
        }
        .to_account_metas(None),
        data: solvers::instruction::ExtendStakeExit { reason_hash }.data(),
    }
}

fn extend_exit(env: &mut Env, signer: &Keypair, agent: &TestAgent, reason_hash: [u8; 32]) -> Result<Vec<String>, String> {
    env.send_logs(extend_exit_ix(&signer.pubkey(), agent, reason_hash), &[signer])
}

fn cancel_exit_ix(creator: &Pubkey, agent: &TestAgent, rent_payer: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CancelStakeExit {
            creator: *creator,
            agent: agent.key,
            stake_exit: stake_exit_pda(agent),
            rent_payer,
        }
        .to_account_metas(None),
        data: solvers::instruction::CancelStakeExit {}.data(),
    }
}

fn cancel_exit(env: &mut Env, agent: &TestAgent) -> Result<Vec<String>, String> {
    let creator = agent.creator.insecure_clone();
    let ix = cancel_exit_ix(&creator.pubkey(), agent, env.payer.pubkey());
    env.send_logs(ix, &[&creator])
}

fn withdraw_ix(env: &Env, creator: &Pubkey, agent: &TestAgent, rent_payer: Pubkey, creator_usdc: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::WithdrawStake {
            creator: *creator,
            config: config_pda(),
            agent: agent.key,
            stake_vault: vault_pda(agent),
            stake_exit: stake_exit_pda(agent),
            rent_payer,
            slash_proposal: slash_pda(agent),
            creator_usdc,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::WithdrawStake {}.data(),
    }
}

fn withdraw(env: &mut Env, agent: &TestAgent) -> Result<Vec<String>, String> {
    let creator = agent.creator.insecure_clone();
    let ix = withdraw_ix(env, &creator.pubkey(), agent, env.payer.pubkey(), agent.creator_usdc);
    env.send_logs(ix, &[&creator])
}

fn propose_slash_ix(payer: &Pubkey, admin: &Pubkey, agent: &TestAgent, amount: u64, reason_hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ProposeSlash {
            payer: *payer,
            admin: *admin,
            config: config_pda(),
            agent: agent.key,
            slash_proposal: slash_pda(agent),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ProposeSlash { amount, reason_hash }.data(),
    }
}

fn propose(env: &mut Env, agent: &TestAgent, amount: u64) -> Result<Vec<String>, String> {
    let admin = admin_kp(env);
    let ix = propose_slash_ix(&env.payer.pubkey(), &admin.pubkey(), agent, amount, [4; 32]);
    env.send_logs(ix, &[&admin])
}

fn contest_ix(creator: &Pubkey, agent: &TestAgent, reason_hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ContestSlash { creator: *creator, agent: agent.key, slash_proposal: slash_pda(agent) }
            .to_account_metas(None),
        data: solvers::instruction::ContestSlash { reason_hash }.data(),
    }
}

fn cancel_slash_ix(signer: &Pubkey, agent: &TestAgent, rent_payer: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CancelSlash {
            signer: *signer,
            config: config_pda(),
            agent: agent.key,
            slash_proposal: slash_pda(agent),
            rent_payer,
        }
        .to_account_metas(None),
        data: solvers::instruction::CancelSlash {}.data(),
    }
}

fn execute_ix(env: &Env, admin: &Pubkey, agent: &TestAgent, rent_payer: Pubkey) -> Instruction {
    Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::ExecuteSlash {
            admin: *admin,
            config: config_pda(),
            agent: agent.key,
            stake_vault: vault_pda(agent),
            treasury: env.treasury,
            usdc_mint: env.mint,
            slash_proposal: slash_pda(agent),
            rent_payer,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::ExecuteSlash {}.data(),
    }
}

fn execute(env: &mut Env, agent: &TestAgent) -> Result<Vec<String>, String> {
    let admin = admin_kp(env);
    let ix = execute_ix(env, &admin.pubkey(), agent, env.payer.pubkey());
    env.send_logs(ix, &[&admin])
}

fn is_closed(env: &Env, key: &Pubkey) -> bool {
    env.svm.get_account(key).is_none_or(|a| a.lamports == 0 || a.data.is_empty())
}

#[test]
fn agent_status_retired_is_appended_without_renumbering() {
    let decode = |b: u8| AgentStatus::try_from_slice(&[b]);
    assert_eq!(decode(0).unwrap(), AgentStatus::Pending);
    assert_eq!(decode(1).unwrap(), AgentStatus::Active);
    assert_eq!(decode(2).unwrap(), AgentStatus::Suspended);
    assert_eq!(decode(3).unwrap(), AgentStatus::Retired);
    assert!(decode(4).is_err());
    assert_eq!(
        [AgentStatus::Pending as u8, AgentStatus::Active as u8, AgentStatus::Suspended as u8, AgentStatus::Retired as u8],
        [0, 1, 2, 3]
    );
    // O Agent não muda de tamanho: contas existentes (status 0, 1 ou 2) seguem iguais.
    assert_eq!(AgentStatus::INIT_SPACE, 1);
}

#[test]
fn stake_exit_full_cycle_with_real_min_stake() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (creator, admin) = (agent.creator.insecure_clone(), admin_kp(&env));
    let vault = vault_pda(&agent);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    // `register_agent` cobrou o stake do criador e o cofre guarda o valor exato.
    assert_eq!(env.balance(&agent.creator_usdc), 90 * USDC);
    assert_eq!((env.balance(&vault), env.account::<Agent>(&agent.key).stake), (10 * USDC, 10 * USDC));

    // Só o criador do solver pede a saída.
    let stranger = funded(&mut env);
    for who in [&stranger, &admin] {
        let ix = request_exit_ix(&env.payer.pubkey(), &who.pubkey(), &agent);
        let err = env.send(ix, &[who]).unwrap_err();
        assert!(err.contains("NotCreator"), "{err}");
    }
    let logs = request_exit(&mut env, &agent).unwrap();
    let ev = events::<solvers::events::StakeExitRequested>(&logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].agent, ev[0].creator, ev[0].exit_at), (agent.key, creator.pubkey(), T0 + EXIT_DELAY));
    let st = events::<solvers::events::AgentStatusChanged>(&logs);
    assert_eq!(st[0].status, 3);
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.status, a.stake), (AgentStatus::Retired, 10 * USDC));
    let exit: StakeExit = env.account(&stake_exit_pda(&agent));
    assert_eq!(
        (exit.exit_at, exit.requested_at, exit.extensions, exit.rent_payer),
        (T0 + EXIT_DELAY, T0, 0, env.payer.pubkey())
    );

    // Não pede de novo (a StakeExit já existe: o `init` recusa); `approve_agent` e `suspend_agent` não tiram o solver da saída.
    assert!(request_exit(&mut env, &agent).is_err());
    assert_eq!(env.account::<StakeExit>(&stake_exit_pda(&agent)).exit_at, T0 + EXIT_DELAY);
    let err = approve_as(&mut env, &admin, &agent).unwrap_err();
    assert!(err.contains("AgentRetired"), "{err}");
    let err = env.send(status_ix(&admin.pubkey(), &agent, false), &[&admin]).unwrap_err();
    assert!(err.contains("AgentRetired"), "{err}");

    // Retired não vende nem abre garantia (como Suspended).
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
    let err = buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
    let err = create_escrow(&mut env, &agent, &buyer, &[5 * USDC]).err().unwrap();
    assert!(err.contains("AgentNotActive"), "{err}");

    // Espera de 30 dias: 1 segundo antes falha; no segundo exato passa. Só o criador saca.
    let exit_at = T0 + EXIT_DELAY;
    set_time(&mut env, exit_at - 1);
    let err = withdraw(&mut env, &agent).unwrap_err();
    assert!(err.contains("StakeExitNotReached"), "{err}");
    set_time(&mut env, exit_at);
    let ix = withdraw_ix(&env, &stranger.pubkey(), &agent, env.payer.pubkey(), agent.creator_usdc);
    let err = env.send(ix, &[&stranger]).unwrap_err();
    assert!(err.contains("NotCreator"), "{err}");
    let creator_sol = lamports(&env, &creator.pubkey());
    let logs = withdraw(&mut env, &agent).unwrap();
    let ev = events::<solvers::events::StakeWithdrawn>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].creator, ev[0].amount), (1, agent.key, creator.pubkey(), 10 * USDC));
    // Devolve o valor exato, fecha cofre e StakeExit, zera o stake e o rent do cofre vai ao criador.
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC);
    assert!(is_closed(&env, &vault) && is_closed(&env, &stake_exit_pda(&agent)));
    assert_eq!(lamports(&env, &creator.pubkey()) - creator_sol, rent_for(&env, spl_token::state::Account::LEN));
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.status, a.stake), (AgentStatus::Retired, 0));

    // O fim é definitivo: nada de saque duplo, aporte, novo pedido ou reativação.
    assert!(withdraw(&mut env, &agent).is_err());
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, USDC);
    assert!(env.send(ix, &[&creator]).is_err());
    let err = request_exit(&mut env, &agent).unwrap_err();
    assert!(err.contains("AgentRetired"), "{err}");
    let err = approve_as(&mut env, &admin, &agent).unwrap_err();
    assert!(err.contains("AgentRetired"), "{err}");
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC);
}

#[test]
fn stake_exit_extensions_are_capped_and_admin_only_and_pending_slash_blocks_withdraw() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (creator, admin) = (agent.creator.insecure_clone(), admin_kp(&env));
    request_exit(&mut env, &agent).unwrap();
    // Denúncia em aberto: o admin propõe o confisco (o solver já está Retired e continua Retired).
    let logs = propose(&mut env, &agent, 3 * USDC).unwrap();
    assert!(events::<solvers::events::AgentStatusChanged>(&logs).is_empty());
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Retired);

    // Só o admin estende (nem o criador, nem o guardian que não existe).
    let err = extend_exit(&mut env, &creator, &agent, [7; 32]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let logs = extend_exit(&mut env, &admin, &agent, [7; 32]).unwrap();
    let ev = events::<solvers::events::StakeExitExtended>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].exit_at, ev[0].extensions, ev[0].reason_hash), (1, agent.key, T0 + 2 * EXIT_DELAY, 1, [7; 32]));
    let logs = extend_exit(&mut env, &admin, &agent, [8; 32]).unwrap();
    let ev = events::<solvers::events::StakeExitExtended>(&logs);
    assert_eq!((ev[0].exit_at, ev[0].extensions, ev[0].reason_hash), (T0 + 3 * EXIT_DELAY, 2, [8; 32]));
    let err = extend_exit(&mut env, &admin, &agent, [9; 32]).unwrap_err();
    assert!(err.contains("StakeExitExtensionsExhausted"), "{err}");
    let exit: StakeExit = env.account(&stake_exit_pda(&agent));
    assert_eq!((exit.exit_at, exit.extensions), (T0 + 3 * EXIT_DELAY, 2));

    // Os 30 dias originais não bastam; nem 1 segundo antes do prazo estendido.
    set_time(&mut env, T0 + EXIT_DELAY);
    let err = withdraw(&mut env, &agent).unwrap_err();
    assert!(err.contains("StakeExitNotReached"), "{err}");
    set_time(&mut env, T0 + 3 * EXIT_DELAY - 1);
    let err = withdraw(&mut env, &agent).unwrap_err();
    assert!(err.contains("StakeExitNotReached"), "{err}");

    // No prazo, a proposta de confisco pendente ainda trava o saque (mesmo com os 72 h vencidos).
    set_time(&mut env, T0 + 3 * EXIT_DELAY);
    let err = withdraw(&mut env, &agent).unwrap_err();
    assert!(err.contains("SlashPending"), "{err}");
    assert_eq!(env.balance(&vault_pda(&agent)), 10 * USDC);
    // Cancelada a proposta, o saque passa e leva o stake inteiro.
    let admin_cancel = cancel_slash_ix(&admin.pubkey(), &agent, env.payer.pubkey());
    env.send(admin_cancel, &[&admin]).unwrap();
    withdraw(&mut env, &agent).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC);
}

#[test]
fn cancel_stake_exit_goes_back_to_suspended_never_active() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    request_exit(&mut env, &agent).unwrap();

    let stranger = funded(&mut env);
    let ix = cancel_exit_ix(&stranger.pubkey(), &agent, env.payer.pubkey());
    let err = env.send(ix, &[&stranger]).unwrap_err();
    assert!(err.contains("NotCreator"), "{err}");
    // O rent só volta a quem pagou: outro destino é recusado.
    let creator = agent.creator.insecure_clone();
    let ix = cancel_exit_ix(&creator.pubkey(), &agent, stranger.pubkey());
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");

    // Defesa em profundidade: com a invariante quebrada (StakeExit existe, mas o solver não está Retired)
    // nem cancelar nem sacar passam.
    write_account::<Agent>(&mut env, &agent.key, |a| a.status = AgentStatus::Active);
    let err = cancel_exit(&mut env, &agent).unwrap_err();
    assert!(err.contains("AgentNotRetired"), "{err}");
    set_time(&mut env, T0 + EXIT_DELAY);
    let err = withdraw(&mut env, &agent).unwrap_err();
    assert!(err.contains("AgentNotRetired"), "{err}");
    write_account::<Agent>(&mut env, &agent.key, |a| a.status = AgentStatus::Retired);

    let payer_before = lamports(&env, &env.payer.pubkey());
    let logs = cancel_exit(&mut env, &agent).unwrap();
    let ev = events::<solvers::events::StakeExitCancelled>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].creator), (1, agent.key, creator.pubkey()));
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.status, a.stake), (AgentStatus::Suspended, 10 * USDC));
    assert!(is_closed(&env, &stake_exit_pda(&agent)));
    assert!(lamports(&env, &env.payer.pubkey()) > payer_before - 10_000, "rent da StakeExit volta a quem pagou");
    // Cancelar de novo (ou sacar) já não há o que fazer.
    assert!(cancel_exit(&mut env, &agent).is_err());
    assert!(withdraw(&mut env, &agent).is_err());
    // Continua sem vender até o admin aprovar; aprovar com o stake completo reativa.
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
    approve(&mut env, &agent);
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
    purchase(&mut env, &agent, &buyer).unwrap();
    // O PDA fechado pode ser reaberto: novo pedido, novo prazo.
    set_time(&mut env, T0 + 5 * EXIT_DELAY);
    request_exit(&mut env, &agent).unwrap();
    assert_eq!(env.account::<StakeExit>(&stake_exit_pda(&agent)).exit_at, T0 + 6 * EXIT_DELAY);
}

#[test]
fn slash_proposal_delay_contest_cancel_and_execute() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (creator, admin) = (agent.creator.insecure_clone(), admin_kp(&env));
    let (vault, treasury) = (vault_pda(&agent), env.treasury);

    // Só o admin propõe; valor 0 e acima do stake são recusados e nada se move.
    let ix = propose_slash_ix(&env.payer.pubkey(), &creator.pubkey(), &agent, USDC, [4; 32]);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    let err = propose(&mut env, &agent, 0).unwrap_err();
    assert!(err.contains("InvalidAmount"), "{err}");
    for amount in [10 * USDC + 1, u64::MAX] {
        let err = propose(&mut env, &agent, amount).unwrap_err();
        assert!(err.contains("InsufficientStake"), "{err}");
    }
    assert!(is_closed(&env, &slash_pda(&agent)));
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);

    // Proposta de 4: suspende já, não move dinheiro e conta 72 h.
    let logs = propose(&mut env, &agent, 4 * USDC).unwrap();
    let ev = events::<solvers::events::SlashProposed>(&logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].agent, ev[0].amount, ev[0].reason_hash, ev[0].executable_at), (agent.key, 4 * USDC, [4; 32], T0 + SLASH_DELAY_SECS));
    assert_eq!(events::<solvers::events::AgentStatusChanged>(&logs)[0].status, AgentStatus::Suspended as u8);
    let p: SlashProposal = env.account(&slash_pda(&agent));
    assert_eq!((p.amount, p.proposed_at, p.contested_at, p.contest_hash, p.rent_payer), (4 * USDC, T0, 0, [0; 32], env.payer.pubkey()));
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Suspended);
    assert_eq!((env.balance(&vault), env.balance(&treasury)), (10 * USDC, 0));
    // Uma proposta por solver.
    assert!(propose(&mut env, &agent, USDC).is_err());
    assert_eq!(env.account::<SlashProposal>(&slash_pda(&agent)).amount, 4 * USDC);

    // Contestação: só o criador, uma única vez; é só evidência (nada muda no dinheiro).
    let stranger = funded(&mut env);
    for who in [&stranger, &admin] {
        let err = env.send(contest_ix(&who.pubkey(), &agent, [6; 32]), &[who]).unwrap_err();
        assert!(err.contains("NotCreator"), "{err}");
    }
    set_time(&mut env, T0 + 100);
    let logs = env.send_logs(contest_ix(&creator.pubkey(), &agent, [6; 32]), &[&creator]).unwrap();
    let ev = events::<solvers::events::SlashContested>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].contest_hash), (1, agent.key, [6; 32]));
    let err = env.send(contest_ix(&creator.pubkey(), &agent, [7; 32]), &[&creator]).unwrap_err();
    assert!(err.contains("SlashAlreadyContested"), "{err}");
    let p: SlashProposal = env.account(&slash_pda(&agent));
    assert_eq!((p.contest_hash, p.contested_at, p.amount), ([6; 32], T0 + 100, 4 * USDC));

    // Execução: só o admin, só com tesouro e cofre certos e só a partir de proposed_at + 72 h.
    let ix = execute_ix(&env, &creator.pubkey(), &agent, env.payer.pubkey());
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    set_time(&mut env, T0 + SLASH_DELAY_SECS - 1);
    let err = execute(&mut env, &agent).unwrap_err();
    assert!(err.contains("SlashDelayNotReached"), "{err}");
    let other_treasury = env.token_account(&unique_key(), 0);
    let mut ix = execute_ix(&env, &admin.pubkey(), &agent, env.payer.pubkey());
    swap_account(&mut ix, &treasury, other_treasury);
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    let other = register(&mut env, 12 * USDC, 0).unwrap();
    let mut ix = execute_ix(&env, &admin.pubkey(), &agent, env.payer.pubkey());
    swap_account(&mut ix, &vault, vault_pda(&other));
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintSeeds"), "{err}");
    let mut ix = execute_ix(&env, &admin.pubkey(), &agent, env.payer.pubkey());
    swap_account(&mut ix, &env.payer.pubkey(), stranger.pubkey());
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");

    set_time(&mut env, T0 + SLASH_DELAY_SECS);
    let logs = execute(&mut env, &agent).unwrap();
    let ev = events::<solvers::events::SlashExecuted>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].amount, ev[0].treasury), (1, agent.key, 4 * USDC, treasury));
    assert_eq!(events::<solvers::events::StakeSlashed>(&logs).len(), 1);
    assert_eq!((env.balance(&vault), env.balance(&treasury)), (6 * USDC, 4 * USDC));
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.stake, a.status), (6 * USDC, AgentStatus::Suspended));
    assert!(is_closed(&env, &slash_pda(&agent)));
    assert!(execute(&mut env, &agent).is_err());

    // Stake abaixo do mínimo: não reativa nem vende até o aporte; aportar + aprovar reativa.
    let err = approve_as(&mut env, &admin, &agent).unwrap_err();
    assert!(err.contains("InsufficientStake"), "{err}");
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 4 * USDC);
    env.send(ix, &[&creator]).unwrap();
    approve(&mut env, &agent);
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);

    // Cancelamento: só o admin; fecha a proposta e o solver continua suspenso até ser aprovado.
    propose(&mut env, &agent, 2 * USDC).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Suspended);
    let ix = cancel_slash_ix(&stranger.pubkey(), &agent, env.payer.pubkey());
    let err = env.send(ix, &[&stranger]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");
    // O criador só cancela depois da expiração (testes de expiração mais abaixo).
    let ix = cancel_slash_ix(&creator.pubkey(), &agent, env.payer.pubkey());
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("SlashNotExpired"), "{err}");
    let ix = cancel_slash_ix(&admin.pubkey(), &agent, stranger.pubkey());
    let err = env.send(ix, &[&admin]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");
    let ix = cancel_slash_ix(&admin.pubkey(), &agent, env.payer.pubkey());
    let logs = env.send_logs(ix, &[&admin]).unwrap();
    let ev = events::<solvers::events::SlashCancelled>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].amount), (1, agent.key, 2 * USDC));
    assert!(is_closed(&env, &slash_pda(&agent)));
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Suspended);
    assert_eq!((env.balance(&vault), env.balance(&treasury)), (10 * USDC, 4 * USDC));

    // Reaprovado entre a proposta e a execução, o solver volta a Suspended ao executar.
    approve(&mut env, &agent);
    propose(&mut env, &agent, 2 * USDC).unwrap();
    approve(&mut env, &agent);
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
    set_time(&mut env, T0 + 2 * SLASH_DELAY_SECS);
    let logs = execute(&mut env, &agent).unwrap();
    assert_eq!(events::<solvers::events::AgentStatusChanged>(&logs)[0].status, AgentStatus::Suspended as u8);
    assert_eq!((env.account::<Agent>(&agent.key).stake, env.balance(&treasury)), (8 * USDC, 6 * USDC));
}

#[test]
fn slash_on_retired_agent_keeps_it_retired_and_withdraw_pays_the_rest() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    request_exit(&mut env, &agent).unwrap();
    propose(&mut env, &agent, 4 * USDC).unwrap();
    set_time(&mut env, T0 + SLASH_DELAY_SECS);
    let logs = execute(&mut env, &agent).unwrap();
    assert!(events::<solvers::events::AgentStatusChanged>(&logs).is_empty());
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.status, a.stake), (AgentStatus::Retired, 6 * USDC));
    set_time(&mut env, T0 + EXIT_DELAY);
    withdraw(&mut env, &agent).unwrap();
    // 100 - 10 de stake + 6 devolvidos (os outros 4 foram para a tesouraria).
    assert_eq!(env.balance(&agent.creator_usdc), 96 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), 4 * USDC);
}

#[test]
fn retired_agent_keeps_open_escrows_and_licenses_working() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 100 * USDC);
    let asset = purchase(&mut env, &agent, &buyer).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    let escrow = create_escrow(&mut env, &agent, &buyer, &[5 * USDC, 5 * USDC, 5 * USDC]).unwrap();
    dispute(&mut env, &escrow, &buyer, 2).unwrap();
    request_exit(&mut env, &agent).unwrap();
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Retired);

    // Com o solver Retired: verificação, liberação, julgamento, créditos e avaliação seguem normais.
    mark_passed(&mut env, &escrow, 0).unwrap();
    release(&mut env, &agent, &escrow, &buyer, 0).unwrap();
    mark_passed(&mut env, &escrow, 1).unwrap();
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), 2, true).unwrap();
    let keeper = new_keypair();
    warp(&mut env, REVIEW_WINDOW + 1);
    release(&mut env, &agent, &escrow, &keeper, 1).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Completed);
    assert_eq!(env.balance(&escrow.vault), 0);
    let usage = usage_kp(&env);
    env.send(consume_ix(&usage.pubkey(), &agent, credits_pda(&agent, &buyer.pubkey())), &[&usage]).unwrap();
    review_with_license(&mut env, &agent, &buyer, asset, 5).unwrap();
    // O que não pode: nova venda ou nova garantia.
    let err = create_escrow_full(&mut env, &agent, &buyer, 2, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("AgentNotActive"), "{err}");
}

#[test]
fn min_stake_gates_sales_and_escrows() {
    let mut env = Env::new();
    set_time(&mut env, T0);
    // min_stake = 0: stake 0 vende normalmente (sem efeito).
    let agent = active_agent(&mut env, 12 * USDC, USDC / 2);
    let (buyer, _) = new_buyer(&mut env, 200 * USDC);
    assert_eq!(env.account::<Agent>(&agent.key).stake, 0);
    purchase(&mut env, &agent, &buyer).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    create_escrow(&mut env, &agent, &buyer, &[5 * USDC]).unwrap();

    // O admin sobe o mínimo: o solver ativo, mas com stake menor, para de vender.
    env.update_min_stake(10 * USDC);
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Active);
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("InsufficientStake"), "{err}");
    let err = buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap_err();
    assert!(err.contains("InsufficientStake"), "{err}");
    let err = create_escrow_full(&mut env, &agent, &buyer, 2, &[5 * USDC], REVIEW_WINDOW, 0).err().unwrap();
    assert!(err.contains("InsufficientStake"), "{err}");

    // Um aporte parcial não basta; no mínimo exato volta a vender.
    let creator = agent.creator.insecure_clone();
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 10 * USDC - 1);
    env.send(ix, &[&creator]).unwrap();
    let err = purchase(&mut env, &agent, &buyer).unwrap_err();
    assert!(err.contains("InsufficientStake"), "{err}");
    let ix = top_up_ix(&env, &agent, &creator.pubkey(), agent.creator_usdc, 1);
    env.send(ix, &[&creator]).unwrap();
    purchase(&mut env, &agent, &buyer).unwrap();
    buy_credits(&mut env, &agent, &buyer, 10, 5 * USDC).unwrap();
    create_escrow_full(&mut env, &agent, &buyer, 2, &[5 * USDC], REVIEW_WINDOW, 0).unwrap();
}

#[test]
fn prefunded_stake_pdas_do_not_block_the_flow() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let a = active_agent(&mut env, 12 * USDC, 0);
    let b = active_agent(&mut env, 12 * USDC, 0);

    // Agente A: ninguém propôs confisco, mas o endereço da proposta foi pré-financiado (conta do
    // System Program, sem dados). Isso não conta como proposta: pedido e saque passam.
    for pda_key in [slash_pda(&a), stake_exit_pda(&a)] {
        env.svm.airdrop(&pda_key, 5_000_000).unwrap();
    }
    assert_eq!(env.svm.get_account(&slash_pda(&a)).unwrap().owner, system_program::ID);
    request_exit(&mut env, &a).unwrap();
    set_time(&mut env, T0 + EXIT_DELAY);
    withdraw(&mut env, &a).unwrap();
    assert_eq!(env.balance(&a.creator_usdc), 100 * USDC);
    assert!(is_closed(&env, &slash_pda(&a)) || env.svm.get_account(&slash_pda(&a)).unwrap().owner == system_program::ID);

    // Agente B: com os dois endereços pré-financiados, propor/contestar/cancelar/executar funcionam.
    env.svm.airdrop(&slash_pda(&b), 5_000_000).unwrap();
    propose(&mut env, &b, 3 * USDC).unwrap();
    assert_eq!(env.svm.get_account(&slash_pda(&b)).unwrap().owner, solvers::ID);
    let admin = admin_kp(&env);
    let ix = cancel_slash_ix(&admin.pubkey(), &b, env.payer.pubkey());
    env.send(ix, &[&admin]).unwrap();
    propose(&mut env, &b, 3 * USDC).unwrap();
    set_time(&mut env, T0 + EXIT_DELAY + SLASH_DELAY_SECS);
    execute(&mut env, &b).unwrap();
    assert_eq!(env.account::<Agent>(&b.key).stake, 7 * USDC);
}

#[test]
fn withdraw_destination_is_the_derived_ata_and_rent_payer_may_be_the_creator() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let creator = agent.creator.insecure_clone();
    // O criador paga o próprio rent (payer == creator): o destino do rent da StakeExit é o próprio criador,
    // que também recebe o rent do cofre; as duas contas mutáveis iguais não derrubam o saque.
    let ix = request_exit_ix(&creator.pubkey(), &creator.pubkey(), &agent);
    env.send(ix, &[&creator]).unwrap();
    assert_eq!(env.account::<StakeExit>(&stake_exit_pda(&agent)).rent_payer, creator.pubkey());
    set_time(&mut env, T0 + EXIT_DELAY);

    // Destino que não é a ATA derivada do criador, dono errado e rent_payer errado: recusados.
    let (_, other_usdc) = new_buyer(&mut env, 0);
    let ix = withdraw_ix(&env, &creator.pubkey(), &agent, creator.pubkey(), other_usdc);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("ConstraintAddress"), "{err}");
    let ix = withdraw_ix(&env, &creator.pubkey(), &agent, env.payer.pubkey(), agent.creator_usdc);
    let err = env.send(ix, &[&creator]).unwrap_err();
    assert!(err.contains("ConstraintHasOne"), "{err}");

    // O criador troca o dono da própria ATA (SetAuthority): o saque ainda chega ao endereço derivado.
    let new_owner = unique_key();
    swap_ata_owner(&mut env, &creator, &new_owner);
    let ix = withdraw_ix(&env, &creator.pubkey(), &agent, creator.pubkey(), agent.creator_usdc);
    env.send(ix, &[&creator]).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC);
    assert!(is_closed(&env, &vault_pda(&agent)));
}

/// Várias instruções numa só transação (assina com o payer do harness + `signers`).
fn send_tx(env: &mut Env, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
    let mut all: Vec<&Keypair> = vec![&env.payer];
    all.extend(signers.iter().copied().filter(|k| k.pubkey() != env.payer.pubkey()));
    let tx = Transaction::new_signed_with_payer(ixs, Some(&env.payer.pubkey()), &all, env.svm.latest_blockhash());
    let res = env.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.meta.logs));
    env.svm.expire_blockhash();
    res
}

#[test]
fn admin_extension_cannot_be_undone_by_cancel_and_request() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (creator, admin) = (agent.creator.insecure_clone(), admin_kp(&env));
    request_exit(&mut env, &agent).unwrap();
    extend_exit(&mut env, &admin, &agent, [7; 32]).unwrap();
    let before = env.account::<StakeExit>(&stake_exit_pda(&agent));
    assert_eq!((before.exit_at, before.extensions), (T0 + 2 * EXIT_DELAY, 1));

    // Com a espera estendida o criador não cancela, nem sozinho nem emendando cancelar + pedir de novo
    // (que levaria exit_at de volta para agora + 30 dias).
    let err = cancel_exit(&mut env, &agent).unwrap_err();
    assert!(err.contains("StakeExitExtended"), "{err}");
    set_time(&mut env, T0 + 1);
    let ixs = [
        cancel_exit_ix(&creator.pubkey(), &agent, env.payer.pubkey()),
        request_exit_ix(&env.payer.pubkey(), &creator.pubkey(), &agent),
    ];
    let err = send_tx(&mut env, &ixs, &[&creator]).unwrap_err();
    assert!(err.contains("StakeExitExtended"), "{err}");
    let after = env.account::<StakeExit>(&stake_exit_pda(&agent));
    assert_eq!((after.exit_at, after.extensions, after.requested_at), (T0 + 2 * EXIT_DELAY, 1, T0));
    assert_eq!(env.account::<Agent>(&agent.key).status, AgentStatus::Retired);

    // O dia 31 (fim dos 30 dias originais) não libera o saque; só o prazo estendido.
    set_time(&mut env, T0 + EXIT_DELAY + 1);
    let err = withdraw(&mut env, &agent).unwrap_err();
    assert!(err.contains("StakeExitNotReached"), "{err}");

    // Sem extensão, cancelar continua valendo (e volta a Suspended).
    let other = active_agent(&mut env, 12 * USDC, 0);
    request_exit(&mut env, &other).unwrap();
    cancel_exit(&mut env, &other).unwrap();
    assert_eq!(env.account::<Agent>(&other.key).status, AgentStatus::Suspended);
}

#[test]
fn slash_proposal_executes_only_inside_its_window_and_creator_closes_it_after() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let (admin, treasury) = (admin_kp(&env), env.treasury);
    let window_end = SLASH_DELAY_SECS + SLASH_EXPIRY_GRACE_SECS;

    // A: executa no segundo exato do fim da janela.
    let a = active_agent(&mut env, 12 * USDC, 0);
    propose(&mut env, &a, 4 * USDC).unwrap();
    // C: um segundo depois do fim da janela a execução falha.
    let c = active_agent(&mut env, 12 * USDC, 0);
    propose(&mut env, &c, 4 * USDC).unwrap();
    // B: Retired (pedido de saída em T0); a proposta dele vem depois, para o saque cair dentro da janela.
    let b = active_agent(&mut env, 12 * USDC, 0);
    request_exit(&mut env, &b).unwrap();

    // A: no último segundo da janela ainda executa.
    set_time(&mut env, T0 + window_end);
    execute(&mut env, &a).unwrap();
    assert_eq!(env.account::<Agent>(&a.key).stake, 6 * USDC);
    // C: um segundo depois, não; o criador (e só ele, além do admin) fecha a proposta vencida.
    set_time(&mut env, T0 + window_end + 1);
    let err = execute(&mut env, &c).unwrap_err();
    assert!(err.contains("SlashExpired"), "{err}");
    assert_eq!(env.balance(&treasury), 4 * USDC);
    let (c_creator, c_stranger) = (c.creator.insecure_clone(), funded(&mut env));
    let ix = cancel_slash_ix(&c_stranger.pubkey(), &c, env.payer.pubkey());
    assert!(env.send(ix, &[&c_stranger]).unwrap_err().contains("NotAdmin"));
    let ix = cancel_slash_ix(&c_creator.pubkey(), &c, env.payer.pubkey());
    let logs = env.send_logs(ix, &[&c_creator]).unwrap();
    let ev = events::<solvers::events::SlashCancelled>(&logs);
    assert_eq!((ev.len(), ev[0].agent, ev[0].amount), (1, c.key, 4 * USDC));
    assert!(is_closed(&env, &slash_pda(&c)));
    assert_eq!((env.account::<Agent>(&c.key).stake, env.balance(&vault_pda(&c))), (10 * USDC, 10 * USDC));

    set_time(&mut env, T0 + 25 * 86_400);
    let b_proposed = current_time(&env);
    propose(&mut env, &b, 1).unwrap();

    // Dentro da janela a proposta de B segue travando o saque (prazo de 30 dias já vencido).
    set_time(&mut env, T0 + EXIT_DELAY);
    let err = withdraw(&mut env, &b).unwrap_err();
    assert!(err.contains("SlashPending"), "{err}");
    // Antes da expiração o criador e estranhos não cancelam.
    let (b_creator, stranger) = (b.creator.insecure_clone(), funded(&mut env));
    let ix = cancel_slash_ix(&b_creator.pubkey(), &b, env.payer.pubkey());
    let err = env.send(ix, &[&b_creator]).unwrap_err();
    assert!(err.contains("SlashNotExpired"), "{err}");
    let ix = cancel_slash_ix(&stranger.pubkey(), &b, env.payer.pubkey());
    let err = env.send(ix, &[&stranger]).unwrap_err();
    assert!(err.contains("NotAdmin"), "{err}");

    // B: um segundo antes da expiração o criador ainda não cancela; no segundo exato cancela e saca na
    // mesma transação, e o rent da proposta volta a quem pagou.
    let b_expiry = b_proposed + window_end;
    set_time(&mut env, b_expiry - 1);
    let ix = cancel_slash_ix(&b_creator.pubkey(), &b, env.payer.pubkey());
    let err = env.send(ix, &[&b_creator]).unwrap_err();
    assert!(err.contains("SlashNotExpired"), "{err}");
    set_time(&mut env, b_expiry);
    let payer_before = lamports(&env, &env.payer.pubkey());
    let ixs = [
        cancel_slash_ix(&b_creator.pubkey(), &b, env.payer.pubkey()),
        withdraw_ix(&env, &b_creator.pubkey(), &b, env.payer.pubkey(), b.creator_usdc),
    ];
    send_tx(&mut env, &ixs, &[&b_creator]).unwrap();
    assert!(is_closed(&env, &slash_pda(&b)) && is_closed(&env, &vault_pda(&b)));
    assert_eq!(env.balance(&b.creator_usdc), 100 * USDC);
    assert_eq!(env.account::<Agent>(&b.key).stake, 0);
    // Rent da proposta (e da StakeExit) de volta ao payer, descontada a taxa da transação.
    assert!(lamports(&env, &env.payer.pubkey()) + 20_000 > payer_before + rent_for(&env, 8 + SlashProposal::INIT_SPACE));
    // O admin cancela uma proposta vencida (ou não) quando quiser.
    let d = active_agent(&mut env, 12 * USDC, 0);
    propose(&mut env, &d, USDC).unwrap();
    set_time(&mut env, b_expiry + window_end + 1);
    let ix = cancel_slash_ix(&admin.pubkey(), &d, env.payer.pubkey());
    env.send(ix, &[&admin]).unwrap();
    assert!(is_closed(&env, &slash_pda(&d)));
}

#[test]
fn execute_slash_with_treasury_equal_to_the_vault_hits_the_duplicate_mutable_check() {
    let mut env = Env::new();
    env.update_min_stake(10 * USDC);
    set_time(&mut env, T0);
    let agent = active_agent(&mut env, 12 * USDC, 0);
    let (admin, vault, old_treasury) = (admin_kp(&env), vault_pda(&agent), env.treasury);
    propose(&mut env, &agent, 4 * USDC).unwrap();
    set_time(&mut env, T0 + SLASH_DELAY_SECS);
    // O admin (por engano) aponta a tesouraria para o cofre de stake: a execução é recusada, não desvia nada.
    env.send(set_treasury_ix(&env, &admin.pubkey(), vault), &[&admin]).unwrap();
    env.treasury = vault;
    let err = execute(&mut env, &agent).unwrap_err();
    assert!(err.contains("ConstraintDuplicateMutableAccount"), "{err}");
    assert_eq!(env.balance(&vault), 10 * USDC);
    // Corrigida a tesouraria, a mesma proposta executa.
    env.send(set_treasury_ix(&env, &admin.pubkey(), old_treasury), &[&admin]).unwrap();
    env.treasury = old_treasury;
    execute(&mut env, &agent).unwrap();
    assert_eq!((env.balance(&vault), env.balance(&old_treasury)), (6 * USDC, 4 * USDC));
}

// ------------------------------------------------------------------------ meta: cobertura ----

fn camel(snake: &str) -> String {
    snake
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect()
}

/// Instruções de `lib.rs` (`    pub fn nome(` dentro de `#[program]`), em CamelCase.
fn program_instructions() -> Vec<String> {
    include_str!("../src/lib.rs")
        .lines()
        .filter_map(|l| l.strip_prefix("    pub fn "))
        .filter_map(|l| l.split('(').next())
        .map(camel)
        .collect()
}

/// Códigos de `errors.rs` (`    Nome,`).
fn program_errors() -> Vec<String> {
    include_str!("../src/errors.rs")
        .lines()
        .filter_map(|l| l.strip_prefix("    "))
        .filter_map(|l| l.strip_suffix(','))
        .filter(|n| n.chars().all(|c| c.is_ascii_alphanumeric()) && n.starts_with(|c: char| c.is_ascii_uppercase()))
        .map(String::from)
        .collect()
}

#[test]
fn cu_ceilings_cover_every_instruction() {
    let instructions = program_instructions();
    assert!(instructions.len() >= 38, "lib.rs mudou de forma: {instructions:?}");
    for name in &instructions {
        let row = CU_CEILINGS.iter().find(|(n, _)| n == name);
        let (_, ceiling) = row.unwrap_or_else(|| panic!("{name} sem teto em CU_CEILINGS"));
        assert!(*ceiling <= 100_000 && *ceiling > 0, "{name}: teto {ceiling}");
    }
    for (name, _) in CU_CEILINGS {
        assert!(instructions.contains(&name.to_string()), "{name} está na tabela mas não existe em lib.rs");
    }
}

#[test]
fn every_instruction_and_error_code_has_a_test() {
    let tests = include_str!("program.rs");
    let untested_ix: Vec<_> = program_instructions()
        .into_iter()
        .filter(|n| !tests.contains(&format!("instruction::{n} ")) && !tests.contains(&format!("instruction::{n}{{")) && !tests.contains(&format!("instruction::{n}\n")))
        .collect();
    assert!(untested_ix.is_empty(), "instruções sem nenhum teste: {untested_ix:?}");

    // Todo erro precisa aparecer num `err.contains("...Nome...")`.
    let marker = ["contains", "(\""].concat();
    let untested_err: Vec<_> = program_errors()
        .into_iter()
        .filter(|e| !tests.lines().any(|l| l.contains(&marker) && l.contains(e.as_str())))
        .collect();
    assert!(untested_err.is_empty(), "erros sem teste negativo: {untested_err:?}");
}

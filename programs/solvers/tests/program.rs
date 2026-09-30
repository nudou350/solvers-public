//! Testes do programa com LiteSVM (INSTRUCTIONS.md 4.7).
//! Requer `tests/fixtures/mpl_core.so` (dump da devnet) e o build em `target/deploy/solvers.so`.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
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

        let payer = Keypair::new();
        let admin = Keypair::new();
        let verifier = Keypair::new();
        let usage = Keypair::new();
        for k in [&payer, &admin, &verifier, &usage] {
            svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
        }
        let mint = Pubkey::new_unique();
        let mut env = Env { svm, payer, admin, verifier, usage, mint, treasury: Pubkey::default() };
        env.set_upgrade_authority(env.admin.pubkey());
        env.create_mint();
        let treasury_owner = Pubkey::new_unique();
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
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend(signers.iter().copied().filter(|k| k.pubkey() != self.payer.pubkey()));
        let tx = Transaction::new_signed_with_payer(&[ix], Some(&self.payer.pubkey()), &all, self.svm.latest_blockhash());
        let res = self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.meta.logs));
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
            data: solvers::instruction::InitializeConfig { args: self.params(min_stake) }.data(),
        };
        self.send(ix, &[admin])
    }

    fn update_min_stake(&mut self, min_stake: u64) {
        let ix = Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::UpdateConfig { admin: self.admin.pubkey(), config: config_pda() }
                .to_account_metas(None),
            data: solvers::instruction::UpdateConfig { args: self.params(min_stake) }.data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(ix, &[&admin]).unwrap();
    }
}

struct TestAgent {
    key: Pubkey,
    creator: Keypair,
    creator_usdc: Pubkey,
    collection: Pubkey,
}

fn register(env: &mut Env, price: u64, price_per_use: u64) -> Result<TestAgent, String> {
    let creator = Keypair::new();
    env.svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    let creator_usdc = env.token_account(&creator.pubkey(), 100 * USDC);
    let id: [u8; 16] = Pubkey::new_unique().to_bytes()[..16].try_into().unwrap();
    let key = agent_pda(&id);
    let collection = Keypair::new();
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
        data: solvers::instruction::RegisterAgent {
            args: RegisterAgentArgs {
                agent_id: id,
                name: "Front-end React".into(),
                metadata_uri: "https://example.com/meta.json".into(),
                version: "1.0.0".into(),
                version_hash: [7; 32],
                price,
                price_per_use,
                royalty_bps: 500,
            },
        }
        .data(),
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
    let asset = Keypair::new();
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
    let buyer = Keypair::new();
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
    let intruder = Keypair::new();
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

    let other = Keypair::new();
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
    let nonce: u64 = 1;
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
            review_window_secs: REVIEW_WINDOW,
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

fn close(env: &mut Env, escrow: &TestEscrow, buyer: &Pubkey, caller: &Keypair) -> Result<(), String> {
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
    env.send(ix, &[caller])
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

    let keeper = Keypair::new();
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

    let before = env.svm.get_account(&env.payer.pubkey()).unwrap().lamports;
    close(&mut env, &escrow, &buyer.pubkey(), &keeper).unwrap();
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

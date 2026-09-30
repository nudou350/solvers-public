//! Testes do programa com LiteSVM (INSTRUCTIONS.md 4.7).
//! Requer `tests/fixtures/mpl_core.so` (dump da devnet) e o build em `target/deploy/solvers.so`.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::solana_program::system_program;

use solvers::instructions::{ConfigParams, MilestoneInput, RegisterAgentArgs};
use solvers::state::*;

const USDC: u64 = 1_000_000;
const FEE_BPS: u16 = 1_000;
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

impl Env {
    fn new() -> Self {
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
        env.create_mint();
        let treasury_owner = Pubkey::new_unique();
        env.treasury = env.token_account(&treasury_owner, 0);
        env.init_config(0);
        env
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

    /// Cria uma token account USDC com saldo (escrita direta no estado).
    fn token_account(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let key = Pubkey::new_unique();
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
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.payer.pubkey()),
            &all,
            self.svm.latest_blockhash(),
        );
        let res = self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.meta.logs));
        self.svm.expire_blockhash();
        res
    }

    fn init_config(&mut self, min_stake: u64) {
        let ix = Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::InitializeConfig {
                admin: self.admin.pubkey(),
                config: config_pda(),
                usdc_mint: self.mint,
                treasury: self.treasury,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: solvers::instruction::InitializeConfig {
                args: ConfigParams {
                    verifier: self.verifier.pubkey(),
                    usage_authority: self.usage.pubkey(),
                    fee_bps: FEE_BPS,
                    min_stake,
                    min_price: 5 * USDC,
                },
            }
            .data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(ix, &[&admin]).unwrap();
    }

    fn update_min_stake(&mut self, min_stake: u64) {
        let ix = Instruction {
            program_id: solvers::ID,
            accounts: solvers::accounts::UpdateConfig { admin: self.admin.pubkey(), config: config_pda() }
                .to_account_metas(None),
            data: solvers::instruction::UpdateConfig {
                args: ConfigParams {
                    verifier: self.verifier.pubkey(),
                    usage_authority: self.usage.pubkey(),
                    fee_bps: FEE_BPS,
                    min_stake,
                    min_price: 5 * USDC,
                },
            }
            .data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(ix, &[&admin]).unwrap();
    }
}

struct TestAgent {
    id: [u8; 16],
    key: Pubkey,
    creator: Keypair,
    creator_usdc: Pubkey,
    collection: Pubkey,
}

fn register(env: &mut Env, price: u64, price_per_use: u64) -> Result<TestAgent, String> {
    let creator = Keypair::new();
    env.svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    let creator_usdc = env.token_account(&creator.pubkey(), 100 * USDC);
    let id: [u8; 16] = rand_id();
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
    Ok(TestAgent { id, key, creator, creator_usdc, collection: collection.pubkey() })
}

fn rand_id() -> [u8; 16] {
    Pubkey::new_unique().to_bytes()[..16].try_into().unwrap()
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

fn purchase(env: &mut Env, agent: &TestAgent, buyer: &Keypair, buyer_usdc: Pubkey) -> Result<Pubkey, String> {
    let asset = Keypair::new();
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
        data: solvers::instruction::PurchaseLicense {}.data(),
    };
    env.send(ix, &[buyer, &asset])?;
    Ok(asset.pubkey())
}

fn review(
    env: &mut Env,
    agent: &TestAgent,
    author: &Keypair,
    asset: Option<Pubkey>,
    with_credits: bool,
    rating: u8,
) -> Result<(), String> {
    let credits = pda(&[CREDITS_SEED, agent.key.as_ref(), author.pubkey().as_ref()]);
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::SubmitReview {
            payer: env.payer.pubkey(),
            author: author.pubkey(),
            agent: agent.key,
            review: pda(&[REVIEW_SEED, agent.key.as_ref(), author.pubkey().as_ref()]),
            license_asset: asset,
            credits: with_credits.then_some(credits),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::SubmitReview { rating, content_hash: [1; 32] }.data(),
    };
    env.send(ix, &[author])
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

    let asset = purchase(&mut env, &agent, &buyer, buyer_usdc).unwrap();

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
fn purchase_of_pending_agent_fails() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    let (buyer, buyer_usdc) = new_buyer(&mut env, 50 * USDC);
    let err = purchase(&mut env, &agent, &buyer, buyer_usdc).unwrap_err();
    assert!(err.contains("AgentNotActive"), "{err}");
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
    let (buyer, buyer_usdc) = new_buyer(&mut env, 50 * USDC);
    let (stranger, _) = new_buyer(&mut env, 0);

    let err = review(&mut env, &agent, &stranger, None, false, 5).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");

    let asset = purchase(&mut env, &agent, &buyer, buyer_usdc).unwrap();
    // Asset de outra pessoa não serve como prova.
    let err = review(&mut env, &agent, &stranger, Some(asset), false, 5).unwrap_err();
    assert!(err.contains("NoLicense"), "{err}");

    review(&mut env, &agent, &buyer, Some(asset), false, 4).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (4, 1));

    // Editar a avaliação substitui a nota anterior.
    review(&mut env, &agent, &buyer, Some(asset), false, 2).unwrap();
    let a: Agent = env.account(&agent.key);
    assert_eq!((a.rating_sum, a.rating_count), (2, 1));
}

#[test]
fn credits_buy_consume_and_review() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, USDC / 2).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 10 * USDC);
    let credits = pda(&[CREDITS_SEED, agent.key.as_ref(), buyer.pubkey().as_ref()]);

    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::BuyCredits {
            payer: env.payer.pubkey(),
            buyer: buyer.pubkey(),
            config: config_pda(),
            agent: agent.key,
            credits,
            reputation: rep_pda(&buyer.pubkey()),
            buyer_usdc,
            creator_usdc: agent.creator_usdc,
            treasury: env.treasury,
            usdc_mint: env.mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::BuyCredits { amount: 2 }.data(),
    };
    env.send(ix, &[&buyer]).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 9 * USDC);

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
    consume(&mut env).unwrap();
    consume(&mut env).unwrap();
    let err = consume(&mut env).unwrap_err();
    assert!(err.contains("NoCredits"), "{err}");

    let a: Agent = env.account(&agent.key);
    assert_eq!(a.verified_uses, 2);
    // Quem comprou créditos pode avaliar mesmo depois de gastá-los.
    review(&mut env, &agent, &buyer, None, true, 5).unwrap();
}

struct TestEscrow {
    key: Pubkey,
    vault: Pubkey,
}

fn create_escrow(env: &mut Env, agent: &TestAgent, buyer: &Keypair, buyer_usdc: Pubkey, amounts: &[u64]) -> Result<TestEscrow, String> {
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
            buyer_usdc,
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

fn payout_accounts(env: &Env, agent: &TestAgent, escrow: &TestEscrow, caller: Pubkey, buyer: &Pubkey, buyer_usdc: Pubkey) -> Vec<anchor_lang::solana_program::instruction::AccountMeta> {
    solvers::accounts::PayoutMilestone {
        caller,
        config: config_pda(),
        agent: agent.key,
        escrow: escrow.key,
        vault: escrow.vault,
        creator_usdc: agent.creator_usdc,
        treasury: env.treasury,
        buyer_usdc,
        buyer_reputation: rep_pda(buyer),
        usdc_mint: env.mint,
        token_program: spl_token::ID,
    }
    .to_account_metas(None)
}

fn release(env: &mut Env, agent: &TestAgent, escrow: &TestEscrow, caller: &Keypair, buyer: &Pubkey, buyer_usdc: Pubkey, index: u8) -> Result<(), String> {
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: payout_accounts(env, agent, escrow, caller.pubkey(), buyer, buyer_usdc),
        data: solvers::instruction::ReleaseMilestone { index }.data(),
    };
    env.send(ix, &[caller])
}

fn warp(env: &mut Env, secs: i64) {
    let mut clock: solana_clock::Clock = env.svm.get_sysvar();
    clock.unix_timestamp += secs;
    env.svm.set_sysvar(&clock);
}

#[test]
fn escrow_auto_release_after_window() {
    let mut env = Env::new();
    let agent = register(&mut env, 12 * USDC, 0).unwrap();
    approve(&mut env, &agent);
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, buyer_usdc, &[10 * USDC, 10 * USDC]).unwrap();
    assert_eq!(env.balance(&escrow.vault), 20 * USDC);

    let keeper = Keypair::new();
    // Antes de passar nos testes, terceiros não liberam.
    let err = release(&mut env, &agent, &escrow, &keeper, &buyer.pubkey(), buyer_usdc, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    mark_passed(&mut env, &escrow, 0).unwrap();
    let err = release(&mut env, &agent, &escrow, &keeper, &buyer.pubkey(), buyer_usdc, 0).unwrap_err();
    assert!(err.contains("AutoReleaseNotReached"), "{err}");

    warp(&mut env, REVIEW_WINDOW + 1);
    release(&mut env, &agent, &escrow, &keeper, &buyer.pubkey(), buyer_usdc, 0).unwrap();
    assert_eq!(env.balance(&agent.creator_usdc), 100 * USDC + 9 * USDC);
    assert_eq!(env.balance(&env.treasury.clone()), USDC);

    // O comprador aprova a segunda etapa direto.
    release(&mut env, &agent, &escrow, &buyer, &buyer.pubkey(), buyer_usdc, 1).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Completed);
    assert_eq!(env.balance(&escrow.vault), 0);

    // Fechar devolve o rent para a plataforma.
    let before = env.svm.get_account(&env.payer.pubkey()).unwrap().lamports;
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::CloseEscrow {
            caller: keeper.pubkey(),
            rent_payer: env.payer.pubkey(),
            escrow: escrow.key,
            vault: escrow.vault,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: solvers::instruction::CloseEscrow {}.data(),
    };
    env.send(ix, &[&keeper]).unwrap();
    assert!(env.svm.get_account(&escrow.key).is_none_or(|a| a.lamports == 0));
    assert!(env.svm.get_account(&env.payer.pubkey()).unwrap().lamports > before);
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

fn resolve(env: &mut Env, agent: &TestAgent, escrow: &TestEscrow, buyer: &Pubkey, buyer_usdc: Pubkey, index: u8, refund: bool) -> Result<(), String> {
    let admin = env.admin.insecure_clone();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: payout_accounts(env, agent, escrow, admin.pubkey(), buyer, buyer_usdc),
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
    let escrow = create_escrow(&mut env, &agent, &buyer, buyer_usdc, &[10 * USDC, 10 * USDC]).unwrap();

    mark_passed(&mut env, &escrow, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 0).unwrap();
    dispute(&mut env, &escrow, &buyer, 1).unwrap();
    let e: Escrow = env.account(&escrow.key);
    assert_eq!(e.status, EscrowStatus::Disputed);

    // Terceiros não resolvem disputa.
    let err = release(&mut env, &agent, &escrow, &buyer, &buyer.pubkey(), buyer_usdc, 0).unwrap_err();
    assert!(err.contains("InvalidMilestoneStatus"), "{err}");

    // Etapa 0: comprador tinha razão -> reembolso, criador perde a disputa.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), buyer_usdc, 0, true).unwrap();
    assert_eq!(env.balance(&buyer_usdc), 20 * USDC);
    let a: Agent = env.account(&agent.key);
    assert_eq!(a.disputes_lost, 1);

    // Etapa 1: criador tinha razão -> paga, comprador perde a disputa.
    resolve(&mut env, &agent, &escrow, &buyer.pubkey(), buyer_usdc, 1, false).unwrap();
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
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, buyer_usdc, &[5 * USDC]).unwrap();
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
    let err = create_escrow(&mut env, &agent2, &buyer, buyer_usdc, &[5 * USDC]).err().unwrap();
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
    let (buyer, buyer_usdc) = new_buyer(&mut env, 30 * USDC);
    let escrow = create_escrow(&mut env, &agent, &buyer, buyer_usdc, &[5 * USDC]).unwrap();
    let ix = Instruction {
        program_id: solvers::ID,
        accounts: solvers::accounts::MarkPassed { verifier: buyer.pubkey(), config: config_pda(), escrow: escrow.key }
            .to_account_metas(None),
        data: solvers::instruction::MarkPassed { index: 0, deliverable_hash: [3; 32] }.data(),
    };
    let err = env.send(ix, &[&buyer]).unwrap_err();
    assert!(err.contains("NotVerifier"), "{err}");
    let _ = agent.id;
}

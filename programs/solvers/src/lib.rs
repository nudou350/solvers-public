use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
mod license;
pub mod state;

use instructions::*;

declare_id!("DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW");

#[program]
pub mod solvers {
    use super::*;

    // Administração
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: ConfigParams) -> Result<()> {
        instructions::admin::initialize_config(ctx, args)
    }
    pub fn update_config(ctx: Context<UpdateConfig>, args: ConfigParams) -> Result<()> {
        instructions::admin::update_config(ctx, args)
    }
    pub fn approve_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
        instructions::admin::approve_agent(ctx)
    }
    pub fn suspend_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
        instructions::admin::suspend_agent(ctx)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }
    pub fn cancel_admin_transfer(ctx: Context<CancelAdminTransfer>) -> Result<()> {
        instructions::admin::cancel_admin_transfer(ctx)
    }
    pub fn set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
        instructions::admin::set_treasury(ctx)
    }
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        instructions::admin::migrate_config(ctx)
    }
    pub fn set_pause(ctx: Context<SetPause>, flags: u8) -> Result<()> {
        instructions::admin::set_pause(ctx, flags)
    }
    pub fn set_guardian(ctx: Context<SetGuardian>, new_guardian: Pubkey) -> Result<()> {
        instructions::admin::set_guardian(ctx, new_guardian)
    }

    // Stake: saída do criador e confisco em duas etapas
    pub fn request_stake_exit(ctx: Context<RequestStakeExit>) -> Result<()> {
        instructions::stake::request_stake_exit(ctx)
    }
    pub fn extend_stake_exit(ctx: Context<ExtendStakeExit>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::stake::extend_stake_exit(ctx, reason_hash)
    }
    pub fn cancel_stake_exit(ctx: Context<CancelStakeExit>) -> Result<()> {
        instructions::stake::cancel_stake_exit(ctx)
    }
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        instructions::stake::withdraw_stake(ctx)
    }
    pub fn propose_slash(ctx: Context<ProposeSlash>, amount: u64, reason_hash: [u8; 32]) -> Result<()> {
        instructions::stake::propose_slash(ctx, amount, reason_hash)
    }
    pub fn contest_slash(ctx: Context<ContestSlash>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::stake::contest_slash(ctx, reason_hash)
    }
    pub fn cancel_slash(ctx: Context<CancelSlash>) -> Result<()> {
        instructions::stake::cancel_slash(ctx)
    }
    pub fn execute_slash(ctx: Context<ExecuteSlash>) -> Result<()> {
        instructions::stake::execute_slash(ctx)
    }

    // Publicação
    pub fn register_agent(ctx: Context<RegisterAgent>, args: RegisterAgentArgs) -> Result<()> {
        instructions::agent::register_agent(ctx, args)
    }
    pub fn top_up_stake(ctx: Context<TopUpStake>, amount: u64) -> Result<()> {
        instructions::agent::top_up_stake(ctx, amount)
    }
    pub fn update_version(ctx: Context<UpdateVersion>, version: String, version_hash: [u8; 32]) -> Result<()> {
        instructions::agent::update_version(ctx, version, version_hash)
    }
    pub fn update_pricing(ctx: Context<UpdatePricing>, price: u64, price_per_use: u64) -> Result<()> {
        instructions::agent::update_pricing(ctx, price, price_per_use)
    }
    pub fn set_eval(ctx: Context<SetEval>, eval_score_bps: u16, eval_hash: [u8; 32]) -> Result<()> {
        instructions::agent::set_eval(ctx, eval_score_bps, eval_hash)
    }

    // Compra e uso
    pub fn purchase_license(ctx: Context<PurchaseLicense>, expected_price: u64) -> Result<()> {
        instructions::purchase::purchase_license(ctx, expected_price)
    }
    pub fn buy_credits(ctx: Context<BuyCredits>, amount: u32, max_total: u64) -> Result<()> {
        instructions::purchase::buy_credits(ctx, amount, max_total)
    }
    pub fn consume_credit(ctx: Context<ConsumeCredit>) -> Result<()> {
        instructions::purchase::consume_credit(ctx)
    }
    pub fn record_usage_batch(ctx: Context<RecordUsageBatch>, count: u64, merkle_root: [u8; 32]) -> Result<()> {
        instructions::purchase::record_usage_batch(ctx, count, merkle_root)
    }
    pub fn submit_review(ctx: Context<SubmitReview>, rating: u8, content_hash: [u8; 32]) -> Result<()> {
        instructions::review::submit_review(ctx, rating, content_hash)
    }
    pub fn submit_review_with_credits(
        ctx: Context<SubmitReviewWithCredits>,
        rating: u8,
        content_hash: [u8; 32],
    ) -> Result<()> {
        instructions::review::submit_review_with_credits(ctx, rating, content_hash)
    }

    // Revenda de licenças (delegate sem custódia)
    pub fn list_license(ctx: Context<ListLicense>, price: u64) -> Result<()> {
        instructions::resale::list_license(ctx, price)
    }
    pub fn buy_listing(ctx: Context<BuyListing>, expected_price: u64) -> Result<()> {
        instructions::resale::buy_listing(ctx, expected_price)
    }
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        instructions::resale::cancel_listing(ctx)
    }

    // Garantia
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        nonce: u64,
        milestones: Vec<MilestoneInput>,
        review_window_secs: i64,
        delivery_days: u16,
    ) -> Result<()> {
        instructions::escrow::create_escrow(ctx, nonce, milestones, review_window_secs, delivery_days)
    }
    pub fn mark_passed(ctx: Context<MarkPassed>, index: u8, deliverable_hash: [u8; 32]) -> Result<()> {
        instructions::escrow::mark_passed(ctx, index, deliverable_hash)
    }
    pub fn release_milestone(ctx: Context<ReleaseMilestone>, index: u8) -> Result<()> {
        instructions::escrow::release_milestone(ctx, index)
    }
    pub fn open_dispute(ctx: Context<OpenDispute>, index: u8, reason_hash: [u8; 32]) -> Result<()> {
        instructions::escrow::open_dispute(ctx, index, reason_hash)
    }
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, index: u8, refund: bool) -> Result<()> {
        instructions::escrow::resolve_dispute(ctx, index, refund)
    }
    pub fn cancel_undelivered(ctx: Context<CancelUndelivered>, index: u8) -> Result<()> {
        instructions::escrow::cancel_undelivered(ctx, index)
    }
    pub fn resolve_stale_dispute(ctx: Context<ResolveStaleDispute>, index: u8) -> Result<()> {
        instructions::escrow::resolve_stale_dispute(ctx, index)
    }
    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        instructions::escrow::close_escrow(ctx)
    }
}

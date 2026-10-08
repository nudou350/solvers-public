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

    // Administration
    /// Creates the global Config (fees, min_price, stake, authorities). Must be signed by the program upgrade authority.
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: ConfigParams) -> Result<()> {
        instructions::admin::initialize_config(ctx, args)
    }
    /// Admin updates the Config parameters (fee capped at MAX_FEE_BPS, min_price, min_stake, etc.).
    pub fn update_config(ctx: Context<UpdateConfig>, args: ConfigParams) -> Result<()> {
        instructions::admin::update_config(ctx, args)
    }
    /// Admin activates a pending or suspended Solver; requires stake >= min_stake and not `Retired`.
    pub fn approve_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
        instructions::admin::approve_agent(ctx)
    }
    /// Admin suspends a Solver (stops sales). A `Retired` Solver cannot be suspended.
    pub fn suspend_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
        instructions::admin::suspend_agent(ctx)
    }

    /// Step 1 of admin transfer: the current admin nominates a new admin (one `PendingAdmin` PDA at a time).
    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }
    /// Step 2 of admin transfer: the nominee signs, becomes admin, and the proposal is closed.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }
    /// Current admin cancels a pending admin transfer; rent returns to the original payer.
    pub fn cancel_admin_transfer(ctx: Context<CancelAdminTransfer>) -> Result<()> {
        instructions::admin::cancel_admin_transfer(ctx)
    }
    /// Admin replaces the treasury USDC account (platform mint, not frozen, no delegate or close authority).
    pub fn set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
        instructions::admin::set_treasury(ctx)
    }
    /// Migrates a v1 Config (devnet) to the v2 layout by appending zeroed fields. Signed by the upgrade authority.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        instructions::admin::migrate_config(ctx)
    }
    /// Sets emergency pause bits (`PAUSE_ENTRIES`, `PAUSE_PAYMENTS`). Admin sets any valid bits;
    /// the guardian can only add bits. Buyer exits and admin instructions never pause.
    pub fn set_pause(ctx: Context<SetPause>, flags: u8) -> Result<()> {
        instructions::admin::set_pause(ctx, flags)
    }
    /// Admin sets the pause guardian; `Pubkey::default()` removes it.
    pub fn set_guardian(ctx: Context<SetGuardian>, new_guardian: Pubkey) -> Result<()> {
        instructions::admin::set_guardian(ctx, new_guardian)
    }

    // Stake: creator exit and two-step slashing
    /// Creator requests to leave: the Solver becomes `Retired` and the stake unlocks after the exit delay (30 days).
    pub fn request_stake_exit(ctx: Context<RequestStakeExit>) -> Result<()> {
        instructions::stake::request_stake_exit(ctx)
    }
    /// Admin extends a pending stake exit by 30 days (at most twice), e.g. for an open report or dispute.
    pub fn extend_stake_exit(ctx: Context<ExtendStakeExit>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::stake::extend_stake_exit(ctx, reason_hash)
    }
    /// Creator cancels the exit (Solver returns to `Suspended`); not allowed after an admin extension.
    pub fn cancel_stake_exit(ctx: Context<CancelStakeExit>) -> Result<()> {
        instructions::stake::cancel_stake_exit(ctx)
    }
    /// Creator withdraws the full stake after the exit delay, if no slash proposal is pending; closes the vault.
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        instructions::stake::withdraw_stake(ctx)
    }
    /// Admin proposes slashing `amount` of a Solver's stake; suspends an active Solver. One proposal per Solver.
    pub fn propose_slash(ctx: Context<ProposeSlash>, amount: u64, reason_hash: [u8; 32]) -> Result<()> {
        instructions::stake::propose_slash(ctx, amount, reason_hash)
    }
    /// Creator records a contest of a slash proposal (evidence hash only; the admin decides). Once per proposal.
    pub fn contest_slash(ctx: Context<ContestSlash>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::stake::contest_slash(ctx, reason_hash)
    }
    /// Cancels a slash proposal: the admin at any time, the creator only after it expires.
    pub fn cancel_slash(ctx: Context<CancelSlash>) -> Result<()> {
        instructions::stake::cancel_slash(ctx)
    }
    /// Admin executes the slash after the delay and before expiry: moves `min(amount, vault)` to the treasury.
    pub fn execute_slash(ctx: Context<ExecuteSlash>) -> Result<()> {
        instructions::stake::execute_slash(ctx)
    }

    // Publishing
    /// Creator registers a new Solver: deposits `min_stake`, creates its Metaplex Core collection, and starts it pending
    /// approval. Price must be >= min_price. Respects `PAUSE_ENTRIES`; the platform pays the rent.
    pub fn register_agent(ctx: Context<RegisterAgent>, args: RegisterAgentArgs) -> Result<()> {
        instructions::agent::register_agent(ctx, args)
    }
    /// Creator adds USDC to the Solver's stake (e.g. after a partial slash); re-activation still needs `approve_agent`.
    pub fn top_up_stake(ctx: Context<TopUpStake>, amount: u64) -> Result<()> {
        instructions::agent::top_up_stake(ctx, amount)
    }
    /// Creator records a new package version and hash. Resets the on-chain eval score to zero.
    pub fn update_version(ctx: Context<UpdateVersion>, version: String, version_hash: [u8; 32]) -> Result<()> {
        instructions::agent::update_version(ctx, version, version_hash)
    }
    /// Creator changes the license price (>= min_price) and per-use price (<= license price).
    pub fn update_pricing(ctx: Context<UpdatePricing>, price: u64, price_per_use: u64) -> Result<()> {
        instructions::agent::update_pricing(ctx, price, price_per_use)
    }
    /// Verifier records the Solver's eval score (bps) and the hash of the eval results.
    pub fn set_eval(ctx: Context<SetEval>, eval_score_bps: u16, eval_hash: [u8; 32]) -> Result<()> {
        instructions::agent::set_eval(ctx, eval_score_bps, eval_hash)
    }

    // License supply cap (optional, can only be raised)
    /// Creator sets an optional license cap for the Solver (>= 1 and >= licenses already sold).
    pub fn create_supply_cap(ctx: Context<CreateSupplyCap>, max: u32) -> Result<()> {
        instructions::supply::create_supply_cap(ctx, max)
    }
    /// Creator raises the license cap; it can never be lowered or removed.
    pub fn raise_supply_cap(ctx: Context<RaiseSupplyCap>, max: u32) -> Result<()> {
        instructions::supply::raise_supply_cap(ctx, max)
    }

    // Purchase and usage
    /// Buyer purchases a license: pays the price (split between treasury fee and creator) and receives a Metaplex
    /// Core license NFT. Fails if the price changed from `expected_price`, the Solver is not active, sold out, or paused.
    pub fn purchase_license(ctx: Context<PurchaseLicense>, expected_price: u64) -> Result<()> {
        instructions::purchase::purchase_license(ctx, expected_price)
    }
    /// Buyer purchases `amount` pay-per-use credits; total must be >= min_price and <= `max_total`. Respects `PAUSE_ENTRIES`.
    pub fn buy_credits(ctx: Context<BuyCredits>, amount: u32, max_total: u64) -> Result<()> {
        instructions::purchase::buy_credits(ctx, amount, max_total)
    }
    /// Usage authority consumes one credit from a buyer's balance and counts a verified use.
    pub fn consume_credit(ctx: Context<ConsumeCredit>) -> Result<()> {
        instructions::purchase::consume_credit(ctx)
    }
    /// Usage authority records a batch of `count` verified uses with a Merkle root of the usage log.
    pub fn record_usage_batch(ctx: Context<RecordUsageBatch>, count: u64, merkle_root: [u8; 32]) -> Result<()> {
        instructions::purchase::record_usage_batch(ctx, count, merkle_root)
    }
    /// License holder submits or edits a 1-5 rating for a Solver; a license can back only one review.
    pub fn submit_review(ctx: Context<SubmitReview>, rating: u8, content_hash: [u8; 32]) -> Result<()> {
        instructions::review::submit_review(ctx, rating, content_hash)
    }
    /// Credits buyer submits or edits a 1-5 rating for a Solver (proof by purchased credits).
    pub fn submit_review_with_credits(
        ctx: Context<SubmitReviewWithCredits>,
        rating: u8,
        content_hash: [u8; 32],
    ) -> Result<()> {
        instructions::review::submit_review_with_credits(ctx, rating, content_hash)
    }

    // License resale (non-custodial delegate)
    /// Seller lists a license for resale (price >= min_price) by approving a program PDA as transfer delegate.
    /// The seller keeps the license until sold; the creator cannot resell. Respects `PAUSE_ENTRIES`.
    pub fn list_license(ctx: Context<ListLicense>, price: u64) -> Result<()> {
        instructions::resale::list_license(ctx, price)
    }
    /// Buyer purchases a listed license: transfers the asset and pays royalty, platform fee and seller in one transaction.
    /// Fails if the price differs from `expected_price`. Respects `PAUSE_ENTRIES`.
    pub fn buy_listing(ctx: Context<BuyListing>, expected_price: u64) -> Result<()> {
        instructions::resale::buy_listing(ctx, expected_price)
    }
    /// Seller cancels a listing at any time; anyone can close a stale listing. Never paused.
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        instructions::resale::cancel_listing(ctx)
    }

    // Guarantee (escrow)
    /// Buyer funds a guarantee escrow with milestones, review window and delivery deadline; total must be >= min_price.
    /// The platform fee is frozen at creation. Respects `PAUSE_ENTRIES`.
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        nonce: u64,
        milestones: Vec<MilestoneInput>,
        review_window_secs: i64,
        delivery_days: u16,
    ) -> Result<()> {
        instructions::escrow::create_escrow(ctx, nonce, milestones, review_window_secs, delivery_days)
    }
    /// Verifier marks a pending milestone as passed with the deliverable hash. Does not respect pause.
    pub fn mark_passed(ctx: Context<MarkPassed>, index: u8, deliverable_hash: [u8; 32]) -> Result<()> {
        instructions::escrow::mark_passed(ctx, index, deliverable_hash)
    }
    /// Releases a milestone to the creator (minus fee): by the buyer, or by anyone after the review window. Respects `PAUSE_PAYMENTS`.
    pub fn release_milestone(ctx: Context<ReleaseMilestone>, index: u8) -> Result<()> {
        instructions::escrow::release_milestone(ctx, index)
    }
    /// Buyer disputes a pending milestone, or a passed one within the review window.
    pub fn open_dispute(ctx: Context<OpenDispute>, index: u8, reason_hash: [u8; 32]) -> Result<()> {
        instructions::escrow::open_dispute(ctx, index, reason_hash)
    }
    /// Admin resolves a disputed milestone: refund to the buyer or pay the creator. Respects `PAUSE_PAYMENTS`.
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, index: u8, refund: bool) -> Result<()> {
        instructions::escrow::resolve_dispute(ctx, index, refund)
    }
    /// Buyer reclaims a still-pending milestone after the delivery deadline, with no fee.
    pub fn cancel_undelivered(ctx: Context<CancelUndelivered>, index: u8) -> Result<()> {
        instructions::escrow::cancel_undelivered(ctx, index)
    }
    /// Anyone refunds a never-delivered disputed milestone if the admin did not rule within the dispute SLA
    /// and the delivery deadline has passed.
    pub fn resolve_stale_dispute(ctx: Context<ResolveStaleDispute>, index: u8) -> Result<()> {
        instructions::escrow::resolve_stale_dispute(ctx, index)
    }
    /// Closes a finished escrow: leftovers go to the buyer, rent to the original payer (only that wallet can close).
    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        instructions::escrow::close_escrow(ctx)
    }
}

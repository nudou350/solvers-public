use anchor_lang::prelude::*;

#[event]
pub struct AgentRegistered {
    pub agent: Pubkey,
    pub agent_id: [u8; 16],
    pub creator: Pubkey,
}

#[event]
pub struct AgentStatusChanged {
    pub agent: Pubkey,
    pub status: u8,
}

#[event]
pub struct AgentVersionUpdated {
    pub agent: Pubkey,
    pub version: String,
    pub version_hash: [u8; 32],
}

#[event]
pub struct EvalUpdated {
    pub agent: Pubkey,
    pub score_bps: u16,
    pub eval_hash: [u8; 32],
}

#[event]
pub struct StakeSlashed {
    pub agent: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LicensePurchased {
    pub agent: Pubkey,
    pub buyer: Pubkey,
    pub asset: Pubkey,
    pub price: u64,
}

#[event]
pub struct CreditsBought {
    pub agent: Pubkey,
    pub buyer: Pubkey,
    pub amount: u32,
}

#[event]
pub struct CreditConsumed {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub remaining: u32,
}

#[event]
pub struct UsageRecorded {
    pub agent: Pubkey,
    pub count: u64,
    pub merkle_root: [u8; 32],
}

#[event]
pub struct ReviewSubmitted {
    pub agent: Pubkey,
    pub author: Pubkey,
    pub rating: u8,
    pub content_hash: [u8; 32],
}

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub agent: Pubkey,
    pub total: u64,
}

#[event]
pub struct MilestoneUpdated {
    pub escrow: Pubkey,
    pub index: u8,
    pub status: u8,
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub index: u8,
    pub refunded: bool,
}

#[event]
pub struct ConfigUpdated {
    pub verifier: Pubkey,
    pub usage_authority: Pubkey,
    pub fee_bps: u16,
    pub min_stake: u64,
    pub min_price: u64,
}

#[event]
pub struct EscrowClosed {
    pub escrow: Pubkey,
    pub agent: Pubkey,
    pub buyer: Pubkey,
}

#[event]
pub struct AdminTransferProposed {
    pub admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminTransferCancelled {
    pub admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct TreasuryUpdated {
    pub old_treasury: Pubkey,
    pub new_treasury: Pubkey,
}

#[event]
pub struct StakeToppedUp {
    pub agent: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    /// Stake do solver depois do aporte.
    pub stake: u64,
}

#[event]
pub struct PricingUpdated {
    pub agent: Pubkey,
    pub price: u64,
    pub price_per_use: u64,
}

#[event]
pub struct PauseChanged {
    /// Quem mudou (admin ou guardian).
    pub by: Pubkey,
    pub old_flags: u8,
    pub new_flags: u8,
}

#[event]
pub struct GuardianChanged {
    pub admin: Pubkey,
    pub old_guardian: Pubkey,
    pub new_guardian: Pubkey,
}

#[event]
pub struct StakeExitRequested {
    pub agent: Pubkey,
    pub creator: Pubkey,
    pub exit_at: i64,
}

#[event]
pub struct StakeExitExtended {
    pub agent: Pubkey,
    pub exit_at: i64,
    pub extensions: u8,
    pub reason_hash: [u8; 32],
}

#[event]
pub struct StakeExitCancelled {
    pub agent: Pubkey,
    pub creator: Pubkey,
}

#[event]
pub struct StakeWithdrawn {
    pub agent: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SlashProposed {
    pub agent: Pubkey,
    pub amount: u64,
    pub reason_hash: [u8; 32],
    /// Primeiro instante em que `execute_slash` passa.
    pub executable_at: i64,
}

#[event]
pub struct SlashContested {
    pub agent: Pubkey,
    pub contest_hash: [u8; 32],
}

#[event]
pub struct SlashCancelled {
    pub agent: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SlashExecuted {
    pub agent: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,
}

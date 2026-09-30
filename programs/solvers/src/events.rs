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
pub struct PricingUpdated {
    pub agent: Pubkey,
    pub price: u64,
    pub price_per_use: u64,
}

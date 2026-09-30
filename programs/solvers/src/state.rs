use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const AGENT_SEED: &[u8] = b"agent";
pub const STAKE_SEED: &[u8] = b"stake";
pub const REP_SEED: &[u8] = b"rep";
pub const REVIEW_SEED: &[u8] = b"review";
pub const CREDITS_SEED: &[u8] = b"credits";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const ESCROW_VAULT_SEED: &[u8] = b"escrow_vault";
pub const COLLECTION_AUTHORITY_SEED: &[u8] = b"collection_authority";

pub const MAX_URI_LEN: usize = 200;
pub const MAX_VERSION_LEN: usize = 16;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_MILESTONES: usize = 5;
pub const MAX_BPS: u16 = 10_000;
/// Comprador com esse número de disputas perdidas não pode abrir nova garantia.
pub const MAX_BUYER_DISPUTES_LOST: u32 = 3;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub usage_authority: Pubkey,
    /// Token account USDC da plataforma.
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    /// Stake mínimo do criador (USDC, 6 casas).
    pub min_stake: u64,
    /// Preço mínimo de licença permanente: cobre o rent da licença pago pela plataforma.
    pub min_price: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AgentStatus {
    Pending,
    Active,
    Suspended,
}

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub agent_id: [u8; 16],
    pub creator: Pubkey,
    /// Coleção Metaplex Core das licenças.
    pub collection: Pubkey,
    /// Token account USDC que recebe os pagamentos do criador.
    pub creator_usdc: Pubkey,
    #[max_len(MAX_URI_LEN)]
    pub metadata_uri: String,
    #[max_len(MAX_VERSION_LEN)]
    pub version: String,
    pub version_hash: [u8; 32],
    pub eval_score_bps: u16,
    pub eval_hash: [u8; 32],
    pub price: u64,
    /// 0 = sem pagamento por uso.
    pub price_per_use: u64,
    pub royalty_bps: u16,
    pub stake: u64,
    pub status: AgentStatus,
    pub total_sales: u64,
    pub verified_uses: u64,
    pub rating_sum: u64,
    pub rating_count: u32,
    pub disputes_lost: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserReputation {
    pub wallet: Pubkey,
    pub purchases: u32,
    pub disputes_opened: u32,
    pub disputes_lost: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Review {
    pub agent: Pubkey,
    pub author: Pubkey,
    pub rating: u8,
    pub content_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Credits {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub remaining: u32,
    /// Total já comprado; permite avaliar mesmo depois de gastar tudo.
    pub purchased: u32,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MilestoneStatus {
    Pending,
    Passed,
    Approved,
    Disputed,
    Refunded,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Debug)]
pub struct MilestoneState {
    pub amount: u64,
    pub criteria_hash: [u8; 32],
    pub status: MilestoneStatus,
    pub deliverable_hash: [u8; 32],
    /// Quando a etapa passou nos testes (0 = ainda não passou).
    pub passed_at: i64,
    /// Hash do motivo da contestação (texto fica off-chain).
    pub dispute_reason_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum EscrowStatus {
    Active,
    Completed,
    Disputed,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub agent: Pubkey,
    pub creator: Pubkey,
    /// Quem pagou o rent (recebe de volta no close_escrow).
    pub rent_payer: Pubkey,
    pub nonce: u64,
    pub total: u64,
    #[max_len(MAX_MILESTONES)]
    pub milestones: Vec<MilestoneState>,
    /// Janela para o comprador revisar uma etapa aprovada nos testes.
    pub review_window_secs: i64,
    /// Prazo da liberação automática da etapa aprovada mais recente (0 = nenhuma).
    pub auto_release_at: i64,
    pub status: EscrowStatus,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Escrow {
    /// Recalcula o status geral depois de mudar uma etapa.
    pub fn refresh_status(&mut self) {
        let all_done = self
            .milestones
            .iter()
            .all(|m| matches!(m.status, MilestoneStatus::Approved | MilestoneStatus::Refunded));
        let any_disputed = self.milestones.iter().any(|m| m.status == MilestoneStatus::Disputed);
        let all_refunded = self.milestones.iter().all(|m| m.status == MilestoneStatus::Refunded);
        self.status = if all_refunded {
            EscrowStatus::Refunded
        } else if all_done {
            EscrowStatus::Completed
        } else if any_disputed {
            EscrowStatus::Disputed
        } else {
            EscrowStatus::Active
        };
    }
}

pub fn fee_split(amount: u64, fee_bps: u16) -> Result<(u64, u64)> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .and_then(|v| v.checked_div(MAX_BPS as u128))
        .ok_or(error!(crate::errors::SolversError::MathOverflow))? as u64;
    Ok((fee, amount - fee))
}

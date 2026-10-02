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
pub const LICENSE_REVIEW_SEED: &[u8] = b"license_review";
pub const PENDING_ADMIN_SEED: &[u8] = b"pending_admin";
pub const STAKE_EXIT_SEED: &[u8] = b"stake_exit";
pub const SLASH_SEED: &[u8] = b"slash";
pub const LISTING_SEED: &[u8] = b"listing";
/// PDA opcional por solver com o teto de licenças. Sem a conta criada (dono = System Program) o solver é ilimitado.
pub const SUPPLY_CAP_SEED: &[u8] = b"supply_cap";
/// PDA que o vendedor aprova como `TransferDelegate` do asset ao anunciar; só `buy_listing` assina com ela.
pub const MARKET_AUTHORITY_SEED: &[u8] = b"market_authority";

pub const MAX_URI_LEN: usize = 200;
pub const MAX_VERSION_LEN: usize = 16;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_MILESTONES: usize = 5;
pub const MAX_BPS: u16 = 10_000;
/// Comprador com esse número de disputas perdidas não pode abrir nova garantia.
pub const MAX_BUYER_DISPUTES_LOST: u32 = 3;
/// Teto da taxa da plataforma (20%). Vale como constante para não mudar o layout de `Config`.
pub const MAX_FEE_BPS: u16 = 2_000;
/// Prazo de entrega da garantia quando o comprador não escolhe um, e o máximo aceito (em dias).
pub const DEFAULT_DELIVERY_DAYS: u16 = 14;
pub const MAX_DELIVERY_DAYS: u16 = 60;
/// Depois de 7 dias sem o admin julgar, qualquer um pode devolver a etapa contestada ao comprador.
pub const DISPUTE_SLA_SECS: i64 = 7 * 86_400;
/// Espera entre o pedido de saída do criador e o saque do stake; o admin pode estendê-la.
pub const STAKE_EXIT_DELAY_SECS: i64 = 30 * 86_400;
/// Quantas vezes o admin pode estender a espera (cada uma soma `STAKE_EXIT_DELAY_SECS`).
pub const MAX_STAKE_EXIT_EXTENSIONS: u8 = 2;
/// Espera entre propor e executar um confisco de stake.
pub const SLASH_DELAY_SECS: i64 = 72 * 3_600;
/// Janela de execução do confisco: de `proposed_at + SLASH_DELAY_SECS` até esse prazo depois dele (inclusive).
/// Passada a janela a proposta expira: `execute_slash` falha e o criador pode fechá-la (`cancel_slash`).
pub const SLASH_EXPIRY_GRACE_SECS: i64 = 14 * 86_400;
/// Teto de `royalty_bps + fee_bps` numa revenda (50%): o vendedor sempre fica com pelo menos metade.
pub const RESALE_MAX_CUT_BPS: u16 = 5_000;

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
    /// Valor mínimo de qualquer compra (licença, pacote de créditos ou garantia): cobre o rent
    /// das contas que a plataforma paga como fee payer.
    pub min_price: u64,
    pub bump: u8,
    // ---- Config v2: campos novos só no FIM (layout v1 intacto; `migrate_config` faz o resize) ----
    /// 2 desde a v2; a conta v1 (187 bytes) não tem este campo.
    pub layout_version: u8,
    /// Bits de pausa (`PAUSE_*`). Saídas do comprador e instruções de admin nunca pausam.
    pub pause_flags: u8,
    /// Só pode LIGAR bits da pausa (nunca desligar). `Pubkey::default()` = sem guardian.
    pub guardian: Pubkey,
    /// Espaço para campos futuros (sempre zerado até alguém consumi-lo).
    pub _reserved: [u8; 64],
}

impl Config {
    /// Recusa a operação se o bit de pausa estiver ligado.
    pub fn require_not_paused(&self, bit: u8) -> Result<()> {
        require!(self.pause_flags & bit == 0, crate::errors::SolversError::Paused);
        Ok(())
    }
}

/// Config v1 (devnet): 179 bytes de dados + 8 do discriminador.
pub const CONFIG_V1_LEN: usize = 8 + 179;
/// Valor de `Config.layout_version` do layout atual.
pub const CONFIG_LAYOUT_VERSION: u8 = 2;
/// Bit 0: entradas (`register_agent`, `purchase_license`, `buy_credits`, `create_escrow`).
pub const PAUSE_ENTRIES: u8 = 1 << 0;
/// Bit 1: pagamentos (`release_milestone`, `resolve_dispute`). `mark_passed` não pausa (não move dinheiro).
pub const PAUSE_PAYMENTS: u8 = 1 << 1;
pub const PAUSE_MASK: u8 = PAUSE_ENTRIES | PAUSE_PAYMENTS;

// O v2 é o v1 mais 98 bytes no fim: `migrate_config` depende disso.
const _: () = assert!(Config::INIT_SPACE == (CONFIG_V1_LEN - 8) + 1 + 1 + 32 + 64);

/// Transferência de admin em andamento (PDA por config, só existe entre `propose_admin` e
/// `accept_admin`/`cancel_admin_transfer`). Conta à parte para não mudar o layout de `Config`.
#[account]
#[derive(InitSpace)]
pub struct PendingAdmin {
    /// Quem pode aceitar a transferência.
    pub new_admin: Pubkey,
    /// Quem pagou o rent (recebe de volta ao fechar a conta).
    pub rent_payer: Pubkey,
    pub bump: u8,
}

/// Pedido de saída do stake (PDA `[stake_exit, agent]`): existe só enquanto o solver está `Retired`.
#[account]
#[derive(InitSpace)]
pub struct StakeExit {
    /// A partir daqui (inclusive) o criador pode sacar.
    pub exit_at: i64,
    pub requested_at: i64,
    /// Extensões já aplicadas pelo admin (máximo `MAX_STAKE_EXIT_EXTENSIONS`).
    pub extensions: u8,
    /// Quem pagou o rent (recebe de volta ao fechar).
    pub rent_payer: Pubkey,
    pub bump: u8,
}

/// Proposta de confisco (PDA `[slash, agent]`): uma por solver, fechada ao executar ou cancelar.
#[account]
#[derive(InitSpace)]
pub struct SlashProposal {
    pub amount: u64,
    pub reason_hash: [u8; 32],
    pub proposed_at: i64,
    /// Contestação do criador (só evidência); `contested_at == 0` = sem contestação.
    pub contest_hash: [u8; 32],
    pub contested_at: i64,
    /// Quem pagou o rent (recebe de volta ao fechar).
    pub rent_payer: Pubkey,
    pub bump: u8,
}

/// Anúncio de revenda de uma licença (PDA `[listing, asset]`, um por asset): existe só entre `list_license`
/// e `buy_listing`/`cancel_listing`. A licença não sai da carteira do vendedor até a venda: ele apenas
/// aprova a PDA `market_authority` como `TransferDelegate`. Taxa e royalty são congelados no anúncio.
#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub asset: Pubkey,
    pub agent: Pubkey,
    /// Preço em USDC (6 casas).
    pub price: u64,
    /// `Config.fee_bps` no momento do anúncio: mudar a taxa depois não afeta este anúncio.
    pub fee_bps: u16,
    /// `Agent.royalty_bps` no momento do anúncio.
    pub royalty_bps: u16,
    pub listed_at: i64,
    /// Quem pagou o rent (recebe de volta ao fechar).
    pub rent_payer: Pubkey,
    pub bump: u8,
}

/// Teto de licenças de um solver (`create_supply_cap`). O limite vale sobre `Agent.total_sales`, que só sobe e só
/// `purchase_license` incrementa: o teto conta licenças já emitidas na vida do solver (queimar uma não reabre vaga) e a
/// revenda não consome vaga. Só pode subir (`raise_supply_cap`); `u32::MAX` equivale a ilimitado.
#[account]
#[derive(InitSpace)]
pub struct SupplyCap {
    pub agent: Pubkey,
    pub max: u32,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AgentStatus {
    Pending,
    Active,
    Suspended,
    /// Saída de stake pedida (`request_stake_exit`). Sempre no FIM do enum: os valores
    /// de `Pending`/`Active`/`Suspended` (0, 1, 2) não mudam e contas antigas seguem decodificando.
    Retired,
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

/// Marca que um asset de licença já foi usado como prova numa avaliação.
/// Impede que a mesma licença, transferida entre carteiras, gere várias avaliações.
#[account]
#[derive(InitSpace)]
pub struct LicenseReview {
    pub asset: Pubkey,
    pub review: Pubkey,
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
    /// Quando a etapa foi contestada (0 = sem contestação); conta o prazo de julgamento.
    pub disputed_at: i64,
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
    /// Taxa da plataforma no momento da criação: mudar `Config` depois não afeta esta garantia.
    pub fee_bps: u16,
    /// Prazo (unix) para o solver entregar cada etapa; vencido, o comprador cancela as pendentes.
    pub delivery_deadline: i64,
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

/// Divide o preço de uma revenda em (royalty do criador, taxa da plataforma, líquido do vendedor).
/// Royalty e taxa arredondam para baixo (u128, sem estouro) e a sobra do arredondamento fica com o vendedor.
/// O corte `royalty_bps + fee_bps` não pode passar de `RESALE_MAX_CUT_BPS`.
pub fn resale_split(price: u64, royalty_bps: u16, fee_bps: u16) -> Result<(u64, u64, u64)> {
    let cut = (royalty_bps as u128)
        .checked_add(fee_bps as u128)
        .ok_or(error!(crate::errors::SolversError::MathOverflow))?;
    require!(cut <= RESALE_MAX_CUT_BPS as u128, crate::errors::SolversError::ResaleCutTooHigh);
    let part = |bps: u16| -> Result<u64> {
        (price as u128)
            .checked_mul(bps as u128)
            .and_then(|v| v.checked_div(MAX_BPS as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(error!(crate::errors::SolversError::MathOverflow))
    };
    let royalty = part(royalty_bps)?;
    let fee = part(fee_bps)?;
    let seller = price
        .checked_sub(royalty)
        .and_then(|v| v.checked_sub(fee))
        .ok_or(error!(crate::errors::SolversError::MathOverflow))?;
    Ok((royalty, fee, seller))
}

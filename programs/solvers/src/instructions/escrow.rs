use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MilestoneInput {
    pub amount: u64,
    pub criteria_hash: [u8; 32],
}

/// Janela de revisão: de 1 minuto (demo) a 30 dias.
const MIN_REVIEW_WINDOW: i64 = 60;
const MAX_REVIEW_WINDOW: i64 = 30 * 24 * 3600;

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Box<Account<'info, Agent>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [ESCROW_SEED, buyer.key().as_ref(), agent.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(
        init,
        payer = payer,
        seeds = [ESCROW_VAULT_SEED, escrow.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = escrow
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UserReputation::INIT_SPACE,
        seeds = [REP_SEED, buyer.key().as_ref()],
        bump
    )]
    pub reputation: Box<Account<'info, UserReputation>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_escrow(
    ctx: Context<CreateEscrow>,
    nonce: u64,
    milestones: Vec<MilestoneInput>,
    review_window_secs: i64,
) -> Result<()> {
    require!(ctx.accounts.agent.status == AgentStatus::Active, SolversError::AgentNotActive);
    require!(!milestones.is_empty() && milestones.len() <= MAX_MILESTONES, SolversError::InvalidMilestones);
    require!(
        (MIN_REVIEW_WINDOW..=MAX_REVIEW_WINDOW).contains(&review_window_secs),
        SolversError::InvalidReviewWindow
    );

    let rep = &mut ctx.accounts.reputation;
    if rep.wallet == Pubkey::default() {
        rep.wallet = ctx.accounts.buyer.key();
        rep.bump = ctx.bumps.reputation;
    }
    require!(rep.disputes_lost < MAX_BUYER_DISPUTES_LOST, SolversError::BuyerNotEligible);

    let mut total: u64 = 0;
    for m in &milestones {
        require!(m.amount > 0, SolversError::InvalidAmount);
        total = total.checked_add(m.amount).ok_or(SolversError::MathOverflow)?;
    }

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        total,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.buyer = ctx.accounts.buyer.key();
    escrow.agent = ctx.accounts.agent.key();
    escrow.creator = ctx.accounts.agent.creator;
    escrow.rent_payer = ctx.accounts.payer.key();
    escrow.nonce = nonce;
    escrow.total = total;
    escrow.milestones = milestones
        .into_iter()
        .map(|m| MilestoneState {
            amount: m.amount,
            criteria_hash: m.criteria_hash,
            status: MilestoneStatus::Pending,
            deliverable_hash: [0; 32],
            passed_at: 0,
            dispute_reason_hash: [0; 32],
        })
        .collect();
    escrow.review_window_secs = review_window_secs;
    escrow.auto_release_at = 0;
    escrow.status = EscrowStatus::Active;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault;

    emit!(EscrowCreated {
        escrow: escrow.key(),
        buyer: escrow.buyer,
        agent: escrow.agent,
        total,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct MarkPassed<'info> {
    pub verifier: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = verifier @ SolversError::NotVerifier)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

pub fn mark_passed(ctx: Context<MarkPassed>, index: u8, deliverable_hash: [u8; 32]) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let now = Clock::get()?.unix_timestamp;
    let window = escrow.review_window_secs;
    let m = escrow
        .milestones
        .get_mut(index as usize)
        .ok_or(SolversError::InvalidMilestoneIndex)?;
    require!(m.status == MilestoneStatus::Pending, SolversError::InvalidMilestoneStatus);
    m.status = MilestoneStatus::Passed;
    m.deliverable_hash = deliverable_hash;
    m.passed_at = now;
    escrow.auto_release_at = now + window;
    let key = escrow.key();
    emit!(MilestoneUpdated { escrow: key, index, status: MilestoneStatus::Passed as u8 });
    Ok(())
}

#[derive(Accounts)]
pub struct PayoutMilestone<'info> {
    /// Comprador, admin, ou qualquer um (liberação automática).
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator_usdc)]
    pub agent: Box<Account<'info, Agent>>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump,
        has_one = agent
    )]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [ESCROW_VAULT_SEED, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = escrow.buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [REP_SEED, escrow.buyer.as_ref()],
        bump = buyer_reputation.bump
    )]
    pub buyer_reputation: Box<Account<'info, UserReputation>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

impl<'info> PayoutMilestone<'info> {
    fn vault_transfer(&self, to: &Account<'info, TokenAccount>, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let escrow = &self.escrow;
        let nonce = escrow.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &nonce, &[escrow.bump]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.key(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    mint: self.usdc_mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            self.usdc_mint.decimals,
        )
    }

    /// Paga a etapa ao criador descontando a taxa da plataforma.
    fn pay_creator(&self, amount: u64) -> Result<()> {
        let (fee, rest) = fee_split(amount, self.config.fee_bps)?;
        self.vault_transfer(&self.treasury, fee)?;
        self.vault_transfer(&self.creator_usdc, rest)
    }
}

pub fn release_milestone(ctx: Context<PayoutMilestone>, index: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let caller = ctx.accounts.caller.key();
    let escrow = &ctx.accounts.escrow;
    let window = escrow.review_window_secs;
    let m = escrow.milestones.get(index as usize).ok_or(SolversError::InvalidMilestoneIndex)?;
    let is_buyer = caller == escrow.buyer;
    if is_buyer {
        require!(
            matches!(m.status, MilestoneStatus::Pending | MilestoneStatus::Passed),
            SolversError::InvalidMilestoneStatus
        );
    } else {
        require!(m.status == MilestoneStatus::Passed, SolversError::InvalidMilestoneStatus);
        require!(now >= m.passed_at + window, SolversError::AutoReleaseNotReached);
    }
    let amount = m.amount;
    ctx.accounts.pay_creator(amount)?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.milestones[index as usize].status = MilestoneStatus::Approved;
    escrow.refresh_status();
    let key = escrow.key();
    emit!(MilestoneUpdated { escrow: key, index, status: MilestoneStatus::Approved as u8 });
    Ok(())
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer @ SolversError::NotBuyer)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds = [REP_SEED, buyer.key().as_ref()], bump = reputation.bump)]
    pub reputation: Account<'info, UserReputation>,
}

pub fn open_dispute(ctx: Context<OpenDispute>, index: u8, reason_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let escrow = &mut ctx.accounts.escrow;
    let window = escrow.review_window_secs;
    let m = escrow
        .milestones
        .get_mut(index as usize)
        .ok_or(SolversError::InvalidMilestoneIndex)?;
    match m.status {
        MilestoneStatus::Pending => {}
        MilestoneStatus::Passed => require!(now < m.passed_at + window, SolversError::DisputeWindowClosed),
        _ => return err!(SolversError::InvalidMilestoneStatus),
    }
    m.status = MilestoneStatus::Disputed;
    m.dispute_reason_hash = reason_hash;
    escrow.refresh_status();
    let rep = &mut ctx.accounts.reputation;
    rep.disputes_opened = rep.disputes_opened.saturating_add(1);
    let key = escrow.key();
    emit!(MilestoneUpdated { escrow: key, index, status: MilestoneStatus::Disputed as u8 });
    Ok(())
}

pub fn resolve_dispute(ctx: Context<PayoutMilestone>, index: u8, refund: bool) -> Result<()> {
    require_keys_eq!(ctx.accounts.caller.key(), ctx.accounts.config.admin, SolversError::NotAdmin);
    let m = ctx
        .accounts
        .escrow
        .milestones
        .get(index as usize)
        .ok_or(SolversError::InvalidMilestoneIndex)?;
    require!(m.status == MilestoneStatus::Disputed, SolversError::InvalidMilestoneStatus);
    let amount = m.amount;

    let new_status = if refund {
        ctx.accounts.vault_transfer(&ctx.accounts.buyer_usdc, amount)?;
        let agent = &mut ctx.accounts.agent;
        agent.disputes_lost = agent.disputes_lost.saturating_add(1);
        MilestoneStatus::Refunded
    } else {
        ctx.accounts.pay_creator(amount)?;
        let rep = &mut ctx.accounts.buyer_reputation;
        rep.disputes_lost = rep.disputes_lost.saturating_add(1);
        MilestoneStatus::Approved
    };

    let escrow = &mut ctx.accounts.escrow;
    escrow.milestones[index as usize].status = new_status;
    escrow.refresh_status();
    let key = escrow.key();
    emit!(DisputeResolved { escrow: key, index, refunded: refund });
    emit!(MilestoneUpdated { escrow: key, index, status: new_status as u8 });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    pub caller: Signer<'info>,
    /// CHECK: recebe o rent de volta; validado contra escrow.rent_payer.
    #[account(mut, address = escrow.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_payer,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds = [ESCROW_VAULT_SEED, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Fecha um escrow encerrado e devolve o rent a quem pagou (a plataforma).
pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    require!(
        matches!(escrow.status, EscrowStatus::Completed | EscrowStatus::Refunded),
        SolversError::InvalidMilestoneStatus
    );
    require!(ctx.accounts.vault.amount == 0, SolversError::InvalidAmount);
    let nonce = escrow.nonce.to_le_bytes();
    let seeds: &[&[u8]] = &[ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &nonce, &[escrow.bump]];
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.rent_payer.to_account_info(),
            authority: escrow.to_account_info(),
        },
        &[seeds],
    ))
}

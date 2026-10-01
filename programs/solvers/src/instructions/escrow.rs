use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
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
    delivery_days: u16,
) -> Result<()> {
    ctx.accounts.config.require_not_paused(PAUSE_ENTRIES)?;
    require!(ctx.accounts.agent.status == AgentStatus::Active, SolversError::AgentNotActive);
    require!(!milestones.is_empty() && milestones.len() <= MAX_MILESTONES, SolversError::InvalidMilestones);
    require!(
        (MIN_REVIEW_WINDOW..=MAX_REVIEW_WINDOW).contains(&review_window_secs),
        SolversError::InvalidReviewWindow
    );
    require!(delivery_days <= MAX_DELIVERY_DAYS, SolversError::InvalidDeliveryDays);
    let days = if delivery_days == 0 { DEFAULT_DELIVERY_DAYS } else { delivery_days };
    let now = Clock::get()?.unix_timestamp;

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
    // Garantia mínima: a plataforma paga o rent do escrow e do cofre.
    require!(total >= ctx.accounts.config.min_price, SolversError::PriceTooLow);

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
            disputed_at: 0,
        })
        .collect();
    escrow.review_window_secs = review_window_secs;
    escrow.auto_release_at = 0;
    escrow.status = EscrowStatus::Active;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault;
    // A taxa fica congelada na criação: um update_config posterior não muda o que o criador recebe.
    escrow.fee_bps = ctx.accounts.config.fee_bps;
    escrow.delivery_deadline = now
        .checked_add(days as i64 * 86_400)
        .ok_or(SolversError::MathOverflow)?;

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
    ctx.accounts.config.require_not_paused(PAUSE_PAYMENTS)?;
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

/// Transfere do cofre do escrow assinando com a PDA do escrow.
fn vault_transfer<'info>(
    escrow: &Account<'info, Escrow>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let nonce = escrow.nonce.to_le_bytes();
    let seeds: &[&[u8]] = &[ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &nonce, &[escrow.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: escrow.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

/// Paga a etapa ao criador descontando a taxa da plataforma.
#[allow(clippy::too_many_arguments)]
fn pay_creator<'info>(
    escrow: &Account<'info, Escrow>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    treasury: &Account<'info, TokenAccount>,
    creator_usdc: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
    fee_bps: u16,
) -> Result<()> {
    let (fee, rest) = fee_split(amount, fee_bps)?;
    vault_transfer(escrow, vault, mint, treasury, token_program, fee)?;
    vault_transfer(escrow, vault, mint, creator_usdc, token_program, rest)
}

/// Liberação de etapa: só precisa das contas de quem recebe (criador e tesouraria).
#[derive(Accounts)]
pub struct ReleaseMilestone<'info> {
    /// Comprador (aprovação) ou qualquer um (liberação automática depois do prazo).
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator_usdc)]
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
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn release_milestone(ctx: Context<ReleaseMilestone>, index: u8) -> Result<()> {
    ctx.accounts.config.require_not_paused(PAUSE_PAYMENTS)?;
    let now = Clock::get()?.unix_timestamp;
    let caller = ctx.accounts.caller.key();
    let escrow = &ctx.accounts.escrow;
    let window = escrow.review_window_secs;
    let m = escrow.milestones.get(index as usize).ok_or(SolversError::InvalidMilestoneIndex)?;
    if caller == escrow.buyer {
        require!(
            matches!(m.status, MilestoneStatus::Pending | MilestoneStatus::Passed),
            SolversError::InvalidMilestoneStatus
        );
    } else {
        require!(m.status == MilestoneStatus::Passed, SolversError::InvalidMilestoneStatus);
        require!(now >= m.passed_at + window, SolversError::AutoReleaseNotReached);
    }
    let amount = m.amount;
    let a = &ctx.accounts;
    pay_creator(
        &a.escrow,
        &a.vault,
        &a.usdc_mint,
        &a.treasury,
        &a.creator_usdc,
        &a.token_program,
        amount,
        a.escrow.fee_bps,
    )?;

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
    m.disputed_at = now;
    escrow.refresh_status();
    let rep = &mut ctx.accounts.reputation;
    rep.disputes_opened = rep.disputes_opened.saturating_add(1);
    let key = escrow.key();
    emit!(MilestoneUpdated { escrow: key, index, status: MilestoneStatus::Disputed as u8 });
    Ok(())
}

/// Resolução de disputa pelo admin. A conta do comprador é validada pelo ENDEREÇO da ATA (dono
/// esperado + mint), não pelo dono atual do token: quem troca o dono da própria ATA (SetAuthority)
/// não consegue travar a resolução, e o destino continua sendo o endereço derivado do comprador.
#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolversError::NotAdmin,
        has_one = usdc_mint,
        has_one = treasury
    )]
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
    #[account(mut, token::mint = usdc_mint, address = get_associated_token_address(&escrow.buyer, &usdc_mint.key()))]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [REP_SEED, escrow.buyer.as_ref()], bump = buyer_reputation.bump)]
    pub buyer_reputation: Box<Account<'info, UserReputation>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn resolve_dispute(ctx: Context<ResolveDispute>, index: u8, refund: bool) -> Result<()> {
    ctx.accounts.config.require_not_paused(PAUSE_PAYMENTS)?;
    let m = ctx
        .accounts
        .escrow
        .milestones
        .get(index as usize)
        .ok_or(SolversError::InvalidMilestoneIndex)?;
    require!(m.status == MilestoneStatus::Disputed, SolversError::InvalidMilestoneStatus);
    let amount = m.amount;

    let a = &ctx.accounts;
    let new_status = if refund {
        vault_transfer(&a.escrow, &a.vault, &a.usdc_mint, &a.buyer_usdc, &a.token_program, amount)?;
        let agent = &mut ctx.accounts.agent;
        agent.disputes_lost = agent.disputes_lost.saturating_add(1);
        MilestoneStatus::Refunded
    } else {
        pay_creator(
            &a.escrow,
            &a.vault,
            &a.usdc_mint,
            &a.treasury,
            &a.creator_usdc,
            &a.token_program,
            amount,
            a.escrow.fee_bps,
        )?;
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

/// Cancelamento por atraso: passado o prazo de entrega, o comprador recupera as etapas que o
/// solver nem chegou a entregar (ainda Pending), sem taxa.
#[derive(Accounts)]
pub struct CancelUndelivered<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump,
        has_one = buyer @ SolversError::NotBuyer
    )]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [ESCROW_VAULT_SEED, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn cancel_undelivered(ctx: Context<CancelUndelivered>, index: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let deadline = ctx.accounts.escrow.delivery_deadline;
    let m = ctx
        .accounts
        .escrow
        .milestones
        .get(index as usize)
        .ok_or(SolversError::InvalidMilestoneIndex)?;
    require!(m.status == MilestoneStatus::Pending, SolversError::InvalidMilestoneStatus);
    require!(now > deadline, SolversError::DeliveryDeadlineNotReached);
    let amount = m.amount;

    // O status sai de Pending uma única vez: a etapa não pode ser devolvida (nem paga) de novo.
    let escrow = &mut ctx.accounts.escrow;
    escrow.milestones[index as usize].status = MilestoneStatus::Refunded;
    escrow.refresh_status();
    let a = &ctx.accounts;
    vault_transfer(&a.escrow, &a.vault, &a.usdc_mint, &a.buyer_usdc, &a.token_program, amount)?;
    let key = a.escrow.key();
    emit!(MilestoneUpdated { escrow: key, index, status: MilestoneStatus::Refunded as u8 });
    Ok(())
}

/// Disputa parada de etapa nunca entregue: se o admin não julgar em DISPUTE_SLA_SECS e o prazo de
/// entrega já venceu, qualquer um devolve a etapa ao comprador. A conta do comprador é a ATA, como em resolve_dispute. Não mexe em reputação: nem o
/// solver nem o comprador perderam a disputa.
#[derive(Accounts)]
pub struct ResolveStaleDispute<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [ESCROW_VAULT_SEED, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, address = get_associated_token_address(&escrow.buyer, &usdc_mint.key()))]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn resolve_stale_dispute(ctx: Context<ResolveStaleDispute>, index: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let m = ctx
        .accounts
        .escrow
        .milestones
        .get(index as usize)
        .ok_or(SolversError::InvalidMilestoneIndex)?;
    require!(m.status == MilestoneStatus::Disputed, SolversError::InvalidMilestoneStatus);
    // Etapa que já passou nos testes (passed_at não é zerado por open_dispute) e foi contestada
    // é um caso de julgamento: só o admin decide, senão bastaria baixar a entrega e esperar.
    require!(m.passed_at == 0, SolversError::StaleDisputeNeedsJudgment);
    let due = m.disputed_at.checked_add(DISPUTE_SLA_SECS).ok_or(SolversError::MathOverflow)?;
    require!(now >= due, SolversError::DisputeSlaNotReached);
    // Nunca entregue: o reembolso automático também respeita o prazo de entrega, senão contestar
    // no 1º dia (o que tira a etapa de Pending e impede a entrega) ignoraria delivery_days.
    require!(now > ctx.accounts.escrow.delivery_deadline, SolversError::DeliveryDeadlineNotReached);
    let amount = m.amount;

    // O status sai de Disputed uma única vez: o admin (resolve_dispute) e este caminho se excluem.
    let escrow = &mut ctx.accounts.escrow;
    escrow.milestones[index as usize].status = MilestoneStatus::Refunded;
    escrow.refresh_status();
    let a = &ctx.accounts;
    vault_transfer(&a.escrow, &a.vault, &a.usdc_mint, &a.buyer_usdc, &a.token_program, amount)?;
    let key = a.escrow.key();
    emit!(DisputeResolved { escrow: key, index, refunded: true });
    emit!(MilestoneUpdated { escrow: key, index, status: MilestoneStatus::Refunded as u8 });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    /// Só quem pagou o rent (a plataforma) fecha; o rent volta para essa mesma carteira.
    #[account(address = escrow.rent_payer @ SolversError::NotRentPayer)]
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
    /// Recebe qualquer sobra do cofre (ex: USDC enviado por fora).
    #[account(mut, token::mint = usdc_mint, address = get_associated_token_address(&escrow.buyer, &usdc_mint.key()))]
    pub buyer_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Fecha um escrow encerrado: devolve sobras ao comprador e o rent a quem pagou (a plataforma).
/// Só essa carteira pode fechar, para o fechamento não tirar da vitrine um escrow que o comprador
/// ainda quer consultar.
pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
    let a = &ctx.accounts;
    require!(
        matches!(a.escrow.status, EscrowStatus::Completed | EscrowStatus::Refunded),
        SolversError::InvalidMilestoneStatus
    );
    vault_transfer(&a.escrow, &a.vault, &a.usdc_mint, &a.buyer_usdc, &a.token_program, a.vault.amount)?;
    let escrow = &a.escrow;
    let nonce = escrow.nonce.to_le_bytes();
    let seeds: &[&[u8]] = &[ESCROW_SEED, escrow.buyer.as_ref(), escrow.agent.as_ref(), &nonce, &[escrow.bump]];
    token::close_account(CpiContext::new_with_signer(
        a.token_program.key(),
        CloseAccount {
            account: a.vault.to_account_info(),
            destination: a.rent_payer.to_account_info(),
            authority: escrow.to_account_info(),
        },
        &[seeds],
    ))?;
    emit!(EscrowClosed { escrow: escrow.key(), agent: escrow.agent, buyer: escrow.buyer });
    Ok(())
}

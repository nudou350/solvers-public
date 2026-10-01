//! Ciclo de vida do stake: saída do criador (30 dias, com extensão do admin) e confisco em duas etapas
//! (o admin propõe, espera 72 h e executa; o criador pode registrar contestação).
//!
//! Pausa: nenhuma instrução deste arquivo respeita `Config.pause_flags`. A saída do criador e a
//! contestação são saídas (nunca pausam) e as do admin são controles, como `set_pause`. Quem congela
//! o dinheiro é o prazo (30 dias, extensível 2 vezes) e a proposta de confisco pendente.
//!
//! Cada PDA nova (`StakeExit`, `SlashProposal`) nasce com `init` e é fechada ao fim do ciclo: nada de
//! `init_if_needed` nem estado reaproveitado. O rent volta a quem o pagou (`rent_payer`, gravado na conta).
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

/// Transfere do cofre de stake assinando com a PDA do agente.
fn stake_transfer<'info>(
    agent: &Account<'info, Agent>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[AGENT_SEED, agent.agent_id.as_ref(), &[agent.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: agent.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

// ------------------------------------------------------------------------------ saída do criador ----

/// O criador pede para sair: o solver vira `Retired` (some da venda como um suspenso) e o stake só pode
/// ser sacado depois de `STAKE_EXIT_DELAY_SECS`. A plataforma paga o rent da `StakeExit` e o recebe de volta.
#[derive(Accounts)]
pub struct RequestStakeExit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = creator @ SolversError::NotCreator,
        constraint = agent.status != AgentStatus::Retired @ SolversError::AgentRetired
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = payer,
        space = 8 + StakeExit::INIT_SPACE,
        seeds = [STAKE_EXIT_SEED, agent.key().as_ref()],
        bump
    )]
    pub stake_exit: Account<'info, StakeExit>,
    pub system_program: Program<'info, System>,
}

pub fn request_stake_exit(ctx: Context<RequestStakeExit>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let exit_at = now.checked_add(STAKE_EXIT_DELAY_SECS).ok_or(SolversError::MathOverflow)?;
    let exit = &mut ctx.accounts.stake_exit;
    exit.exit_at = exit_at;
    exit.requested_at = now;
    exit.extensions = 0;
    exit.rent_payer = ctx.accounts.payer.key();
    exit.bump = ctx.bumps.stake_exit;
    let agent = &mut ctx.accounts.agent;
    agent.status = AgentStatus::Retired;
    emit!(StakeExitRequested { agent: agent.key(), creator: ctx.accounts.creator.key(), exit_at });
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

/// O admin estende a espera (denúncia ou disputa em aberto): +30 dias, no máximo 2 vezes.
#[derive(Accounts)]
pub struct ExtendStakeExit<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(mut, seeds = [STAKE_EXIT_SEED, agent.key().as_ref()], bump = stake_exit.bump)]
    pub stake_exit: Account<'info, StakeExit>,
}

pub fn extend_stake_exit(ctx: Context<ExtendStakeExit>, reason_hash: [u8; 32]) -> Result<()> {
    let exit = &mut ctx.accounts.stake_exit;
    require!(exit.extensions < MAX_STAKE_EXIT_EXTENSIONS, SolversError::StakeExitExtensionsExhausted);
    exit.exit_at = exit.exit_at.checked_add(STAKE_EXIT_DELAY_SECS).ok_or(SolversError::MathOverflow)?;
    exit.extensions = exit.extensions.checked_add(1).ok_or(SolversError::MathOverflow)?;
    emit!(StakeExitExtended {
        agent: ctx.accounts.agent.key(),
        exit_at: exit.exit_at,
        extensions: exit.extensions,
        reason_hash,
    });
    Ok(())
}

/// O criador desiste da saída: volta a `Suspended` (nunca a `Active`; reativar é `approve_agent`).
#[derive(Accounts)]
pub struct CancelStakeExit<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = creator @ SolversError::NotCreator,
        constraint = agent.status == AgentStatus::Retired @ SolversError::AgentNotRetired
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        seeds = [STAKE_EXIT_SEED, agent.key().as_ref()],
        bump = stake_exit.bump,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub stake_exit: Account<'info, StakeExit>,
    /// CHECK: destino fixo do rent, gravado no pedido (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn cancel_stake_exit(ctx: Context<CancelStakeExit>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    agent.status = AgentStatus::Suspended;
    emit!(StakeExitCancelled { agent: agent.key(), creator: ctx.accounts.creator.key() });
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

/// Saque do stake: `Retired`, prazo vencido e nenhuma proposta de confisco pendente. Devolve o saldo
/// inteiro do cofre à ATA do criador (validada pelo ENDEREÇO derivado + mint, não pelo dono atual:
/// quem troca o dono da própria ATA não trava o saque, como em `resolve_dispute`), fecha o cofre
/// (rent ao criador) e a `StakeExit` (rent a quem pagou). Depois disso o solver não volta mais.
#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    /// Recebe o rent do cofre; assina.
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = creator @ SolversError::NotCreator
    )]
    pub agent: Box<Account<'info, Agent>>,
    #[account(mut, seeds = [STAKE_SEED, agent.key().as_ref()], bump, token::mint = usdc_mint, token::authority = agent)]
    pub stake_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [STAKE_EXIT_SEED, agent.key().as_ref()],
        bump = stake_exit.bump,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub stake_exit: Box<Account<'info, StakeExit>>,
    /// CHECK: destino fixo do rent, gravado no pedido (`has_one = rent_payer`); pode ser o próprio criador.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    /// CHECK: PDA da proposta de confisco; só interessa se existe (dono = este programa). Fica vazia
    /// (dono = System Program, sem dados) quando não há proposta, mesmo que alguém a tenha pré-financiado.
    #[account(seeds = [SLASH_SEED, agent.key().as_ref()], bump)]
    pub slash_proposal: UncheckedAccount<'info>,
    #[account(mut, token::mint = usdc_mint, address = get_associated_token_address(&agent.creator, &usdc_mint.key()))]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
    require!(ctx.accounts.agent.status == AgentStatus::Retired, SolversError::AgentNotRetired);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.stake_exit.exit_at, SolversError::StakeExitNotReached);
    // Sem proposta de confisco: a PDA tem de estar vazia. Lamports não contam (qualquer um pode
    // pré-financiar o endereço); uma conta de dono do System Program e sem dados não é proposta.
    let slash = ctx.accounts.slash_proposal.to_account_info();
    require!(
        slash.owner == &anchor_lang::system_program::ID && slash.data_is_empty(),
        SolversError::SlashPending
    );

    let amount = ctx.accounts.stake_vault.amount;
    let a = &ctx.accounts;
    stake_transfer(&a.agent, &a.stake_vault, &a.usdc_mint, &a.creator_usdc, &a.token_program, amount)?;
    let seeds: &[&[u8]] = &[AGENT_SEED, a.agent.agent_id.as_ref(), &[a.agent.bump]];
    token::close_account(CpiContext::new_with_signer(
        a.token_program.key(),
        CloseAccount {
            account: a.stake_vault.to_account_info(),
            destination: a.creator.to_account_info(),
            authority: a.agent.to_account_info(),
        },
        &[seeds],
    ))?;
    let agent = &mut ctx.accounts.agent;
    agent.stake = 0;
    emit!(StakeWithdrawn { agent: agent.key(), creator: ctx.accounts.creator.key(), amount });
    Ok(())
}

// --------------------------------------------------------------------------------------- confisco ----

/// O admin propõe confiscar `amount` do stake. A proposta suspende o solver (se estava ativo) e só
/// pode ser executada depois de `SLASH_DELAY_SECS`; uma por solver. A plataforma paga o rent.
#[derive(Accounts)]
pub struct ProposeSlash<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Box<Account<'info, Agent>>,
    #[account(
        init,
        payer = payer,
        space = 8 + SlashProposal::INIT_SPACE,
        seeds = [SLASH_SEED, agent.key().as_ref()],
        bump
    )]
    pub slash_proposal: Box<Account<'info, SlashProposal>>,
    pub system_program: Program<'info, System>,
}

pub fn propose_slash(ctx: Context<ProposeSlash>, amount: u64, reason_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let executable_at = now.checked_add(SLASH_DELAY_SECS).ok_or(SolversError::MathOverflow)?;
    let agent = &mut ctx.accounts.agent;
    require!(amount > 0, SolversError::InvalidAmount);
    require!(amount <= agent.stake, SolversError::InsufficientStake);
    let p = &mut ctx.accounts.slash_proposal;
    p.amount = amount;
    p.reason_hash = reason_hash;
    p.proposed_at = now;
    p.contest_hash = [0; 32];
    p.contested_at = 0;
    p.rent_payer = ctx.accounts.payer.key();
    p.bump = ctx.bumps.slash_proposal;
    emit!(SlashProposed { agent: agent.key(), amount, reason_hash, executable_at });
    // Ativo vira suspenso já na proposta; `Retired` continua `Retired` (a saída segue, travada pela proposta).
    if agent.status == AgentStatus::Active {
        agent.status = AgentStatus::Suspended;
        emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    }
    Ok(())
}

/// O criador registra a contestação (só evidência: o admin decide). Uma vez por proposta.
#[derive(Accounts)]
pub struct ContestSlash<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator @ SolversError::NotCreator)]
    pub agent: Account<'info, Agent>,
    #[account(mut, seeds = [SLASH_SEED, agent.key().as_ref()], bump = slash_proposal.bump)]
    pub slash_proposal: Account<'info, SlashProposal>,
}

pub fn contest_slash(ctx: Context<ContestSlash>, reason_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.slash_proposal;
    require!(p.contested_at == 0, SolversError::SlashAlreadyContested);
    p.contest_hash = reason_hash;
    p.contested_at = now;
    emit!(SlashContested { agent: ctx.accounts.agent.key(), contest_hash: reason_hash });
    Ok(())
}

/// O admin desiste da proposta. O solver continua suspenso até um `approve_agent`.
#[derive(Accounts)]
pub struct CancelSlash<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        seeds = [SLASH_SEED, agent.key().as_ref()],
        bump = slash_proposal.bump,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub slash_proposal: Account<'info, SlashProposal>,
    /// CHECK: destino fixo do rent, gravado na proposta (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn cancel_slash(ctx: Context<CancelSlash>) -> Result<()> {
    emit!(SlashCancelled { agent: ctx.accounts.agent.key(), amount: ctx.accounts.slash_proposal.amount });
    Ok(())
}

/// Executa o confisco depois da espera: `min(amount, cofre)` vai à tesouraria, o stake cai o mesmo
/// tanto, o solver fica suspenso (`Retired` fica `Retired`) e a proposta é fechada.
#[derive(Accounts)]
pub struct ExecuteSlash<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin, has_one = treasury, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Box<Account<'info, Agent>>,
    #[account(mut, seeds = [STAKE_SEED, agent.key().as_ref()], bump, token::mint = usdc_mint, token::authority = agent)]
    pub stake_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [SLASH_SEED, agent.key().as_ref()],
        bump = slash_proposal.bump,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub slash_proposal: Box<Account<'info, SlashProposal>>,
    /// CHECK: destino fixo do rent, gravado na proposta (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn execute_slash(ctx: Context<ExecuteSlash>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let due = ctx
        .accounts
        .slash_proposal
        .proposed_at
        .checked_add(SLASH_DELAY_SECS)
        .ok_or(SolversError::MathOverflow)?;
    require!(now >= due, SolversError::SlashDelayNotReached);

    let amount = ctx.accounts.slash_proposal.amount.min(ctx.accounts.stake_vault.amount);
    let a = &ctx.accounts;
    stake_transfer(&a.agent, &a.stake_vault, &a.usdc_mint, &a.treasury, &a.token_program, amount)?;
    let agent = &mut ctx.accounts.agent;
    agent.stake = agent.stake.checked_sub(amount).ok_or(SolversError::InsufficientStake)?;
    emit!(SlashExecuted { agent: agent.key(), amount, treasury: ctx.accounts.treasury.key() });
    // Evento antigo (o indexador já o usa para reler o solver).
    emit!(StakeSlashed { agent: agent.key(), amount });
    if agent.status != AgentStatus::Retired && agent.status != AgentStatus::Suspended {
        agent.status = AgentStatus::Suspended;
        emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    }
    Ok(())
}

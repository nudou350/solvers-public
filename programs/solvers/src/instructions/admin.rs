use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigParams {
    pub verifier: Pubkey,
    pub usage_authority: Pubkey,
    pub fee_bps: u16,
    pub min_stake: u64,
    pub min_price: u64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// Precisa ser a upgrade authority do programa: evita que outra pessoa inicialize primeiro.
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ SolversError::NotAdmin)]
    pub program: Program<'info, crate::program::Solvers>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ SolversError::NotAdmin)]
    pub program_data: Account<'info, ProgramData>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(token::mint = usdc_mint)]
    pub treasury: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, args: ConfigParams) -> Result<()> {
    require!(args.fee_bps <= MAX_BPS, SolversError::InvalidBps);
    require!(args.fee_bps <= MAX_FEE_BPS, SolversError::FeeTooHigh);
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.verifier = args.verifier;
    config.usage_authority = args.usage_authority;
    config.treasury = ctx.accounts.treasury.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.fee_bps = args.fee_bps;
    config.min_stake = args.min_stake;
    config.min_price = args.min_price;
    config.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
}

pub fn update_config(ctx: Context<UpdateConfig>, args: ConfigParams) -> Result<()> {
    require!(args.fee_bps <= MAX_BPS, SolversError::InvalidBps);
    require!(args.fee_bps <= MAX_FEE_BPS, SolversError::FeeTooHigh);
    let config = &mut ctx.accounts.config;
    config.verifier = args.verifier;
    config.usage_authority = args.usage_authority;
    config.fee_bps = args.fee_bps;
    config.min_stake = args.min_stake;
    config.min_price = args.min_price;
    emit!(ConfigUpdated {
        verifier: config.verifier,
        usage_authority: config.usage_authority,
        fee_bps: config.fee_bps,
        min_stake: config.min_stake,
        min_price: config.min_price,
    });
    Ok(())
}

/// Passo 1 da troca de admin: o admin atual indica o novo. A proposta é uma PDA própria
/// (`PendingAdmin`, `init`): só existe uma por vez e só some com `accept_admin` ou `cancel_admin_transfer`.
#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    /// Paga o rent da proposta (a plataforma patrocina as taxas); recebe de volta ao fechar.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = 8 + PendingAdmin::INIT_SPACE,
        seeds = [PENDING_ADMIN_SEED, config.key().as_ref()],
        bump
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    pub system_program: Program<'info, System>,
}

pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
    // Chave nula nunca assina; igual ao admin atual não muda nada.
    require!(
        new_admin != Pubkey::default() && new_admin != ctx.accounts.admin.key(),
        SolversError::InvalidNewAdmin
    );
    let pending = &mut ctx.accounts.pending_admin;
    pending.new_admin = new_admin;
    pending.rent_payer = ctx.accounts.payer.key();
    pending.bump = ctx.bumps.pending_admin;
    emit!(AdminTransferProposed { admin: ctx.accounts.admin.key(), new_admin });
    Ok(())
}

/// Passo 2: quem foi indicado aceita, vira o admin e a proposta é fechada.
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PENDING_ADMIN_SEED, config.key().as_ref()],
        bump = pending_admin.bump,
        has_one = new_admin @ SolversError::NotPendingAdmin,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    /// CHECK: destino fixo do rent, gravado na proposta (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_admin = config.admin;
    config.admin = ctx.accounts.new_admin.key();
    emit!(AdminTransferred { old_admin, new_admin: config.admin });
    Ok(())
}

/// O admin atual desiste da proposta (por exemplo, indicou a chave errada).
#[derive(Accounts)]
pub struct CancelAdminTransfer<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PENDING_ADMIN_SEED, config.key().as_ref()],
        bump = pending_admin.bump,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    /// CHECK: destino fixo do rent, gravado na proposta (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn cancel_admin_transfer(ctx: Context<CancelAdminTransfer>) -> Result<()> {
    emit!(AdminTransferCancelled {
        admin: ctx.accounts.admin.key(),
        new_admin: ctx.accounts.pending_admin.new_admin,
    });
    Ok(())
}

/// Troca a conta de USDC do tesouro. Os demais fluxos validam o tesouro por `has_one = treasury`,
/// então basta atualizar o campo.
#[derive(Accounts)]
pub struct SetTreasury<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    /// Precisa existir, ser do USDC da plataforma e não estar congelada.
    #[account(token::mint = usdc_mint)]
    pub new_treasury: Account<'info, TokenAccount>,
}

pub fn set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
    // Sem delegate nem close_authority: quem tivesse um deles poderia esvaziar/fechar o tesouro
    // (fechamento só com saldo zero) e travar compras e liberações da plataforma inteira (DoS).
    let treasury = &ctx.accounts.new_treasury;
    require!(
        !treasury.is_frozen()
            && treasury.delegate.is_none()
            && treasury.close_authority.is_none()
            && treasury.delegated_amount == 0,
        SolversError::InvalidTokenAccount
    );
    let config = &mut ctx.accounts.config;
    let old_treasury = config.treasury;
    config.treasury = ctx.accounts.new_treasury.key();
    emit!(TreasuryUpdated { old_treasury, new_treasury: config.treasury });
    Ok(())
}

#[derive(Accounts)]
pub struct SetAgentStatus<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

pub fn approve_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    // Aprovar também reativa um solver suspenso, desde que o stake esteja completo.
    require!(agent.status != AgentStatus::Active, SolversError::AgentNotPending);
    require!(agent.stake >= ctx.accounts.config.min_stake, SolversError::InsufficientStake);
    agent.status = AgentStatus::Active;
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

pub fn suspend_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    agent.status = AgentStatus::Suspended;
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

#[derive(Accounts)]
pub struct SlashStake<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin, has_one = treasury, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Box<Account<'info, Agent>>,
    #[account(mut, seeds = [STAKE_SEED, agent.key().as_ref()], bump)]
    pub stake_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn slash_stake(ctx: Context<SlashStake>, amount: u64) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    require!(amount > 0 && amount <= agent.stake, SolversError::InsufficientStake);
    let agent_id = agent.agent_id;
    let seeds: &[&[u8]] = &[AGENT_SEED, agent_id.as_ref(), &[agent.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: agent.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;
    agent.stake -= amount;
    agent.status = AgentStatus::Suspended;
    emit!(StakeSlashed { agent: agent.key(), amount });
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

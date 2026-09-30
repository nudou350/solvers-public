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

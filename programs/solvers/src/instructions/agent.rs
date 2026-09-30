use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use mpl_core::instructions::CreateCollectionV2CpiBuilder;
use mpl_core::types::{Creator, Plugin, PluginAuthorityPair, Royalties, RuleSet};

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterAgentArgs {
    pub agent_id: [u8; 16],
    pub name: String,
    pub metadata_uri: String,
    pub version: String,
    pub version_hash: [u8; 32],
    pub price: u64,
    pub price_per_use: u64,
    pub royalty_bps: u16,
}

#[derive(Accounts)]
#[instruction(args: RegisterAgentArgs)]
pub struct RegisterAgent<'info> {
    /// Paga o rent (a plataforma patrocina as taxas).
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Agent::INIT_SPACE,
        seeds = [AGENT_SEED, args.agent_id.as_ref()],
        bump
    )]
    pub agent: Box<Account<'info, Agent>>,
    /// Nova coleção Metaplex Core (keypair gerado pelo cliente).
    #[account(mut)]
    pub collection: Signer<'info>,
    /// CHECK: PDA do programa usada como update authority das coleções.
    #[account(seeds = [COLLECTION_AUTHORITY_SEED], bump)]
    pub collection_authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = creator)]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        seeds = [STAKE_SEED, agent.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = agent
    )]
    pub stake_vault: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: verificado pelo endereço.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn register_agent(ctx: Context<RegisterAgent>, args: RegisterAgentArgs) -> Result<()> {
    require!(args.metadata_uri.len() <= MAX_URI_LEN, SolversError::StringTooLong);
    require!(args.version.len() <= MAX_VERSION_LEN, SolversError::StringTooLong);
    require!(args.name.len() <= MAX_NAME_LEN, SolversError::StringTooLong);
    require!(args.royalty_bps <= MAX_BPS, SolversError::InvalidBps);
    let config = &ctx.accounts.config;
    require!(args.price >= config.min_price, SolversError::PriceTooLow);

    let min_stake = config.min_stake;
    if min_stake > 0 {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.creator_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            min_stake,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .update_authority(Some(&ctx.accounts.collection_authority.to_account_info()))
        .payer(&ctx.accounts.payer.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(format!("Solvers: {}", args.name))
        .uri(args.metadata_uri.clone())
        .plugins(vec![PluginAuthorityPair {
            plugin: Plugin::Royalties(Royalties {
                basis_points: args.royalty_bps,
                creators: vec![Creator { address: ctx.accounts.creator.key(), percentage: 100 }],
                rule_set: RuleSet::None,
            }),
            authority: None,
        }])
        .invoke()?;

    let agent = &mut ctx.accounts.agent;
    agent.agent_id = args.agent_id;
    agent.creator = ctx.accounts.creator.key();
    agent.collection = ctx.accounts.collection.key();
    agent.creator_usdc = ctx.accounts.creator_usdc.key();
    agent.metadata_uri = args.metadata_uri;
    agent.version = args.version;
    agent.version_hash = args.version_hash;
    agent.eval_score_bps = 0;
    agent.eval_hash = [0; 32];
    agent.price = args.price;
    agent.price_per_use = args.price_per_use;
    agent.royalty_bps = args.royalty_bps;
    agent.stake = min_stake;
    agent.status = AgentStatus::Pending;
    agent.total_sales = 0;
    agent.verified_uses = 0;
    agent.rating_sum = 0;
    agent.rating_count = 0;
    agent.disputes_lost = 0;
    agent.bump = ctx.bumps.agent;

    emit!(AgentRegistered { agent: agent.key(), agent_id: agent.agent_id, creator: agent.creator });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateVersion<'info> {
    pub creator: Signer<'info>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator @ SolversError::NotCreator)]
    pub agent: Account<'info, Agent>,
}

pub fn update_version(ctx: Context<UpdateVersion>, version: String, version_hash: [u8; 32]) -> Result<()> {
    require!(version.len() <= MAX_VERSION_LEN, SolversError::StringTooLong);
    let agent = &mut ctx.accounts.agent;
    agent.version = version.clone();
    agent.version_hash = version_hash;
    // A nota de desempenho vale só para a versão avaliada.
    agent.eval_score_bps = 0;
    agent.eval_hash = [0; 32];
    emit!(AgentVersionUpdated { agent: agent.key(), version, version_hash });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdatePricing<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator @ SolversError::NotCreator)]
    pub agent: Account<'info, Agent>,
}

pub fn update_pricing(ctx: Context<UpdatePricing>, price: u64, price_per_use: u64) -> Result<()> {
    require!(price >= ctx.accounts.config.min_price, SolversError::PriceTooLow);
    let agent = &mut ctx.accounts.agent;
    agent.price = price;
    agent.price_per_use = price_per_use;
    Ok(())
}

#[derive(Accounts)]
pub struct SetEval<'info> {
    pub verifier: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = verifier @ SolversError::NotVerifier)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

pub fn set_eval(ctx: Context<SetEval>, eval_score_bps: u16, eval_hash: [u8; 32]) -> Result<()> {
    require!(eval_score_bps <= MAX_BPS, SolversError::InvalidBps);
    let agent = &mut ctx.accounts.agent;
    agent.eval_score_bps = eval_score_bps;
    agent.eval_hash = eval_hash;
    emit!(EvalUpdated { agent: agent.key(), score_bps: eval_score_bps, eval_hash });
    Ok(())
}

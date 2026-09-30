use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use mpl_core::instructions::CreateV2CpiBuilder;
use mpl_core::types::{Attribute, Attributes, Plugin, PluginAuthorityPair};

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

/// Divide um pagamento entre plataforma (fee_bps) e criador.
#[allow(clippy::too_many_arguments)]
fn pay_split<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    mint: &Account<'info, Mint>,
    treasury: &Account<'info, TokenAccount>,
    creator_usdc: &Account<'info, TokenAccount>,
    amount: u64,
    fee_bps: u16,
) -> Result<()> {
    let (fee, rest) = fee_split(amount, fee_bps)?;
    for (to, value) in [(treasury, fee), (creator_usdc, rest)] {
        if value == 0 {
            continue;
        }
        token::transfer_checked(
            CpiContext::new(
                token_program.key(),
                TransferChecked {
                    from: from.to_account_info(),
                    mint: mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: authority.to_account_info(),
                },
            ),
            value,
            mint.decimals,
        )?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct PurchaseLicense<'info> {
    /// Fee payer da plataforma: paga taxa e rent da licença.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = collection,
        has_one = creator_usdc
    )]
    pub agent: Box<Account<'info, Agent>>,
    /// CHECK: coleção Metaplex Core do solver, validada via has_one.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: PDA do programa, update authority da coleção.
    #[account(seeds = [COLLECTION_AUTHORITY_SEED], bump)]
    pub collection_authority: UncheckedAccount<'info>,
    /// Novo asset de licença (keypair gerado pelo cliente).
    #[account(mut)]
    pub asset: Signer<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UserReputation::INIT_SPACE,
        seeds = [REP_SEED, buyer.key().as_ref()],
        bump
    )]
    pub reputation: Box<Account<'info, UserReputation>>,
    /// CHECK: verificado pelo endereço.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn purchase_license(ctx: Context<PurchaseLicense>) -> Result<()> {
    let agent = &ctx.accounts.agent;
    require!(agent.status == AgentStatus::Active, SolversError::AgentNotActive);
    let price = agent.price;

    pay_split(
        &ctx.accounts.token_program,
        &ctx.accounts.buyer_usdc,
        &ctx.accounts.buyer,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.treasury,
        &ctx.accounts.creator_usdc,
        price,
        ctx.accounts.config.fee_bps,
    )?;

    let agent_id_hex: String = agent.agent_id.iter().map(|b| format!("{b:02x}")).collect();
    let authority_bump = ctx.bumps.collection_authority;
    let signer_seeds: &[&[u8]] = &[COLLECTION_AUTHORITY_SEED, &[authority_bump]];
    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .authority(Some(&ctx.accounts.collection_authority.to_account_info()))
        .payer(&ctx.accounts.payer.to_account_info())
        .owner(Some(&ctx.accounts.buyer.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name("Licença Solvers".to_string())
        .uri(agent.metadata_uri.clone())
        .plugins(vec![PluginAuthorityPair {
            plugin: Plugin::Attributes(Attributes {
                attribute_list: vec![
                    Attribute { key: "agent_id".to_string(), value: agent_id_hex },
                    Attribute { key: "version".to_string(), value: agent.version.clone() },
                ],
            }),
            authority: None,
        }])
        .invoke_signed(&[signer_seeds])?;

    let rep = &mut ctx.accounts.reputation;
    if rep.wallet == Pubkey::default() {
        rep.wallet = ctx.accounts.buyer.key();
        rep.bump = ctx.bumps.reputation;
    }
    rep.purchases = rep.purchases.saturating_add(1);

    let agent = &mut ctx.accounts.agent;
    agent.total_sales = agent.total_sales.checked_add(1).ok_or(SolversError::MathOverflow)?;

    emit!(LicensePurchased {
        agent: agent.key(),
        buyer: ctx.accounts.buyer.key(),
        asset: ctx.accounts.asset.key(),
        price,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct BuyCredits<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator_usdc)]
    pub agent: Box<Account<'info, Agent>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Credits::INIT_SPACE,
        seeds = [CREDITS_SEED, agent.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub credits: Box<Account<'info, Credits>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UserReputation::INIT_SPACE,
        seeds = [REP_SEED, buyer.key().as_ref()],
        bump
    )]
    pub reputation: Box<Account<'info, UserReputation>>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn buy_credits(ctx: Context<BuyCredits>, amount: u32) -> Result<()> {
    let agent = &ctx.accounts.agent;
    require!(agent.status == AgentStatus::Active, SolversError::AgentNotActive);
    require!(agent.price_per_use > 0, SolversError::PayPerUseDisabled);
    require!(amount > 0, SolversError::InvalidAmount);
    let total = agent.price_per_use.checked_mul(amount as u64).ok_or(SolversError::MathOverflow)?;

    pay_split(
        &ctx.accounts.token_program,
        &ctx.accounts.buyer_usdc,
        &ctx.accounts.buyer,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.treasury,
        &ctx.accounts.creator_usdc,
        total,
        ctx.accounts.config.fee_bps,
    )?;

    let credits = &mut ctx.accounts.credits;
    if credits.owner == Pubkey::default() {
        credits.owner = ctx.accounts.buyer.key();
        credits.agent = agent.key();
        credits.bump = ctx.bumps.credits;
    }
    credits.remaining = credits.remaining.checked_add(amount).ok_or(SolversError::MathOverflow)?;
    credits.purchased = credits.purchased.checked_add(amount).ok_or(SolversError::MathOverflow)?;

    let rep = &mut ctx.accounts.reputation;
    if rep.wallet == Pubkey::default() {
        rep.wallet = ctx.accounts.buyer.key();
        rep.bump = ctx.bumps.reputation;
        // Primeira compra de créditos conta como compra na reputação.
        rep.purchases = rep.purchases.saturating_add(1);
    }

    emit!(CreditsBought { agent: agent.key(), buyer: ctx.accounts.buyer.key(), amount });
    Ok(())
}

#[derive(Accounts)]
pub struct ConsumeCredit<'info> {
    pub usage_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usage_authority @ SolversError::NotUsageAuthority)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        seeds = [CREDITS_SEED, agent.key().as_ref(), credits.owner.as_ref()],
        bump = credits.bump,
        has_one = agent
    )]
    pub credits: Account<'info, Credits>,
}

pub fn consume_credit(ctx: Context<ConsumeCredit>) -> Result<()> {
    let credits = &mut ctx.accounts.credits;
    require!(credits.remaining > 0, SolversError::NoCredits);
    credits.remaining -= 1;
    let agent = &mut ctx.accounts.agent;
    agent.verified_uses = agent.verified_uses.checked_add(1).ok_or(SolversError::MathOverflow)?;
    emit!(CreditConsumed { agent: agent.key(), owner: credits.owner, remaining: credits.remaining });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordUsageBatch<'info> {
    pub usage_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usage_authority @ SolversError::NotUsageAuthority)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

pub fn record_usage_batch(ctx: Context<RecordUsageBatch>, count: u64, merkle_root: [u8; 32]) -> Result<()> {
    require!(count > 0, SolversError::InvalidAmount);
    let agent = &mut ctx.accounts.agent;
    agent.verified_uses = agent.verified_uses.checked_add(count).ok_or(SolversError::MathOverflow)?;
    emit!(UsageRecorded { agent: agent.key(), count, merkle_root });
    Ok(())
}

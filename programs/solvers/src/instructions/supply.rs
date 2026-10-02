//! Teto de licenças por solver, imposto pelo próprio programa (`purchase_license` lê a conta; ver `enforce_supply_cap`).
//! O criador cria o teto uma vez e depois só o aumenta (quem comprou acreditando em "X de Y" não é diluído). Não há
//! instrução para remover a conta: ilimitado de novo é `raise_supply_cap(u32::MAX)`.

use anchor_lang::prelude::*;

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct CreateSupplyCap<'info> {
    /// Fee payer da plataforma: paga o rent da conta.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: Signer<'info>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator @ SolversError::NotCreator)]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = payer,
        space = 8 + SupplyCap::INIT_SPACE,
        seeds = [SUPPLY_CAP_SEED, agent.key().as_ref()],
        bump
    )]
    pub supply_cap: Account<'info, SupplyCap>,
    pub system_program: Program<'info, System>,
}

pub fn create_supply_cap(ctx: Context<CreateSupplyCap>, max: u32) -> Result<()> {
    let agent = &ctx.accounts.agent;
    // Não dá para criar um teto abaixo do que já foi vendido (nem zero): o teto conta licenças emitidas na vida do solver.
    require!(max >= 1 && u64::from(max) >= agent.total_sales, SolversError::SupplyCapTooLow);
    let cap = &mut ctx.accounts.supply_cap;
    cap.agent = agent.key();
    cap.max = max;
    cap.bump = ctx.bumps.supply_cap;
    emit!(SupplyCapSet { agent: agent.key(), max });
    Ok(())
}

#[derive(Accounts)]
pub struct RaiseSupplyCap<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = creator @ SolversError::NotCreator)]
    pub agent: Account<'info, Agent>,
    #[account(mut, seeds = [SUPPLY_CAP_SEED, agent.key().as_ref()], bump = supply_cap.bump, has_one = agent)]
    pub supply_cap: Account<'info, SupplyCap>,
}

pub fn raise_supply_cap(ctx: Context<RaiseSupplyCap>, max: u32) -> Result<()> {
    let cap = &mut ctx.accounts.supply_cap;
    require!(max > cap.max, SolversError::SupplyCapCannotDecrease);
    cap.max = max;
    emit!(SupplyCapSet { agent: ctx.accounts.agent.key(), max });
    Ok(())
}

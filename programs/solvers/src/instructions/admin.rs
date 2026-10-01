use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

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
    // Config v2 desde o nascimento (mainnet): sem guardian e sem pausa.
    config.layout_version = CONFIG_LAYOUT_VERSION;
    config.pause_flags = 0;
    config.guardian = Pubkey::default();
    config._reserved = [0; 64];
    Ok(())
}

/// Migra o Config v1 (187 bytes, devnet) para o v2. Só a upgrade authority assina (mesma regra de
/// `initialize_config`) e `config` é `UncheckedAccount`: `Account<Config>` falharia aqui, porque a
/// conta v1 é curta demais para o struct v2 (`AccountDidNotDeserialize`). Os bytes v1 não são
/// tocados; o resize acrescenta os campos novos zerados e só `layout_version` recebe valor.
/// Instrução de transição: depois que a devnet migrar, ela pode ser removida num upgrade.
#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// Paga o rent adicional (a plataforma patrocina as taxas).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Precisa ser a upgrade authority do programa.
    pub authority: Signer<'info>,
    /// CHECK: PDA do Config validada por seeds e dono; discriminador e tamanho v1 conferidos no handler.
    #[account(mut, seeds = [CONFIG_SEED], bump, owner = crate::ID)]
    pub config: UncheckedAccount<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ SolversError::NotAdmin)]
    pub program: Program<'info, crate::program::Solvers>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ SolversError::NotAdmin)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
    let config = ctx.accounts.config.to_account_info();
    // Só o tamanho v1 migra: outro tamanho (v2 inclusive) nunca é redimensionado.
    require!(config.data_len() == CONFIG_V1_LEN, SolversError::ConfigAlreadyMigrated);
    require!(
        config.try_borrow_data()?[..8] == *Config::DISCRIMINATOR,
        anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
    );

    let new_len = 8 + Config::INIT_SPACE;
    let missing = Rent::get()?.minimum_balance(new_len).saturating_sub(config.lamports());
    if missing > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: config.clone(),
                },
            ),
            missing,
        )?;
    }
    // `resize` estende com zeros (sol_memset em solana-account-info 3.1.1): flags 0, sem guardian, reservado zerado.
    config.resize(new_len)?;
    config.try_borrow_mut_data()?[CONFIG_V1_LEN] = CONFIG_LAYOUT_VERSION;
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

/// Pausa de emergência. O admin define qualquer combinação de bits válidos (liga e desliga); o guardian
/// só acrescenta bits (nunca remove). Saídas do comprador e instruções de admin nunca pausam.
#[derive(Accounts)]
pub struct SetPause<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn set_pause(ctx: Context<SetPause>, flags: u8) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let config = &mut ctx.accounts.config;
    let is_admin = signer == config.admin;
    let is_guardian = !is_admin && config.guardian != Pubkey::default() && signer == config.guardian;
    require!(is_admin || is_guardian, SolversError::NotPauseAuthority);
    require!(flags & !PAUSE_MASK == 0, SolversError::InvalidPauseFlags);
    // O guardian só acrescenta bits: o valor novo precisa conter todos os bits já ligados.
    require!(!is_guardian || flags & config.pause_flags == config.pause_flags, SolversError::GuardianCannotUnpause);
    let old_flags = config.pause_flags;
    config.pause_flags = flags;
    emit!(PauseChanged { by: signer, old_flags, new_flags: flags });
    Ok(())
}

/// Define o guardian da pausa; `Pubkey::default()` remove o guardian.
#[derive(Accounts)]
pub struct SetGuardian<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolversError::NotAdmin)]
    pub config: Account<'info, Config>,
}

pub fn set_guardian(ctx: Context<SetGuardian>, new_guardian: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_guardian = config.guardian;
    config.guardian = new_guardian;
    emit!(GuardianChanged { admin: ctx.accounts.admin.key(), old_guardian, new_guardian });
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
    // Aprovar também reativa um solver suspenso, desde que o stake esteja completo. Quem pediu
    // saída de stake (`Retired`) só volta por `cancel_stake_exit` (que o deixa `Suspended`).
    require!(agent.status != AgentStatus::Retired, SolversError::AgentRetired);
    require!(agent.status != AgentStatus::Active, SolversError::AgentNotPending);
    require!(agent.stake >= ctx.accounts.config.min_stake, SolversError::InsufficientStake);
    agent.status = AgentStatus::Active;
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

pub fn suspend_agent(ctx: Context<SetAgentStatus>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    // `Retired` já não vende e tem a saída em andamento: suspender não pode tirá-lo da saída.
    require!(agent.status != AgentStatus::Retired, SolversError::AgentRetired);
    agent.status = AgentStatus::Suspended;
    emit!(AgentStatusChanged { agent: agent.key(), status: agent.status as u8 });
    Ok(())
}

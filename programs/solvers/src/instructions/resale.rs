//! Revenda de licenças sem custódia. O vendedor mantém a licença (e o acesso) até a venda: ao anunciar ele
//! aprova a PDA `market_authority` como `TransferDelegate` do asset e a plataforma abre um `Listing`
//! (PDA `[listing, asset]`, um por asset, taxa e royalty congelados). `buy_listing` transfere o asset com essa
//! PDA e paga royalty, taxa e vendedor numa só transação; `cancel_listing` desfaz o anúncio.
//!
//! Comportamento do mpl-core em que isto se apoia (provado nos testes `core_*`): depois de qualquer
//! transferência o plugin continua no asset mas a authority volta a `Owner`, então a PDA nunca transfere duas
//! vezes e um anúncio velho (dono mudou, delegate revogado) não pode ser executado.
//!
//! Pausa: `list_license` e `buy_listing` respeitam `PAUSE_ENTRIES`; `cancel_listing` nunca pausa. Nenhuma
//! instrução toca `UserReputation` nem `Agent.total_sales` (revenda não é venda do criador) e nenhuma usa
//! `init_if_needed`: o `Listing` nasce com `init` e é sempre fechado (`close = rent_payer`).
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use mpl_core::instructions::{
    AddPluginV1CpiBuilder, ApprovePluginAuthorityV1CpiBuilder, RevokePluginAuthorityV1CpiBuilder,
    TransferV1CpiBuilder,
};
use mpl_core::types::{Plugin, PluginAuthority, PluginType, TransferDelegate};

use crate::errors::SolversError;
use crate::events::*;
use crate::license::read_license;
use crate::state::*;

/// Uma transferência de USDC do comprador (valor 0 é pulado, como em `pay_split`).
fn pay<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
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
        amount,
        mint.decimals,
    )
}

// ------------------------------------------------------------------------------------ anunciar ----

/// O vendedor anuncia a licença. A plataforma paga o rent do `Listing` e do plugin (e o recebe de volta).
#[derive(Accounts)]
pub struct ListLicense<'info> {
    /// Fee payer da plataforma: paga o rent do `Listing` e do plugin; nunca autoriza.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Dono da licença; assina o `AddPlugin`/`Approve` do mpl-core.
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = collection)]
    pub agent: Box<Account<'info, Agent>>,
    /// CHECK: coleção Metaplex Core do solver, validada via has_one. `mut` porque o mpl-core a recebe como
    /// gravável no AddPlugin/Approve.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: asset de licença (dono da conta = mpl-core); dono, coleção e plugin são lidos em `read_license`.
    #[account(mut, owner = mpl_core::ID @ SolversError::InvalidLicenseAccount)]
    pub asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump
    )]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: PDA do programa que vira `TransferDelegate` do asset; nunca guarda dados.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    /// CHECK: verificado pelo endereço.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn list_license(ctx: Context<ListLicense>, price: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    config.require_not_paused(PAUSE_ENTRIES)?;
    // Mesmo piso das compras (cobre o rent que a plataforma paga); 0 nunca é preço.
    require!(price >= config.min_price, SolversError::PriceTooLow);
    require!(price > 0, SolversError::InvalidAmount);
    let agent = &ctx.accounts.agent;
    let seller = ctx.accounts.seller.key();
    // MVP: o criador não revende (o royalty seria dele para ele mesmo e o split quebraria nas contas duplicadas).
    require_keys_neq!(seller, agent.creator, SolversError::CreatorCannotResell);
    let fee_bps = config.fee_bps;
    let royalty_bps = agent.royalty_bps;
    // Falha cedo (e com erro próprio) em vez de congelar um anúncio que nunca poderia ser comprado.
    resale_split(price, royalty_bps, fee_bps)?;

    let license = read_license(&ctx.accounts.asset.to_account_info())?
        .ok_or_else(|| error!(SolversError::InvalidLicenseAccount))?;
    require_keys_eq!(license.owner, seller, SolversError::NotAssetOwner);
    require!(
        license.in_collection(&agent.collection),
        SolversError::AssetNotInCollection
    );

    let market = ctx.accounts.market_authority.key();
    let mpl_core = ctx.accounts.mpl_core_program.to_account_info();
    let asset = ctx.accounts.asset.to_account_info();
    let collection = ctx.accounts.collection.to_account_info();
    let payer = ctx.accounts.payer.to_account_info();
    let seller_info = ctx.accounts.seller.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    let new_authority = PluginAuthority::Address { address: market };
    match &license.transfer_delegate {
        // Já aponta para a PDA (anúncio velho fechado sem revogar): nada a fazer.
        Some(PluginAuthority::Address { address }) if *address == market => {}
        // O plugin existe (licença já anunciada antes, ou comprada numa revenda): troca a authority.
        Some(current) => {
            // Delegate de OUTRA chave (o dono o aprovou por fora): o Approve não substitui uma authority
            // `Address`, então o dono a revoga antes (volta a `Owner`) e depois aprova a PDA.
            if matches!(current, PluginAuthority::Address { .. }) {
                RevokePluginAuthorityV1CpiBuilder::new(&mpl_core)
                    .asset(&asset)
                    .collection(Some(&collection))
                    .payer(&payer)
                    .authority(Some(&seller_info))
                    .system_program(&system)
                    .plugin_type(PluginType::TransferDelegate)
                    .invoke()?;
            }
            ApprovePluginAuthorityV1CpiBuilder::new(&mpl_core)
                .asset(&asset)
                .collection(Some(&collection))
                .payer(&payer)
                .authority(Some(&seller_info))
                .system_program(&system)
                .plugin_type(PluginType::TransferDelegate)
                .new_authority(new_authority)
                .invoke()?;
        }
        None => {
            AddPluginV1CpiBuilder::new(&mpl_core)
                .asset(&asset)
                .collection(Some(&collection))
                .payer(&payer)
                .authority(Some(&seller_info))
                .system_program(&system)
                .plugin(Plugin::TransferDelegate(TransferDelegate {}))
                .init_authority(new_authority)
                .invoke()?;
        }
    }

    let listing = &mut ctx.accounts.listing;
    listing.seller = seller;
    listing.asset = ctx.accounts.asset.key();
    listing.agent = agent.key();
    listing.price = price;
    listing.fee_bps = fee_bps;
    listing.royalty_bps = royalty_bps;
    listing.listed_at = Clock::get()?.unix_timestamp;
    listing.rent_payer = ctx.accounts.payer.key();
    listing.bump = ctx.bumps.listing;

    emit!(LicenseListed {
        agent: agent.key(),
        seller,
        asset: listing.asset,
        price,
        fee_bps,
        royalty_bps
    });
    Ok(())
}

// -------------------------------------------------------------------------------------- comprar ----

#[derive(Accounts)]
pub struct BuyListing<'info> {
    /// Fee payer da plataforma: paga a taxa da transação; nunca autoriza.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [AGENT_SEED, agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = collection,
        has_one = creator_usdc
    )]
    pub agent: Box<Account<'info, Agent>>,
    /// CHECK: coleção Metaplex Core do solver, validada via has_one. `mut` porque o mpl-core a recebe como
    /// gravável no TransferV1.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: asset de licença (dono da conta = mpl-core); o conteúdo é lido em `read_license`.
    #[account(mut, owner = mpl_core::ID @ SolversError::InvalidLicenseAccount)]
    pub asset: UncheckedAccount<'info>,
    // `SelfPurchase` é uma constraint (roda junto das demais, depois da checagem de contas mutáveis duplicadas):
    // por isso `seller_usdc` leva `dup`; senão comprar o próprio anúncio (`buyer_usdc` == `seller_usdc`) falharia
    // com `ConstraintDuplicateMutableAccount` em vez do erro claro.
    /// Anúncio (PDA `[listing, asset]`); fecha para o `rent_payer` gravado.
    #[account(
        mut,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump = listing.bump,
        has_one = asset @ SolversError::ListingMismatch,
        has_one = agent @ SolversError::ListingMismatch,
        has_one = rent_payer,
        constraint = listing.seller != buyer.key() @ SolversError::SelfPurchase,
        close = rent_payer
    )]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: PDA do programa que é o `TransferDelegate` do asset; assina o TransferV1.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    // Pago pelo ENDEREÇO derivado do vendedor + mint, não pelo dono atual da conta: quem troca o dono da
    // própria ATA não trava a venda (como nos reembolsos do escrow). `dup` (ver `listing`) é seguro: conta de
    // token não é regravada na saída do handler, então repetir o endereço em outra conta mutável não perde
    // escrita. Os únicos casos em que ela repete outra conta de USDC são o próprio vendedor comprando
    // (`SelfPurchase`) e uma ATA do vendedor com dono trocado ou apontada como tesouraria; nenhum tira dinheiro
    // do criador nem da plataforma (royalty e taxa saem do comprador e chegam inteiros).
    /// ATA de USDC do vendedor (pelo endereço derivado + mint).
    #[account(mut, dup, token::mint = usdc_mint, address = get_associated_token_address(&listing.seller, &usdc_mint.key()))]
    pub seller_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: destino fixo do rent do `Listing`, gravado no anúncio (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    /// CHECK: verificado pelo endereço.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// `expected_price` é o preço mostrado ao comprador: o anúncio não tem `update`, então só um anúncio novo no
/// mesmo asset (cancelar e anunciar de novo) pode mudá-lo, e a compra então falha em vez de cobrar outro valor.
pub fn buy_listing(ctx: Context<BuyListing>, expected_price: u64) -> Result<()> {
    ctx.accounts.config.require_not_paused(PAUSE_ENTRIES)?;
    let agent = &ctx.accounts.agent;
    require!(
        agent.status == AgentStatus::Active,
        SolversError::AgentNotActive
    );
    require!(
        agent.stake >= ctx.accounts.config.min_stake,
        SolversError::InsufficientStake
    );
    let listing = &ctx.accounts.listing;
    require!(listing.price == expected_price, SolversError::PriceChanged);

    // O anúncio só vale enquanto o asset segue com o vendedor, na coleção e delegado à PDA.
    let market = ctx.accounts.market_authority.key();
    let license = read_license(&ctx.accounts.asset.to_account_info())?
        .ok_or_else(|| error!(SolversError::InvalidLicenseAccount))?;
    require_keys_eq!(license.owner, listing.seller, SolversError::NotAssetOwner);
    require!(
        license.in_collection(&agent.collection),
        SolversError::AssetNotInCollection
    );
    require!(
        license.delegated_to(&market),
        SolversError::ListingNotAuthorized
    );

    let (royalty, fee, seller_amount) =
        resale_split(listing.price, listing.royalty_bps, listing.fee_bps)?;

    // Primeiro a licença (se o mpl-core recusar, ex.: asset congelado, nada foi pago e a transação inteira volta).
    let signer_seeds: &[&[u8]] = &[MARKET_AUTHORITY_SEED, &[ctx.bumps.market_authority]];
    TransferV1CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .payer(&ctx.accounts.payer.to_account_info())
        .authority(Some(&ctx.accounts.market_authority.to_account_info()))
        .new_owner(&ctx.accounts.buyer.to_account_info())
        .invoke_signed(&[signer_seeds])?;

    let (token_program, from, buyer, mint) = (
        &ctx.accounts.token_program,
        &ctx.accounts.buyer_usdc,
        &ctx.accounts.buyer,
        &ctx.accounts.usdc_mint,
    );
    pay(
        token_program,
        from,
        buyer,
        mint,
        &ctx.accounts.creator_usdc,
        royalty,
    )?;
    pay(
        token_program,
        from,
        buyer,
        mint,
        &ctx.accounts.treasury,
        fee,
    )?;
    pay(
        token_program,
        from,
        buyer,
        mint,
        &ctx.accounts.seller_usdc,
        seller_amount,
    )?;

    emit!(LicenseResold {
        agent: agent.key(),
        asset: listing.asset,
        seller: listing.seller,
        buyer: buyer.key(),
        price: listing.price,
        royalty,
        fee,
        seller_amount,
    });
    // O `Listing` fecha ao sair do handler (`close = rent_payer`).
    Ok(())
}

// ------------------------------------------------------------------------------------- cancelar ----

/// O vendedor cancela quando quiser. Qualquer um pode fechar um anúncio VELHO (o asset mudou de dono, o
/// delegate foi revogado/resetado ou o asset foi queimado), para o endereço do `Listing` não ficar preso
/// e o novo dono poder anunciar. Nunca pausa. O rent volta sempre ao `rent_payer` gravado.
#[derive(Accounts)]
pub struct CancelListing<'info> {
    /// Fee payer da plataforma; recebe de volta o rent do plugin quando o vendedor revoga o delegate.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Vendedor (cancela sempre) ou qualquer carteira (só anúncio velho).
    pub canceller: Signer<'info>,
    #[account(seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump, has_one = collection)]
    pub agent: Box<Account<'info, Agent>>,
    /// CHECK: coleção Metaplex Core do solver, validada via has_one. `mut` porque o mpl-core a recebe como
    /// gravável no RevokePluginAuthority.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: asset do anúncio (`has_one = asset`). Pode estar queimado ou fora do mpl-core: o estado é lido
    /// em `read_license` e qualquer coisa que não seja um asset vivo conta como anúncio velho.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump = listing.bump,
        has_one = asset @ SolversError::ListingMismatch,
        has_one = agent @ SolversError::ListingMismatch,
        has_one = rent_payer,
        close = rent_payer
    )]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: PDA do programa; só serve para reconhecer o delegate do anúncio.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    /// CHECK: destino fixo do rent do `Listing`, gravado no anúncio (`has_one = rent_payer`).
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    /// CHECK: verificado pelo endereço.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    let listing = &ctx.accounts.listing;
    let canceller = ctx.accounts.canceller.key();
    let market = ctx.accounts.market_authority.key();
    let asset_info = ctx.accounts.asset.to_account_info();

    // Conta de outro dono (queimada e fechada, qualquer coisa) ou ilegível = nada vivo para vender.
    let license = if *asset_info.owner == mpl_core::ID {
        read_license(&asset_info).ok().flatten()
    } else {
        None
    };
    // O anúncio ainda pode ser executado por `buy_listing`: asset vivo, do vendedor, na coleção e delegado à PDA.
    let live = license.as_ref().is_some_and(|l| {
        l.owner == listing.seller
            && l.in_collection(&ctx.accounts.agent.collection)
            && l.delegated_to(&market)
    });

    if canceller == listing.seller {
        // Quem revoga é o DONO (o vendedor): o aluguel do plugin volta ao `payer`. Se a PDA revogasse a si mesma,
        // o aluguel ficaria parado no asset. Anúncio velho: não há o que revogar (e o vendedor nem é mais o dono).
        if live {
            // O reembolso do Revoke vai para o `payer` da transação: sem esta checagem o vendedor, ao pagar a
            // própria transação, levaria o aluguel do plugin que a plataforma financiou. Ele não perde a saída:
            // revogando o delegate direto no mpl-core o anúncio cai no ramo sem CPI (que não usa o `payer`).
            require_keys_eq!(
                ctx.accounts.payer.key(),
                listing.rent_payer,
                SolversError::CancelPayerMismatch
            );
            RevokePluginAuthorityV1CpiBuilder::new(
                &ctx.accounts.mpl_core_program.to_account_info(),
            )
            .asset(&asset_info)
            .collection(Some(&ctx.accounts.collection.to_account_info()))
            .payer(&ctx.accounts.payer.to_account_info())
            .authority(Some(&ctx.accounts.canceller.to_account_info()))
            .system_program(&ctx.accounts.system_program.to_account_info())
            .plugin_type(PluginType::TransferDelegate)
            .invoke()?;
        }
    } else {
        // Terceiros só fecham o que não pode mais ser executado. Sem CPI: nenhum caso velho deixa um delegate
        // para a PDA em asset do vendedor (a transferência o reseta), e revogar em asset de outro dono seria
        // mexer no que não é do anúncio.
        require!(!live, SolversError::ListingStillValid);
    }

    emit!(ListingCancelled {
        agent: listing.agent,
        asset: listing.asset,
        seller: listing.seller,
        canceller
    });
    Ok(())
}

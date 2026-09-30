use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;
use mpl_core::types::{Key as CoreKey, UpdateAuthority};

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

/// Avaliação provada por uma licença (asset Metaplex Core da coleção do solver).
#[derive(Accounts)]
pub struct SubmitReview<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub author: Signer<'info>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Review::INIT_SPACE,
        seeds = [REVIEW_SEED, agent.key().as_ref(), author.key().as_ref()],
        bump
    )]
    pub review: Account<'info, Review>,
    /// CHECK: asset Metaplex Core da licença; validado em `holds_license`.
    #[account(owner = mpl_core::ID @ SolversError::NoLicense)]
    pub license_asset: UncheckedAccount<'info>,
    /// Liga o asset à primeira avaliação feita com ele.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + LicenseReview::INIT_SPACE,
        seeds = [LICENSE_REVIEW_SEED, license_asset.key().as_ref()],
        bump
    )]
    pub license_review: Account<'info, LicenseReview>,
    pub system_program: Program<'info, System>,
}

/// Avaliação provada por créditos comprados (pagamento por uso).
#[derive(Accounts)]
pub struct SubmitReviewWithCredits<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub author: Signer<'info>,
    #[account(mut, seeds = [AGENT_SEED, agent.agent_id.as_ref()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Review::INIT_SPACE,
        seeds = [REVIEW_SEED, agent.key().as_ref(), author.key().as_ref()],
        bump
    )]
    pub review: Account<'info, Review>,
    #[account(
        seeds = [CREDITS_SEED, agent.key().as_ref(), author.key().as_ref()],
        bump = credits.bump,
        constraint = credits.purchased > 0 @ SolversError::NoLicense
    )]
    pub credits: Account<'info, Credits>,
    pub system_program: Program<'info, System>,
}

fn holds_license(asset: &AccountInfo, author: &Pubkey, collection: &Pubkey) -> Result<bool> {
    let data = asset.try_borrow_data()?;
    if data.first() != Some(&(CoreKey::AssetV1 as u8)) {
        return Ok(false);
    }
    let base = BaseAssetV1::from_bytes(&data).map_err(|_| error!(SolversError::InvalidLicenseAccount))?;
    Ok(base.owner == *author && base.update_authority == UpdateAuthority::Collection(*collection))
}

fn apply_review(
    agent: &mut Account<Agent>,
    review: &mut Account<Review>,
    review_bump: u8,
    author: Pubkey,
    rating: u8,
    content_hash: [u8; 32],
) -> Result<()> {
    require!((1..=5).contains(&rating), SolversError::InvalidRating);
    // Uma avaliação por carteira por solver; enviar de novo edita a nota.
    if review.author == Pubkey::default() {
        review.agent = agent.key();
        review.author = author;
        review.bump = review_bump;
        review.created_at = Clock::get()?.unix_timestamp;
        agent.rating_count = agent.rating_count.checked_add(1).ok_or(SolversError::MathOverflow)?;
    } else {
        agent.rating_sum = agent.rating_sum.saturating_sub(review.rating as u64);
    }
    agent.rating_sum = agent.rating_sum.checked_add(rating as u64).ok_or(SolversError::MathOverflow)?;
    review.rating = rating;
    review.content_hash = content_hash;
    emit!(ReviewSubmitted { agent: agent.key(), author, rating, content_hash });
    Ok(())
}

pub fn submit_review(ctx: Context<SubmitReview>, rating: u8, content_hash: [u8; 32]) -> Result<()> {
    let author = ctx.accounts.author.key();
    let agent_collection = ctx.accounts.agent.collection;
    require!(
        holds_license(&ctx.accounts.license_asset.to_account_info(), &author, &agent_collection)?,
        SolversError::NoLicense
    );

    // A mesma licença, se transferida, não pode gerar outra avaliação.
    let review_key = ctx.accounts.review.key();
    let lr = &mut ctx.accounts.license_review;
    if lr.review == Pubkey::default() {
        lr.asset = ctx.accounts.license_asset.key();
        lr.review = review_key;
        lr.bump = ctx.bumps.license_review;
    } else {
        require_keys_eq!(lr.review, review_key, SolversError::LicenseAlreadyReviewed);
    }

    let bump = ctx.bumps.review;
    apply_review(&mut ctx.accounts.agent, &mut ctx.accounts.review, bump, author, rating, content_hash)
}

pub fn submit_review_with_credits(
    ctx: Context<SubmitReviewWithCredits>,
    rating: u8,
    content_hash: [u8; 32],
) -> Result<()> {
    let author = ctx.accounts.author.key();
    let bump = ctx.bumps.review;
    apply_review(&mut ctx.accounts.agent, &mut ctx.accounts.review, bump, author, rating, content_hash)
}

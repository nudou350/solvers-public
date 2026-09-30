use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;
use mpl_core::types::UpdateAuthority;

use crate::errors::SolversError;
use crate::events::*;
use crate::state::*;

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
    /// CHECK: asset Metaplex Core da licença; validado manualmente abaixo.
    pub license_asset: Option<UncheckedAccount<'info>>,
    #[account(seeds = [CREDITS_SEED, agent.key().as_ref(), author.key().as_ref()], bump = credits.bump)]
    pub credits: Option<Account<'info, Credits>>,
    pub system_program: Program<'info, System>,
}

fn holds_license(asset: &AccountInfo, author: &Pubkey, collection: &Pubkey) -> Result<bool> {
    if *asset.owner != mpl_core::ID {
        return Ok(false);
    }
    let data = asset.try_borrow_data()?;
    let base = BaseAssetV1::from_bytes(&data).map_err(|_| error!(SolversError::InvalidLicenseAccount))?;
    Ok(base.owner == *author && base.update_authority == UpdateAuthority::Collection(*collection))
}

pub fn submit_review(ctx: Context<SubmitReview>, rating: u8, content_hash: [u8; 32]) -> Result<()> {
    require!((1..=5).contains(&rating), SolversError::InvalidRating);
    let author = ctx.accounts.author.key();
    let agent = &mut ctx.accounts.agent;

    let by_license = match &ctx.accounts.license_asset {
        Some(asset) => holds_license(&asset.to_account_info(), &author, &agent.collection)?,
        None => false,
    };
    let by_credits = ctx.accounts.credits.as_ref().is_some_and(|c| c.purchased > 0);
    require!(by_license || by_credits, SolversError::NoLicense);

    let review = &mut ctx.accounts.review;
    let is_new = review.author == Pubkey::default();
    if is_new {
        review.agent = agent.key();
        review.author = author;
        review.bump = ctx.bumps.review;
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

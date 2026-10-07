---
title: Consistent price, free trial and storefront
source: Solver package specification v1 (PACKAGE_SPEC), sections 4.1, 14.5 and 20, and the validator rules
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [price, free-trial, storefront, searchPhrases, beforeAfter]
---

# Consistent price, free trial and storefront

This knowledge file helps decide the license price, the free trial and the storefront texts (tagline, description, search phrases and before-and-after comparisons), and lists what the reviewer checks to see whether everything is consistent.

## Price

- `pricing.priceUsdc`: the license price, in dollars. The platform minimum today is **5** (`MANIFEST_PRICE_BELOW_MIN` below that). The minimum exists because the purchase must cover registration costs.
- It is a lifetime license to the Solver: the buyer uses it whenever they want. There is no per-use charge.
- `royaltyBps`: 0 to 1,000 (300 = 3%): the creator's share when the buyer resells the license in the Solver's market. A high value makes resale less attractive for whoever buys second-hand.
- How to set the price: how much time or money does the method save? Compare with the alternative (an hour of consulting, a ready-made template). Maintenance-heavy content (rules that change) justifies a higher price, because you have to keep it updated.
- The creator must not promise the Solver's future value or returns.

## Free trial (`trial`)

The trial exists to show value **without giving everything away**. If omitted, there is no trial. Fields:

- `uses`: how many trial uses per person (1 to 10; the platform default is usually 3).
- `steps`: how many initial steps are unlocked. It cannot exceed the total (`TRIAL_STEPS_EXCEED`).
- `searches`: how many knowledge queries across the whole trial.
- `tools`: use `{}` (new creators have no tools).
- `templates`: names of the templates unlocked in the trial (default: none).
- `summary` and `lockedSummary`: what the trial gives and what is left to the full version (3 to 400 and 3 to 300 characters).

Golden rule: unlock the **steps that show the reasoning** (profile, diagnosis) and leave the **final deliverable** (the finished report, the plan, the template) to the license. A trial that delivers everything does not sell; a trial that delivers nothing does not convince.

## License cap (`supply`)

`supply.maxLicenses` sets a cap on licenses sold (1 to 1,000,000). The correct promise to the buyer is "the cap today is N and it can only go up", never "only N will exist". With the free trial on, the validator warns (`SUPPLY_WITH_TRIAL`): the trial does not consume a slot.

## Storefront texts

- `tagline`: a one-sentence statement of value (result + audience). "Close the month for your Brazilian MEI without mistakes: limit, DAS and report".
- `description`: what it delivers, for whom and what it does **not** do. No promise of results.
- `packageContents`: 3 to 8 items, only what exists (checked by the validator).
- `searchPhrases`: the phrases the buyer would type ("I'm close to the MEI limit"), all tied to the real content. Up to 20.
- `beforeAfter`: up to 5 real comparisons: the request, an AI's answer without the Solver and with the Solver. Show the concrete gain (a deadline remembered, a correct calculation, a source cited). Do not make up numbers the base does not support.

## Consistency (what the reviewer checks)

- The price fits what the deliverable is worth and the trial (a strong trial justifies a higher price).
- The trial shows value without giving everything away.
- The storefront only promises what the steps deliver.
- No text promises a tool, automatic verification, a guarantee, a rating or approval.
- If there is tax or regulatory content, the disclaimer appears in the description and in the final step.

## What the storefront shows the buyer

The proven differentiators, the sources and the date the base was updated, the templates and the calibration. Performance only appears after the platform measures it; until then the Solver shows "no reviews yet", and the usage rating comes from buyers' reviews.

## Money and responsibility

Buying the license pays the creator immediately. That is why, in this phase, the platform only accepts invited creators and reviews 100% of versions. Each update to the Solver must be reviewed again, with a version higher than the published one.

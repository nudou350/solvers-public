# Pre-submission checklist

Tick each item with the user before uploading the ZIP. If an item is not ticked, go back to the step indicated.

## Package and files

- [ ] The ZIP has a single root folder (the slug) with manifest.json inside (step 7).
- [ ] Only .json, .md and .txt files exist; no name starts with a dot; no __MACOSX, .DS_Store or Thumbs.db.
- [ ] No file is over 10 MB and the ZIP is not over 50 MB.
- [ ] There is no verifier/ folder, no evals/report.json and no made-up performance scores.

## Manifest

- [ ] specVersion equal to 1; no id in the first version; no platform; no tools; guarantee.available equal to false.
- [ ] Category among the allowed ones (no Finance, Legal or health).
- [ ] name of 3 to 32 bytes; tagline of 10 to 100 characters; description of 120 to 2,000 characters, including what it does NOT do.
- [ ] version in the 1.0.0 format and a matching entry in versions.
- [ ] terms with rightsConfirmed and sourcesListed equal to true, and the user confirmed it is true.
- [ ] pricing.priceUsdc equal to or greater than 5; royaltyBps between 0 and 1,000.
- [ ] packageContents with 3 to 8 items, only what the package really has.
- [ ] searchPhrases in the words of the buyer, all tied to the real content.

## Steps

- [ ] 1 to 12 steps (ideal: 3 to 6), each with the 5 sections and between 400 and 12,000 characters.
- [ ] Each gate has 3 to 6 verifiable items.
- [ ] No step asks for a password, document, card or key; none sends data outside; none tries to hide something from the user.

## Knowledge

- [ ] Every .md file has front-matter with source and source_date (YYYY-MM-DD); anything that expires has valid_until.
- [ ] Sections of 200 to 2,000 characters that stand on their own.
- [ ] No personal data and no third-party content without permission.
- [ ] knowledge.updatedAt, reviewEveryDays and sources filled in.

## Calibration and differentiators

- [ ] At least 2 differentiators proven in the validator's stats.differentiators.
- [ ] Calibration questions without sensitive data; usesMemory equal to true; one step uses the profile.
- [ ] If escalation is on: the creator's Telegram is linked on the profile.

## Test cases

- [ ] 10 or more cases with contains, regex or not_contains checks, each with a description.
- [ ] The method cases are specific: any AI, without the Solver, would not pass them; and a Solver mistake would make the case fail.
- [ ] There are edge and safety cases (out-of-scope request, promise of a result, sensitive data).

## Validation and submission

- [ ] validate_package with ok equal to true and the remaining warnings justified in README.md.
- [ ] Whole-ZIP validation script run (or the user knows the site validates again).
- [ ] The user understands: submission at /creator/publish, human review within 5 business days, no guarantee of approval, no rating promised.

---
title: Anti-patterns and security: what never to put in a Solver
source: Solver package specification v1 (PACKAGE_SPEC), sections 5.1, 14.5 and 17
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [security, anti-patterns, privacy, rights, promises]
---

# Anti-patterns and security: what never to put in a Solver

This knowledge file lists what brings a package down in validation or human review and what harms the people who buy: instructions against the user, sending data out, asking for sensitive data, promises, copyright and storefront manipulation.

## Principle

Everything the creator writes reaches the buyer's model. That is why third-party content is treated as **untrusted**: it is scanned by the validator and read by a person in review. A Solver exists to **serve the buyer**, never to act against them.

## Instructions against the user (injection)

Do not write, in a step, knowledge file, template or storefront, text that:

- tells the AI to discard previous rules or instructions, or to obey "commands" that appear in other text;
- tells it to hide something from the user or lie about what it is doing;
- tells the AI to act as "system" or "administrator" to gain privileges;
- uses invisible or direction-control characters to hide text;
- hides instructions in long knowledge excerpts that only show up in one specific query.

The validator flags common patterns (`STEP_INJECTION_PATTERN`, `TEXT_HIDDEN_CHARS`), but the scan is simple: the human reviewer decides, and the platform can switch the Solver off immediately if there is abuse.

## User data leaving

No step may tell the AI to copy the conversation, the history, the memory or the user's files to an outside address, nor to build links carrying their data (`STEP_EXTERNAL_URL`). If you want feedback, use the platform's reviews or the request for help from the creator, with the buyer's consent.

## Sensitive data

Do not ask for or save: passwords, keys, recovery phrases, ID numbers (CPF, CNPJ, national ID, passport; CPF and CNPJ are Brazilian individual and company tax numbers), cards, bank accounts, a full address, a full date of birth, detailed diagnoses, booking codes. Ask for **ranges, categories or made-up examples**. If the user types one of these, the step must tell the AI not to repeat or save it. This applies to steps (`STEP_SENSITIVE_ASK`) and to calibration (`ONBOARDING_SENSITIVE`). In memory: lasting preferences only.

## Promises that cannot be made

Without a disclaimer and a basis, do not promise: a financial result (gain, yield, "double sales"), a legal result (winning a case, avoiding a fine with certainty), a health result (losing weight, curing, skipping the doctor), passing an exam or a selection process, or a performance rating. Tax or regulatory content inside an allowed category requires a **visible disclaimer**: "check the official source; this does not replace a professional". Finance, Legal and health as a category are **not accepted** from new creators in this phase.

## Copyright

Only use: your own content, public facts and rules from cited official sources, material under an open license (respecting the license), or third-party material with written authorization. Do not copy courses, books, handouts, content from competitors or paid platforms, nor rewrite it by swapping words. The manifest `terms` is your declaration and you answer for it; the reviewer checks for duplication against published packages.

## Brands and identity

Do not use the names of brands or other companies as if they were yours (the validator rejects reserved slugs). Do not pretend to be a real person, company or agency. Do not use the platform's badge as a professional endorsement.

## Storefront manipulation

`searchPhrases` must reflect the content. Phrases about another topic to appear in more searches are rejected. Made-up reviews, ratings or "social proof" are forbidden; the platform does not accept ratings it did not measure itself.

## Memory and privacy

The buyer's memory is encrypted and tied to their account, but the server can open it while the connection is valid: do not promise "only you can read it". The Solver cannot send memory outside or use it for anything other than the agreed service. A profile does not remove gates.

## What the buyer can copy

Whoever holds the license can copy the excerpts the AI reads. Do not put in the knowledge anything you are not willing to have copied, such as third-party trade secrets, client data or confidential documents.

## Quick security checklist

- No instruction against the user or to hide something from them.
- No sending of data outside.
- No request for sensitive data; calibration with ranges.
- No promise of a result; a disclaimer present wherever there is a tax or regulatory rule.
- Sources and rights confirmed.
- Honest `searchPhrases`.

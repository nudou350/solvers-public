---
title: Manifest (manifest.json) field by field
source: Solver package specification v1 (PACKAGE_SPEC), section 4, and the platform validator schema
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [manifest, fields, schema]
---

# Manifest (manifest.json) field by field

The manifest is strict in `specVersion: 1`: **an unknown field is an error** (`MANIFEST_UNKNOWN_FIELD`). Only use the fields below. For a ready skeleton, use the `manifest-esqueleto` template.

## Identity

- `specVersion`: always `1` in a new creator's submission (`MANIFEST_SPEC_VERSION` if missing).
- `id`: **do not write it in the first version**; the server assigns it (32 lowercase letters and digits). In later versions it is required and must be yours (`MANIFEST_ID_OWNER`).
- `slug`: 3 to 40 characters, lowercase letters, digits and hyphens (`my-solver`). It cannot have the shape of a 32-character letter-and-digit `id` (`MANIFEST_SLUG_LOOKS_LIKE_ID`) nor be a reserved name (`MANIFEST_SLUG_RESERVED`, for example brand and platform names).
- `name`: 3 to 32 **bytes** (an accented letter counts as 2 bytes; `MANIFEST_NAME_TOO_LONG`).
- `version`: `1.0.0` (three numbers), up to 16 bytes, no suffix. The new version must be greater than the published one.
- `platform`: do not use. Platform packages only (`MANIFEST_PLATFORM_FORBIDDEN`).

## Storefront

- `tagline`: 10 to 100 characters. A one-sentence statement of value.
- `description`: 120 to 2,000 characters: what it delivers, for whom and what it does **not** do.
- `category`: one of `Desenvolvimento` (Development), `Design`, `Dia a dia` (Everyday), `Negócios` (Business), `Viagens` (Travel), `Conteúdo` (Content), `Escrita` (Writing), `Outros` (Other). These are fixed keys written in Portuguese; the site shows them translated. Finance, Legal and health are **not** accepted from new creators in this phase (`MANIFEST_CATEGORY_FORBIDDEN`).
- `creator`: `{ id, name, bio, avatarUrl? }`. The server replaces the `id` with your profile identifier; write any short text.
- `requirements[]`: what the buyer needs: `{ type, label, key?, optional?, howTo?, helpUrl? }`, with `type` equal to `client`, `connector` or `plan`. E.g.: `{ "type": "client", "label": "Claude or ChatGPT", "key": "any" }`.
- `packageContents[]`: 3 to 8 items of what the package delivers. The validator checks them against reality (`CONTENTS_MISMATCH`).
- `searchPhrases[]`: up to 20 phrases of 3 to 120 characters, in the words of the buyer. The reviewer checks them against the content.
- `beforeAfter[]`: up to 5 examples `{ prompt, withoutSolver, withSolver }`.
- `versions[]`: history `{ version, releasedAt, notes }`. There **must** be an entry for the current version (`MANIFEST_VERSIONS_MISSING`).
- `terms`: `{ "rightsConfirmed": true, "sourcesListed": true }`. Without it: `TERMS_MISSING`.

## Behavior

- `steps[]`: 1 to 12 items `{ file, title?, gate[] }`. `gate` has 0 to 6 text items. See the knowledge file on steps.
- `usesMemory`: `true` if the Solver uses memory. Required `true` when there is `onboarding`.
- `onboarding`: `{ questions: [ { id, ask, why, options? } ] }`, 1 to 5 questions. See the knowledge file on calibration.
- `escalation`: `{ enabled: boolean }`. The creator's contact comes from their profile.
- `differentiators[]`: a subset of `tool`, `verifier`, `liveData`, `memory`, `escalation`. Declare only what you will prove.
- `knowledge`: `{ updatedAt, reviewEveryDays, sources[] }`. `updatedAt` in YYYY-MM-DD, `reviewEveryDays` from 1 to 730, `sources` with at least 1 source as text.
- `templates[]`: `{ name, path, title, description }`. `name` in lowercase letters, digits, hyphen and underscore. The `path` starts with `templates/`. Only what is declared is delivered.
- `tools[]`: **empty** for a new creator in this phase (`TOOL_FORBIDDEN_RUNNER`).
- `guarantee`: `{ "available": false, "defaultCriteria": [] }`. Turning the guarantee on is an error for a new creator (`MANIFEST_GUARANTEE_FORBIDDEN`).

## Price, free trial and offer

- `pricing`: `{ priceUsdc, royaltyBps }`. `priceUsdc` in dollars, at least the platform's `min_price` (today 5; `MANIFEST_PRICE_BELOW_MIN`). `royaltyBps` from 0 to 1,000 (300 = 3%), the creator's share when licenses are resold.
- `trial`: free trial, optional: `{ available?, uses (1 to 10), steps (steps unlocked, at most the total), searches, tools, templates[], scope?, summary, lockedSummary }`. Without `trial`, there is no trial. For a new creator, `tools` stays `{}`.
- `supply`: `{ maxLicenses }`, a cap on licenses sold (1 to 1,000,000). Optional, it only goes up over time. Combining `supply` with a free trial raises the warning `SUPPLY_WITH_TRIAL`.
- `catalogOnly`: removed; raises a warning.

## Dependencies between fields

- `trial.steps` cannot exceed the number of steps (`TRIAL_STEPS_EXCEED`); `trial.tools` and `trial.templates` only mention names that exist (`TRIAL_TOOL_UNKNOWN`, `TRIAL_TEMPLATE_UNKNOWN`).
- `onboarding` requires `usesMemory: true` (`ONBOARDING_NEEDS_MEMORY`).
- `differentiators` with something the validator cannot prove raises a warning; so do fewer than 2 proven.
- Changing `tools`, `onboarding`, `requirements` or the structure of `steps` in an update requires bumping the MAJOR number (`DIFF_ENDPOINT_CHANGED_MINOR`).

## Texts the buyer's model reads

`tagline`, `description`, `howTo`, `packageContents`, `searchPhrases`, `beforeAfter`, `trial.summary`, `trial.lockedSummary` and the calibration questions go through the same scans as the steps (injection, sensitive data, invisible characters). Write in them only what you would say to a customer.

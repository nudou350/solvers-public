# Step 2: Differentiators and how to prove them

## Goal

Choose **at least 2 differentiators** that the Solver will really have and write down, for each one, **the proof** the reviewer will check. This is the "2 of 5" review criterion: a Solver that is just nicely written text (which the buyer could paste into a chat) is an ordinary skill and is not approved. What justifies the product is what only exists with the server: guided process, living and cited knowledge, adaptation to the user, and human support.

The 5 differentiators in the specification are `tool`, `verifier`, `liveData`, `memory` and `escalation`. Be honest with the user about what counts **in this phase (the Core phase)**: new creators **do not get `tool` or `verifier`** (an executable tool and automatic verification of the result), which only arrive in the Opening phase. So in practice the three real options are **living knowledge (`liveData`)**, **memory (`memory`)** and **creator support (`escalation`)**, and you must prove two of them. The storefront cannot promise tools or verification in these packages.

## What to ask the user

Reread the sheet from step 1 and the profile (`tipo_solver`, `nivel`). Ask in plain language:

1. **Does the content change over time?** (laws, amounts, deadlines, software versions, prices). If so, `liveData` is a natural fit: the knowledge base is dated, cited and maintained.
2. **Does it matter to know who is using it?** (level, style, budget, tools they already have). If so, `memory`: questions on first use and a stored profile.
3. **Are you willing to handle complex cases?** From your phone, at reasonable hours, with the help requests that arrive through Telegram. If so, `escalation`. If the user hesitates, do not pick this one: support that does not happen is the worst differentiator.
4. **Who will keep the knowledge base up to date, and how often?** (needed for `liveData`).

## How to run

1. **Explain the 5 in a short table** (what each is, in which Solvers it makes sense), with the Core-phase caveat. Use `search_knowledge` with "differentiators 2 of 5 criterion" if you need the reference text.
2. **Recommend the combination** according to the type of Solver. For example: technical or code: `memory` (the user's stack and style) + `liveData` (dated versions and patterns). Consultative with business rules: `liveData` (rules with source and date) + `escalation`. Content and marketing: `memory` (brand, tone, audience) + `liveData` (trends and formats). Planning or travel: `memory` + `liveData`. Data analysis: `memory` (type of spreadsheet, goals) + `escalation`.
3. **For each one chosen, write down the proof**, which is what the validator and the reviewer actually check:
   - `liveData`: `knowledge.updatedAt` within `reviewEveryDays`; **no** file with an expired `valid_until`; at least half of the knowledge files with `source_date`. Record who updates it and how often (e.g. review every 90 days).
   - `memory`: an `onboarding` block in the manifest (1 to 5 questions) and **at least one step whose text uses the profile** (it mentions the profile and says how it changes the answer). The reviewer checks that the profile really changes something.
   - `escalation`: `escalation.enabled: true` **and** a verified contact on the creator profile (Telegram is linked on the site by sending a code to the bot). Without a verified contact the differentiator does not count.
4. **Declare only what you will prove.** The manifest `differentiators` field accepts `tool`, `verifier`, `liveData`, `memory` and `escalation`, but the validator warns (`MANIFEST_DIFFERENTIATOR_UNPROVEN`) when a declared one is not proven, and (`MANIFEST_DIFFERENTIATORS_FEW`) when fewer than 2 are proven. This is a warning for the reviewer, not an automatic block, but the reviewer only approves with 2 proven.
5. **Resist the paper differentiator.** Declaring `escalation` without answering, or `liveData` with an undated knowledge base, is the fastest way to a rejection.
6. **Also record what is left for later**: if the user wanted a tool or a verifier, note it in the step 5 plan (not in the manifest).
7. Confirm: "With these two (or three) differentiators and these proofs, the reviewer can approve. Ok?"

## Common mistakes

- **Picking 5 and proving 1.** Pick fewer and prove all of them.
- **Declaring `tool` or `verifier`.** Third parties do not have them in this phase; the submission is rejected or the field goes unproven.
- **`liveData` without dates.** Every knowledge file needs `source` and `source_date` in the front-matter (step 4).
- **`memory` without use.** Questions on first use that no step takes advantage of do not count; the step text must mention the profile.
- **`escalation` without a verified channel** or without willingness to respond.
- Promising on the storefront what is not in the differentiators (for example, "result guaranteed by tests").

## result_summary format

```
DIFFERENTIATORS (minimum 2)
- liveData: proof = knowledge base with source/source_date, updatedAt, reviewEveryDays=N; maintained by: who/when
- memory: proof = onboarding (N questions) + step X uses the profile
- escalation: proof = enabled + Telegram linked (the user confirmed)
LEFT FOR LATER: tool/verifier (plan in step 5)
DECLARED IN THE MANIFEST: differentiators = [...]
RISK: what the reviewer may question
```

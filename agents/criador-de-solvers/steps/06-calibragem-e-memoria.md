# Step 6: Calibration and memory

## Goal

Define how the user's Solver **adapts to whoever buys it**, with a few questions on first use, and what it keeps in the buyer's memory. By the end of the step the manifest has the `onboarding` block (1 to 5 questions), `usesMemory: true`, and at least one step of the package uses the profile to really change the answer. Without real use of the profile, the `memory` differentiator is not proven and the reviewer does not accept it.

Calibration **does not change any model**: it is a short questionnaire on first use, stored as a "profile" in the buyer's memory and read in the following steps. If the user decided not to use `memory` in step 2, this step becomes a short conversation confirming that the package will have no `onboarding` (and `usesMemory` can be omitted).

## What to ask the user

1. **What changes in your answer depending on who is asking?** (level, budget, company size, style, tools they already use, constraints). Each factor that changes the answer is a candidate question.
2. **What is the minimum question to get the tone and level right from the first contact?** Start with it.
3. **Is this a lasting preference or a piece of data from this conversation?** Lasting (level, departure city, tax regime) goes into the profile. The rest stays in the conversation.
4. **If the buyer does not want to answer, what does the Solver do?** There is always a reasonable default (for example, assume "beginner").

Also reread the user's own profile (`nivel`): for a beginner, propose ready-made questions and ask only for approval.

## How to run

1. **List candidates and cut.** Keep **3 to 4 questions** (the limit is 5). Each question must pass this test: "if the answer is A or B, does the Solver do something different?". If the answer changes nothing, cut it.
2. **Write each question** as an object (template `pergunta-de-calibragem` via `get_template`):
   - `id`: lowercase letters, digits and underscore (`activity`, `regime`), unique.
   - `ask`: 10 to 200 characters, in the buyer's language, a single question.
   - `why`: 10 to 200 characters, the reason ("the amount changes depending on the activity"). The model can explain the reason to the buyer.
   - `options`: optional, 2 to 6 short options. Without `options`, the answer is free text. Prefer options: standardized answers are easier to use in the steps.
3. **Never ask for sensitive data in calibration**: passwords, documents, cards, keys, account numbers, detailed health data, a full address. The validator warns (`ONBOARDING_SENSITIVE`) when it finds terms such as password, CPF (Brazilian individual taxpayer number), CNPJ (Brazilian company number), card, token or gov.br, but **the warning is only a heuristic**: the reviewer reads every question. Replace them with ranges ("monthly income: up to 3k, 3 to 8k, over 8k") or categories.
4. **Every question can be skipped.** There is no "required" field. Define the default for when a question is skipped and write it in the step that uses it. The platform records the skip as `skipped` and **does not ask again every session**; the buyer can ask to "recalibrate" whenever they want.
5. **Profile, notes and summary are different things** (explain this to the user):
   - **Profile** (`profile`): the calibration answers, up to 2,000 characters, saved during the first-use calibration.
   - **Notes** (`notes`): up to 30 notes of 3 to 500 characters, saved **only when the buyer asks** ("save this so I don't forget").
   - **Summary** (`summary`): free text of up to 4,000 characters, which replaces the previous one entirely; use it only if the method needs continuity between sessions.
   No sensitive data in any of the three. The memory is encrypted and tied to the buyer's account; the text shown to the buyer must not promise that "only they can read it".
6. **Make the steps use the profile.** In at least one step, write something like: "Read the profile with `get_memory`. If `activity` is Service, use the services amount; if the profile is empty or skipped, ask only what is needed and proceed with the default". The step text **must contain the word profile** (it is what the validator looks for) and say how it changes the answer. The profile is user data and **can never remove a gate** or change the rules of the method.
7. **If memory is not available** (a connection without the memory key), the Solver proceeds with the defaults and says how to reconnect; write the step so it tolerates that.
8. **Update the manifest**: `"usesMemory": true` and the `onboarding.questions[...]` block. `onboarding` requires `usesMemory: true` (error `ONBOARDING_NEEDS_MEMORY` if missing).
9. **Validate**: call `run_tool` with `tool` equal to `validate_package`, with `manifest`, `steps` and `files`. Confirm that `memory` shows up in `stats.differentiators`. In future updates of the Solver, changing the `onboarding` is a MAJOR change (version 2.0.0).

## Common mistakes

- **Too many questions** (6 or more; the limit is 5). It wears the buyer out on first contact.
- **A question whose answer is never used.**
- **Sensitive data "because it helps".** It does not help enough for the risk.
- **Forgetting what to do when skipped.** It becomes a production bug ("undefined profile").
- **Confusing profile with notes.** Profile is calibration; notes only on request.
- **A step that does not mention the profile.** The `memory` differentiator is not proven and the validator warns (`MANIFEST_DIFFERENTIATOR_UNPROVEN`).
- **`options` with 1 or 7 options**, `ask` or `why` too short (under 10 characters).
- Promising that the Solver "learns" or "trains" with the buyer: it only remembers answers.

## result_summary format

```
CALIBRATION (N questions)
- id=... | ask=... | options: A/B/C | changes: (what the Solver does differently)
DEFAULT IF SKIPPED: ...
PROFILE vs NOTES: profile = ...; notes only on request; no sensitive data
STEPS THAT USE THE PROFILE: steps/0X (how)
MANIFEST: usesMemory=true, onboarding ok
VALIDATOR: memory proven: yes/no | errors: N
```

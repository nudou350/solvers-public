# Step 3: Process and gates

## Goal

Turn the user's method into **3 to 6 steps** that the buyer's AI can follow to the letter, write each one as a `steps/NN-name.md` file with the 5 required sections, and run `validate_package` until the manifest and the steps have no errors. This is the most important step of the package: it is where the buyer's model is "programmed" by text. A badly written step makes the AI skip things, make things up, or ramble.

Steps are written **for the AI, in the second person**, in the imperative ("Ask...", "Calculate...", "Show..."). The end user never sees the raw text.

## What to ask the user

Reread the sheet (step 1) and the differentiators (step 2). Ask:

1. **How do you do this work in real life, from start to finish?** Ask for the steps in the order they happen, as if explaining to a colleague.
2. **Where do people most often make mistakes or forget something?** Each frequent mistake becomes a gate item or an entry in the "Common mistakes" section.
3. **What has to be ready for you to consider each step done?** That becomes the gate.
4. **What does the buyer need to tell you first?** That becomes "What to ask the user".
5. **What document, plan or result comes out of each step?** That becomes the "result_summary format".

## How to run

1. **Design 3 to 6 steps** (the package limit is 12, but fewer is better). Each with: a one-sentence goal, an input (what the AI needs to know), an output (what the AI delivers) and a verb-led name ("Collect the invoices", "Classify", "Generate the payment slip"). Show the design to the user and ask for approval before writing.
2. **For each step, write the file** using `get_template` (name `etapa-modelo`) as a base. The sections must have exactly these English titles (the standard; the validator matches them literally, and it still accepts the old Portuguese titles `Objetivo`, `O que perguntar ao usuário`, `Como executar`, `Erros comuns` and `Formato do result_summary` for older packages; the text under them can be in any language):

```
# Step N: <title>
## Goal
## What to ask the user
## How to run
## Common mistakes
## result_summary format
```

   Required by the validator (an error in specVersion 1): `Goal`, `How to run` and `result_summary format`. The other two should be there as well (without them there is a warning).
3. **Length**: 400 to 12,000 characters per step. A comfortable target: 2,000 to 6,000.
4. **"How to run" must be numbered and concrete.** Instead of "analyze the case", write "list the 5 largest expenses, sum them by category and show the total with two decimal places". Include short input and output examples. Say what to do when information is missing ("if the user does not know, offer ranges").
5. **Gates**: 3 to 6 items per step in the manifest (`steps[].gate`), each one **verifiable**: "Monthly total confirmed with the user" (verifiable), not "Step done well". More than 6 items raises `GATE_TOO_MANY`, which in specVersion 1 (new creators) is an error and blocks submission. The manifest gate and the implicit checklist in the text must say the same thing.
6. **Make the step use what the package has.** If there is knowledge, write "query `search_knowledge` with the question X and **cite the source and the date** that come with the excerpt". If there are templates, "call `get_template` with the name `relatorio-mensal`". If there is a profile (the `memory` differentiator), write, for example, "read the profile (`get_memory`) and adjust the tone and the level of detail to it". **If the step text does not mention the profile, the validator cannot prove `memory`.**
7. **Disclaimers**: for tax, regulatory or health-adjacent content inside an allowed category, the last step's gate includes "reminder to check the official source" and the step text carries the ready-made disclaimer.
8. **Only talk about tools if they exist.** Third parties have no tools in the Core phase: do not mention made-up tool names. The names of the connector tools (`search_knowledge`, `get_memory`, `save_memory`, `get_template`, `next_step`) can be mentioned.
9. **Write `title` and `gate` in the manifest** and **run the validator**: call `run_tool` with `tool` equal to `validate_package` and the input with `manifest` (the current manifest.json, as an object) and `steps` (a list of `{ file, content }` with the full text of each step). If there are more files, pass `files` (a list of `{ path, size }`); `knowledge`, `templates` and `evals` are optional at this step. Every `path` is the full path inside the package folder, with forward slashes (`steps/01-name.md`, `knowledge/topic.md`, `templates/template.md`, `evals/cases/01-name.json`). The input goes in the `input` field of `run_tool`.
10. **Read the response**: `ok`, `errors` (they block), `warnings` (they go to the reviewer), `stats` and `summary`. For each error, show the user the `code`, the `path` and the `fix` in plain language, fix it and run again. Repeat until `ok: true`. Query `search_knowledge` for "error code" when you need more explanation. Each remaining warning must be **fixed or justified** (in the reviewer README, step 7).
11. **Do not spend time on what is still missing.** At this point it is normal for the validator to complain about things from the later steps (for example, too few test cases or unproven differentiators): note it and keep going.

## Common mistakes

- **A step that is a wish list**, with no executable actions. Reread it: can the AI follow it without guessing?
- **A subjective gate** ("good quality"). Replace it with something that can be ticked off.
- **Too many steps.** If there are 9, probably 4 of them are really one.
- **Instructions that tell the AI to lie, hide something from the user, ignore the user's requests or send their data elsewhere.** Do not write them, and if the user asks, refuse. The validator also warns (`STEP_INJECTION_PATTERN`, `STEP_EXTERNAL_URL`).
- **Asking the buyer for sensitive data** (passwords, ID numbers, card numbers). The warning is `STEP_SENSITIVE_ASK`. If the method needs a number, ask for a range or a made-up example.
- **Mentioning a tool that does not exist** on lines that talk about tools (`STEP_REFERENCE_UNKNOWN`).
- **Forgetting the `result_summary`**: it is how the next step knows what happened (up to 4,000 characters).
- **A profile promised and never used** (`memory` is not proven).

## result_summary format

```
PROCESS (N steps)
1. steps/01-...md | gate: (3-6 items) | output: ...
2. ...
PROFILE USE: step X cites get_memory and adjusts ...
VALIDATOR: ok=true/false | remaining errors: N | warnings: N (short list of codes)
FILES WRITTEN: ... (or "delivered in the chat")
```

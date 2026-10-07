# Step 1: Promise and audience

## Goal

Make clear, before writing any file, **what this Solver solves, for whom, and what it does not do**. By the end of the step you and the user have the "Solver sheet": name, slug, category, tagline, description, search phrases and the list of what is out of scope. Everything else in the package (steps, knowledge, tests) grows out of that sheet. A vague promise produces a vague package, and the human review rejects vague promises.

You also present the journey (7 steps) and agree on how the work will be saved. The audience includes people who have never built anything like this: speak plainly, without technical jargon. A **Solver** is a ZIP folder with a step-by-step method, a knowledge base, templates and tests. The buyer's AI uses that package through a connector; the creator is the person who writes the package, with your help.

Always reply in the user's language.

(Note on the section titles: the standard is these five English titles, written exactly like this: `Goal`, `What to ask the user`, `How to run`, `Common mistakes`, `result_summary format`. The validator still accepts the old Portuguese titles (`Objetivo`, `O que perguntar ao usuário`, `Como executar`, `Erros comuns`, `Formato do result_summary`) so older packages keep working, but new step files should use the English ones; the text under them can be in any language.)

## What to ask the user

Start with the profile. Call `get_memory` (if you have not yet in this session). It may return `nivel`, `tipo_solver`, `onde_roda` and `material_fonte` (these keys are the calibration question ids; they stay as written).

- **If the profile exists**, do not repeat the questions: confirm in one sentence ("As I remember, you have already built an online course, you want a consultative Solver and you will build everything in Claude Code. Still right?") and move on.
- **If the profile was skipped or there is no memory**, ask only the essentials, in one message: whether this is their first time, which AI they will build the package in (Claude Code, Claude or ChatGPT) and whether they already have material (PDFs, spreadsheets, notes).
- **If the profile exists but a key is missing** (the person skipped one of the questions, for example `material_fonte`), use the ones you have and ask only the missing one, at the moment it matters (the material, for example, in step 4). Do not repeat what they already answered.

Then, about the idea (at most 5 questions per message, grouped; there are 6 in total, so split them across two messages, starting with 1 to 3):

1. **What concrete problem does the Solver solve?** Ask for a real example of someone who would look for it ("a dentist who does not know how to close the month for her practice").
2. **Who buys it?** Level of knowledge, profession, situation. One audience only.
3. **What does the person walk away with?** A plan, a document, a decision, a spreadsheet, reviewed code.
4. **What will you NOT cover?** At least 3 limits. If the user does not know, propose them yourself.
5. **Why are you the right person?** Experience, years of client work, verifiable results. This becomes the creator bio and the buyer's trust.
6. **Does something similar already exist?** What would yours do differently (this feeds step 2).

## How to run

1. **Adjust the tone to the profile.** `nivel` = "First time": explain each term in half a sentence and guide step by step. "Already published a digital product": be direct and skip the basic explanations.
2. **Present the journey in 6 lines**: the 7 steps (promise, differentiators, process, knowledge, tools, calibration, test cases and ZIP), that the server validator checks the work along the way, that **nothing is sent to anyone unless the user decides**, and that the final submission goes through the website and gets **human review within 5 business days**. Also say that you do not promise approval or a rating on the storefront.
3. **Agree on the "package notebook".** In Claude Code: create the folder `<slug>/` in the current directory and write the files into it as you go. In Claude or ChatGPT with file generation: keep the files in an artifact or working file that you update. Without file generation: keep an updated summary in the chat and hand over the files in blocks in step 7. In every case, the `result_summary` text of each step carries the decisions, so the conversation can be resumed.
4. **Write the promise** with the formula "result + audience + without the pain". Test: would someone type this in a search? Good: "Close the month for a Brazilian MEI without mistakes: limit, DAS and report" (MEI is Brazil's micro-entrepreneur tax regime, DAS its monthly tax payment slip). Bad: "I help with business".
5. **Define what it does not do** (3 items or more), for example: "does not do full accounting", "does not file income tax returns", "does not replace an accountant in case of registered tax debt".
6. **Choose the category** among those allowed to new creators. The manifest `category` field takes these exact Portuguese keys (the site shows them translated): `Desenvolvimento` (Development), `Design`, `Dia a dia` (Everyday), `Negócios` (Business), `Viagens` (Travel), `Conteúdo` (Content), `Escrita` (Writing), `Outros` (Other). **Finance (`Finanças`), Legal (`Jurídico`) and health are not accepted in this phase** (the validator rejects them with `MANIFEST_CATEGORY_FORBIDDEN`). If the user's topic falls there, say so frankly and offer an honest narrower scope (for example, document organization or general education, without recommendations). Never help hide the topic by switching the category: the reviewer reads the content. Tax or regulatory content inside an allowed category requires a visible disclaimer in the text.
7. **Write the storefront fields** (check the knowledge base with `search_knowledge` if you doubt a limit): `name` from 3 to 32 bytes (accented letters count 2), `slug` from 3 to 40 characters (lowercase letters, digits and hyphens; it cannot look like a 32-character code of letters and digits nor be a reserved name such as claude, openai or anthropic), `tagline` from 10 to 100 characters, `description` from 120 to 2,000 characters explaining what it delivers, for whom, and what it does **not** do.
8. **Write 8 to 15 `searchPhrases`** (3 to 120 characters each, at most 20) in the words of the buyer, not yours: "how much DAS do I owe", "I am close to the MEI limit". Each phrase must match the real content; the reviewer checks, and off-topic phrases count as search manipulation.
9. For the tagline and the description, request the `manifest-esqueleto` template with `get_template` (use the `session_id` and the name) and fill in only those fields for now.
10. Show the **Solver sheet** and ask for approval. If the sheet is strong, move on; if not, go back to item 4.

## Common mistakes

- **Promise too big** ("I solve marketing"). Cut it until it fits in one sentence and one deliverable result.
- **Two audiences mixed** (beginner and expert). Pick one; the other becomes a second Solver.
- **Promising a result** ("double your sales", "pass the exam"). Promise what the method delivers (a plan, a report), never a financial, legal or health result.
- **A regulated category in disguise.** Do not help work around it; explain and redirect.
- **A slug that imitates a brand** or a reserved name. Choose a name of your own.
- **`searchPhrases` about another topic** to show up more. It is rejected in review.
- Asking the user for their personal data. To build the package you only need the subject, never personal documents, passwords or keys.

## result_summary format

When calling `next_step`, pass the sheet in up to 1,500 characters:

```
SHEET
- Name: ... | Slug: ... | Category: ...
- Promise: ...
- Audience: ...
- Delivered at the end: ...
- Does not do: (1) ... (2) ... (3) ...
- tagline: ... (NN characters)
- description: draft with NNN characters
- searchPhrases: N phrases
PROFILE USED: level=..., type=..., client=..., material=...
NOTEBOOK: folder <slug>/ | artifact | summary in chat
```

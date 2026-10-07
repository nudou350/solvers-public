# Step 7: Test cases and ready-to-submit ZIP

## Goal

Close the package: write **10 or more test cases (evals)** with checks that really test something, finish the manifest, the price and the reviewer README, run `validate_package` on everything, **build the right ZIP** and prepare the user for submission and review. By the end, the user has a `.zip` file that passes validation and knows exactly what happens next.

Agree with the user's client (profile `onde_roda`) on how the ZIP will be delivered:
- **Claude Code**: you write the folder to disk and build the ZIP with a command.
- **Claude or ChatGPT with file generation** (data analysis, code environment): you generate the ZIP for download.
- **Without file generation**: you deliver the files in blocks, in order, with step-by-step instructions for the user to assemble the folder and zip it.

## What to ask the user

1. **What are the 5 most common requests** a buyer would make to the Solver? Each one becomes a case.
2. **Which requests should the Solver refuse or limit?** (out of scope, promise of a result, sensitive data). They become edge cases.
3. **Which mistakes would be the most serious** (a wrong value, an outdated rule, forgetting the disclaimer)? They become checks.
4. **Price**: how much to charge? The minimum today is **5 USDC (about US$5)** (field `priceUsdc`); `royaltyBps` (0 to 1,000; 300 = 3%) is the share the creator receives when a license is resold. Do you want to offer a **free trial**? It has to show value without giving everything away.
5. **Who is the creator on the storefront?** Name, a short and truthful bio.
6. **Do you have a final folder name/slug?** (the same as in step 1).

## How to run

### Part A: test cases

1. **Write 10 to 40 cases** (target: 12) in `evals/cases/NN-name.json`, one per file. Use `get_template` with the name `caso-de-eval`:

```
{
  "id": "02-freelancer-reserve",
  "input": "I'm self-employed and earn between 3 and 7 thousand a month. How much emergency fund should I keep?",
  "checks": [
    { "type": "regex", "value": "worst month", "description": "Uses the worst month as the baseline" },
    { "type": "regex", "value": "\\d+\\s*months", "description": "Gives the reserve in months" },
    { "type": "not_contains", "value": "guaranteed return", "description": "Does not promise returns" }
  ]
}
```

2. **Check types**: `contains` (the text appears), `regex` (a regular expression, case-insensitive; in JSON the backslashes are doubled: `\\d`) and `not_contains` (the text does not appear). Every `check` has `type`, `value` and `description` (so the reviewer understands why it exists). `id` is unique across all cases.
3. **Recommended distribution of 12 cases**: 5 or 6 typical requests; 2 or 3 edge cases (missing information, out-of-scope request); 2 on safety and promises (asking for sensitive data, asking for a guaranteed result); 1 on calibration or memory; 1 on disclaimer and source.
4. **Each case with 2 to 4 checks**, mixing: **content** (a term, rule or number that only someone who followed the method would say), **behavior** (cites the source and date, adds the disclaimer, asks for what is missing) and **anti** (`not_contains` with a promise or a serious mistake). Choose texts that appear in any correct answer (use alternatives in the regex: `month|months`).
5. **Quality test**: "would any AI, without the Solver, pass this case?". If so, the check is weak; swap it for something specific to the method. And: "if the Solver got it wrong, would the case fail?". If not, it is weak too.
6. **Do not write** `rubric` or `mustCallTools` (they only work when the platform runs the case), **nor `evals/report.json`**, nor scores or pass percentages: the platform measures later, and **no score is made up**. Sample answers (`evals/outputs/`) are optional.

### Part B: finish the manifest

7. Complete `pricing` (`priceUsdc` of 5 or more), `creator` (`id` can be any short text, the server replaces it; `name`, `bio`), `requirements`, `packageContents` (3 to 8 items, only what exists), `versions` with the `1.0.0` entry (the current version needs an entry), `terms` with `rightsConfirmed` and `sourcesListed` both `true` and, if desired, `trial` (`uses`, `steps` no greater than the number of steps, `searches`, `tools` empty, `summary` and `lockedSummary`). Do **not** write an `id` in the first version (the server assigns it), nor `platform`, nor `tools`.
8. **Reviewer `README.md`**: template `readme-do-revisor`. Say what the Solver promises, how each differentiator is proven, which validator warnings remain and why, where the sources come from and who holds the rights, and the step 5 plan. This text never reaches the buyer.

### Part C: validate

9. Run `run_tool` with `tool` equal to `validate_package` and the full input: `manifest`, `steps` (the content of each step), `files` (every file with its size in bytes), `knowledge` (`path` and `head` of each file), `templates` and `evals` (`path` and `content`). In all of them, `path` is the full path inside the folder (`templates/template.md`, `evals/cases/01-name.json`): with any other path, the test case or the template is not counted. Beforehand, check that each template declared in `templates` has its file written (`TEMPLATE_MISSING`). The call has a cap of about 1 MB: for large packages, send only the beginning of the knowledge files.
10. **Get the errors to zero** and go through the warnings one by one: fix them or justify them in the README. Codes and fixes: search the knowledge base for "error code". `stats.differentiators` shows the proven differentiators: there must be **at least 2**.
11. Go over the **pre-submission checklist** with the user (template `checklist-pre-envio`). Main items: all files exist, only `.json`, `.md` and `.txt`, no personal data, dated sources, no promise of a rating, approval or result.

### Part D: build the ZIP

12. **Structure**: a single root folder named with the slug; inside it `manifest.json`, `steps/`, `knowledge/`, `templates/`, `evals/cases/` and `README.md`. Paths with only letters, digits, dot, hyphen, underscore and space; **no name starting with a dot**; no `__MACOSX`, `.DS_Store`, `Thumbs.db` (they are removed with a warning, but avoid them). Limits: ZIP up to 50 MB, file up to 10 MB, up to 2,000 files.
13. **Build the ZIP according to the client**:
    - Claude Code: zip the **folder** (not its contents), for example `zip -r my-solver.zip my-solver -x "*.DS_Store"` on macOS or Linux, or `tar -a -c -f my-solver.zip my-solver` on Windows 10 or 11. Avoid `Compress-Archive` from Windows PowerShell 5.1, which writes backslashes in the paths and leads to the `ZIP_BAD_PATH` error.
    - Claude or ChatGPT with file generation: use code (Python `zipfile`, with the internal name `my-solver/manifest.json`, forward slashes) and offer the download. The knowledge base has a ready snippet: search for "ZIP delivery".
    - Without file generation: deliver each file in a block with the full path in the title, in order; ask the user to create the folder, paste each content and **zip the whole folder** (right-click, "Send to compressed folder" on Windows; "Compress" on macOS).
14. **Validate the whole ZIP**: if the user has the team's validation script (`solvers validate <folder or ZIP>`), ask them to run it and bring the result. Without the script, warn them that **the site validates again on submission** and shows the errors.

### Part E: submission and review

15. Explain, in plain language:
    - On the site, open the `/creator/publish` area (solvers.wondervelop.com), sign in and choose the ZIP. For now only invited creators can submit packages.
    - The site validates again; if there is an error, it shows the code, the path and how to fix it.
    - **A team member reviews all the content within 5 business days.** They can approve, request changes (the user fixes and resubmits the same version) or reject with the reason. **Approval is not guaranteed.**
    - Once approved, the creator confirms the publication on the site. Every new version (even a small one) goes through full review, with a version higher than the published one.
    - The Solver does not appear on the storefront before that. The platform measures performance afterwards; no rating is promised.

## Common mistakes

- **Cases that are too easy** (`contains` of a common word like "the" or "of"). Always 2 to 4 specific checks.
- **Fewer than 10 cases** (error `EVAL_TOO_FEW_CASES` in specVersion 1) or a **repeated `id`** or a check without `description` (`EVAL_CASE_INVALID`).
- **Invalid regex** (backslashes not doubled in the JSON, an open parenthesis).
- **A ZIP with two folders** or with loose files at the root (`ZIP_BAD_ROOT`).
- **Forgetting `terms`** (`TERMS_MISSING`) or the `versions` entry (`MANIFEST_VERSIONS_MISSING`).
- **A price below the minimum** (`MANIFEST_PRICE_BELOW_MIN`).
- **Making up a score** or creating `evals/report.json`. Do not create it.
- **Promising the user an approval date** or sales.

## result_summary format

```
PACKAGING
- Test cases: N (typical X, edge Y, safety Z) | no report.json and no scores
- Manifest: price, versions 1.0.0, terms, creator ok
- validate_package: ok=true | errors 0 | warnings: codes justified in the README
- Proven differentiators: [...]
- ZIP: name, client used, whole-ZIP validation: done / will be done on the site
- Guidance given: submission at /creator/publish, human review within 5 business days, no guarantee of approval
```

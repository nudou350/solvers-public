# Step 5: Tools and verification

## Goal

Agree with the user, **without creating false expectations**, on what is possible today regarding tools and verification of the result, **record the plan** for what they would like to have in the future, and define the **substitute verification** the package will have today. By the end of the step the manifest is consistent with the phase: no `tools`, no test-based guarantee, no `verifier/` folder.

The rule of this phase (the Core phase): packages from new creators are **guided process + living and cited knowledge + memory + creator support**. An **executable tool on the server** (for example, a calculator that really runs) and an **automatic result verifier** (for example, running tests) are not yet open to third parties. They are left for the Opening phase, with their own security rules, and no promised date. This is less than a full platform Solver has, but it is already well beyond an ordinary skill. Tell the user this naturally, without drama.

## What to ask the user

1. **Is there any calculation, lookup or check that your method does and that text does not handle well?** (summing values, comparing tables, querying a rule in an API, running a test). If so, it is a candidate for a future tool.
2. **What data would go into that tool and what would come out?** Prefer numbers and closed options. Personal data and free text are a security and privacy problem.
3. **Can your Solver's result be checked objectively?** (the sum matches, the text cites the source, the code passes the tests). This inspires the gates and the test cases.
4. **Would the user accept publishing now without a tool and adding one later?** The answer is almost always yes, and adding one later is a new version (a MAJOR change, with full review).

## How to run

1. **Explain the rule of the phase** in 4 sentences (see the objective). If the user wanted a tool or a test-based guarantee as the main selling point, help decide whether it is worth publishing now with the other differentiators or waiting.
2. **If there are candidates for a future tool, record the plan** (it does not go in the manifest). For each one, note a block like this:

```
name: calculate_limit
what it does: sums the year's revenue and says how much of the limit remains
input: revenue (list of numbers), year (number)
output: accumulated, remaining, alert (short text)
why text is not enough: arithmetic mistakes with many installments
does data leave the platform server? yes/no (would need the user's consent)
```

   If there are none, record the word **none**. This plan goes in the reviewer's `README.md` (template `readme-do-revisor` via `get_template`, section "Plan for the Opening phase") and in the `result_summary`.
3. **Show, in one sentence per item, how it will work in the Opening phase** (so the user knows what to expect): third-party tools will be called over a secure connection, with restricted input (options and numbers, short texts), typed output and a verified domain; any change of address or of the fields sent will be a MAJOR version; the buyer will be told that the data they enter leaves the platform server. All of this **is not available yet**.
4. **Define the substitute verification** the package will have today:
   - **Objective gates** in every step (step 3): items that the AI and the user can tick off.
   - **Cross-checking in the step text**: "redo the calculation another way and compare", "list the cited sources and the date of each", "reread the result against the checklist".
   - **Templates** (`templates/`) with the exact structure of the deliverable, so the result comes out standardized. **Write now the file for each template declared in `templates` in the manifest** (`templates/<name>.md`, in Markdown, with fields to fill in and no leftover "REPLACE" markers): the package's `get_template` only delivers what exists, and a missing file is the error `TEMPLATE_MISSING`. The Creator's own templates (`get_template`) are for inspiration, not for copying.
   - **Test cases** (step 7) with text and number checks.
5. **Clean up the manifest**: no `tools` (or `tools: []`), `guarantee: { "available": false, "defaultCriteria": [] }`, no `platform`, no `verifier/` folder. Third parties with a tool get `TOOL_FORBIDDEN_RUNNER`; with a guarantee, `MANIFEST_GUARANTEE_FORBIDDEN`; with `platform` or `verifier/`, `MANIFEST_PLATFORM_FORBIDDEN`.
6. **Check `differentiators`**: no `tool` and no `verifier`. If they were there, remove them and see whether 2 proven ones still remain (step 2).
7. **Adjust the storefront to what exists.** Review `description`, `packageContents` and `beforeAfter` (optional: up to 5 examples `{ prompt, withoutSolver, withSolver }`; if there are none, leave it out of the manifest) so they do not promise server-side calculation, automatic verification, tests running or a guarantee. The validator warns when `packageContents` talks about a tool or guarantee the package does not have (`CONTENTS_MISMATCH`).
8. Show the user the "Today / Later" summary and ask for an ok.

## Common mistakes

- **Promising on the storefront what only exists in the Opening phase.** It is the most common mistake in this step.
- **Declaring a tool "just for the record".** The runner is rejected and the submission stalls.
- **Marking the guarantee as available.** In this phase it is an error.
- **Free input in a future tool.** Prefer options and numbers; free text becomes a security risk.
- **Throwing the plan away.** Noting what the tool would be helps the product roadmap and the reviewer.
- **Treating verification as "the AI checks it by itself".** Without objective gates, checking is only a promise.

## result_summary format

```
TOOLS AND VERIFICATION
- Phase rule explained: yes
- Plan for the Opening phase: (name + function) or "none"
- Substitute verification: objective gates in steps X, Y; cross-check in step Z; templates: ...
- Manifest: tools empty | guarantee.available=false | no verifier/
- Storefront adjusted: packageContents and description with no tool promise
```

---
title: Validator error codes (steps, knowledge, templates, tools, tests) and how to fix them
source: Catalog of validation codes of the Solvers platform (Appendix A of the v1 specification)
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [errors, validator, steps, knowledge, evals]
---

# Validator error codes (steps, knowledge, templates, tools, tests) and how to fix them

Each validator response carries `code`, `path`, `message` and `fix`. An error (E) blocks; a warning (A) goes to the reviewer.

## Steps

- `STEP_FILE_MISSING` (E): the manifest declares a step whose file does not exist. Create the file or fix the path.
- `STEP_SECTION_MISSING` (E in specVersion 1 for Goal, How to run and result_summary format; a warning for the other two): a section is missing. Add the line `## Title` with the exact name (the section titles are the English standard: `Goal`, `What to ask the user`, `How to run`, `Common mistakes`, `result_summary format`; the old Portuguese titles `Objetivo`, `O que perguntar ao usuário`, `Como executar`, `Erros comuns`, `Formato do result_summary` are still accepted for older packages).
- `STEP_TOO_SHORT_LONG` (E): step outside 400 to 12,000 characters. Add detail or split it.
- `GATE_TOO_MANY` (E): a gate with more than 6 items. Reduce and group.
- `GATE_EVIDENCE_UNKNOWN_TOOL` (E): a gate with evidence from a tool that does not exist. In this phase use text gates only (no `evidence`).
- `STEP_REFERENCE_UNKNOWN` (W): the step mentions, next to `run_tool` or the word "ferramenta" (tool), a name that does not exist in `tools`. Fix the name, remove the mention (third parties have no tools) or use a connector tool.
- `STEP_SENSITIVE_ASK` (W): the step tells the AI to ask for sensitive data. Rewrite it to ask for ranges, made-up examples or to guide the user to do it themselves.
- `STEP_EXTERNAL_URL` (W): an internet address next to a sending verb, or with parameters. Remove it; a step does not send data outside.
- `STEP_INJECTION_PATTERN` (W): a passage that seems to tell the AI to discard rules, hide something from the user or pose as the system. Rewrite without it.
- `TEXT_HIDDEN_CHARS` (W): an invisible or direction-control character. Delete and retype the passage.

## Knowledge

- `KNOWLEDGE_SOURCE_MISSING` (E): a file without `source` in the front-matter (or without front-matter; a `.txt` without its `.meta.json`). Add the source.
- `KNOWLEDGE_DATE_INVALID` (E): `source_date`, `valid_until` or `knowledge.updatedAt` outside `YYYY-MM-DD` or a nonexistent date. Write it like 2026-09-30.
- `KNOWLEDGE_FRONTMATTER_INVALID` (E): a `---` block opened and not closed, a line that is not `key: value`, or a repeated key. Fix the header.
- `KNOWLEDGE_EXPIRED` (W): `valid_until` has already passed. Update the file and the date, or remove it.
- `KNOWLEDGE_TOO_BIG` (E): more than 10,000 excerpts. Prioritize the essentials.
- `PDF_NO_TEXT` (E, reserved for the Opening phase): a PDF without text. Today a PDF is not even accepted: convert it to `.md`.

## Templates

- `TEMPLATE_MISSING` (E): a template declared in `templates[]` whose file does not exist. Create it or fix the path.
- `TEMPLATE_UNDECLARED` (W): a file in `templates/` without a declaration; it will not be delivered. Declare it in `templates[]` or remove it.
- `TEMPLATE_TYPE_FORBIDDEN` (E): a type that is not valid in this phase. Use `.md`, `.txt` or `.json`.

## Tools (not valid for new creators)

- `TOOL_FORBIDDEN_RUNNER` (E): the package has a tool; new creators have no tools in this phase. Remove `tools` and record the plan in step 5 of the Creator.
- `TOOL_SCHEMA_MISSING`, `TOOL_SCHEMA_UNSAFE`, `TOOL_HTTP_HOST`, `TOOL_EGRESS_MISSING`: errors for tools over the internet, only relevant in the Opening phase.

## Free trial

- `TRIAL_STEPS_EXCEED` (E): `trial.steps` greater than the number of steps. Reduce it.
- `TRIAL_TOOL_UNKNOWN` (E): `trial.tools` mentions a tool that does not exist. Leave `tools` as `{}`.
- `TRIAL_TEMPLATE_UNKNOWN` (E): `trial.templates` mentions a template that is not in `templates[]`. Use only existing names.

## Calibration

- `ONBOARDING_NEEDS_MEMORY` (E): there is an `onboarding` without `"usesMemory": true`. Add it.
- `ONBOARDING_SENSITIVE` (W): a question with a sensitive-data term (password, CPF, card, token...). Replace it with ranges or categories.

## Test cases (evals)

- `EVAL_TOO_FEW_CASES` (E in specVersion 1): fewer than 10 cases. Write more, covering typical requests, edge cases and safety.
- `EVAL_CASE_INVALID` (E): a case without `id`, with a repeated `id`, without `input` or `checks`, with a `type` other than `contains`, `regex` or `not_contains`, a check without `value` or `description`, or an invalid regex. Fix it using the `caso-de-eval` template.

## Internal codes (from review)

- `DIFF_UNREVIEWED_FILE` (E) and `SCAN_DUPLICATE_CONTENT` (W): these belong to the platform's review stage. The second warns that the content looks like that of another published package: if it is yours, explain it in the README; if not, rewrite it.

## How to read the validator response

The response carries `ok` (true when there are no errors), `errors`, `warnings`, `stats` (files, steps, cases, estimated excerpts, proven differentiators) and `summary`. Fix **errors from the most structural to the finest** (manifest, then steps, then knowledge) and run again. Warnings that remain must be justified in the reviewer README.

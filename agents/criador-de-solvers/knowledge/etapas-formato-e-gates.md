---
title: Steps and gates: format, length and scans
source: Solver package specification v1 (PACKAGE_SPEC), section 5, and the platform validator rules
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [steps, gates, sections]
---

# Steps and gates: format, length and scans

This knowledge file explains the exact format of the Solver's step files: the five sections, the length, the gates, the summary between steps, the tools that can be mentioned and the automatic scans that raise warnings for the reviewer.

## What a step is

Each step is a `.md` file in `steps/`, written **for the buyer's AI**, in the second person and the imperative. The server delivers **one step at a time** (`next_step`): the AI only moves on after meeting the gate and sending the step summary. The buyer never sees the raw step text.

## The 5 sections (exact titles)

The file starts with the title `# Step N: <title>` and then has, in this order, the sections `## Goal`, `## What to ask the user`, `## How to run`, `## Common mistakes` and `## result_summary format` (each on its own line, with two `#` signs). These English titles are the standard. The validator still accepts the old Portuguese ones (`## Objetivo`, `## O que perguntar ao usuário`, `## Como executar`, `## Erros comuns`, `## Formato do result_summary`) so older packages keep working; use the English ones in new packages. The text under them can be in any language.

- `Goal`, `How to run` and `result_summary format` are **required**: missing one is an error in specVersion 1 (`STEP_SECTION_MISSING`).
- `What to ask the user` and `Common mistakes` should also exist; without them there is a warning.
- The section title must be identical to the above (the match is on the line `## Title`).

## Length

400 to 12,000 characters per step (`STEP_TOO_SHORT_LONG`, an error in specVersion 1). Steps that are too short tend to be vague and leave the AI guessing; ones that are too long lose focus and are hard to review. A comfortable target: 2,000 to 6,000 characters. If it goes over 12,000, split it into two steps.

## Gates (exit checklist)

Each step's `gate` in the manifest has 0 to 6 text items (more than 6 is `GATE_TOO_MANY`, an error in specVersion 1). In practice, write 3 to 6. Each item must be **verifiable**: you can answer yes or no by looking at what the AI delivered. The server does not check the gate (in this phase it is text); the AI meets it, instructed by the step, and the buyer sees it.

## result_summary

The step summary (up to 4,000 characters) is how the next step knows what happened. The "result_summary format" section defines the structure (for example, short lists with decisions, numbers and open items). Think of it as the "boarding pass" between steps.

## Tools and names in backticks

The validator looks for `snake_case` names in backticks, on lines that talk about `run_tool` or about tools, and warns when the name does not exist in `tools[]` (`STEP_REFERENCE_UNKNOWN`). The connector tool names (`search_knowledge`, `get_memory`, `save_memory`, `get_template`, `next_step`, `run_tool`) can be mentioned freely.

## Automatic scans (warnings for the reviewer)

- `STEP_SENSITIVE_ASK`: the step tells the AI to ask for a password, ID number, card, key or login. Remove it.
- `STEP_EXTERNAL_URL`: an internet address next to a sending verb (send, post, upload) or with parameters in the query. A step does not send user data outside.
- `STEP_INJECTION_PATTERN`: phrases that try to make the AI discard previous rules, hide something from the user or take on another system role.
- `TEXT_HIDDEN_CHARS`: invisible or text-direction characters (they can hide instructions).
- The same scans apply to the manifest text that reaches the model and to the calibration questions.

These are warnings, not an automatic block, but the human reviewer reads each one and can reject.

## What a step can use from the server

`search_knowledge` (search in the Solver's knowledge, returns up to 5 excerpts with source and date), `get_template` (returns a declared template), `get_memory` and `save_memory` (the buyer's profile and notes) and, at the end, `next_step`. Third parties have no tools of their own in this phase.

## A real step versus nicely written text

What makes the model follow the process is: numbered, concrete actions, short input and output examples, grouped questions, what to do when information is missing, and an objective gate. See the knowledge file on how to write steps the model follows.

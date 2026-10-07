---
title: Best practices by type of Solver
source: Solvers team curation experience with the platform's packages (React front end, trip planner, copy and marketing, contract review, spreadsheets) and the v1 specification rules
source_date: 2026-10-02
tags: [best-practices, types, technical, content, consultative, travel, data]
---

# Best practices by type of Solver

Use this knowledge file in step 1 (type of Solver) and step 3 (process). It is not a validator rule: it is what usually works. For every type the rules of the phase apply: no tools, no guarantee, no Finance, Legal or health category.

## Technical or code: process and steps

Examples: interface components, scripts, code review, tool configuration.

- Typical steps: (1) understand the request and the project (stack, versions, constraints), (2) plan the structure and the cases, (3) implement, (4) review against a checklist.
- Objective gates: "stack and version confirmed", "list of test cases approved by the user", "no pending linter warnings", "review against the checklist done item by item".
- Ask for what the user already has (a code snippet, an error message, a version) instead of personal data. Ask for minimal examples that reproduce the problem.
- Natural differentiators: `memory` (the user's stack and style) and `liveData` (dated patterns and versions).

## Technical or code: knowledge and pitfalls

- Knowledge: patterns and pitfalls dated by version ("React 19: ..."), review checklists, short examples of right and wrong code. Cite the official documentation as the source and the version date.
- Put `valid_until` on everything that depends on a version.
- Pitfalls: promising that the code "works in production" without tests; code examples with real keys or passwords; copying third-party documentation without a license; a step that tells the AI to "run on the server" something the Solver does not execute (it executes nothing in this phase).
- Test cases: the suggested code contains the right pattern (`contains`), cites the version (`regex`) and does not use the forbidden pattern (`not_contains`).

## Content and marketing: process

Examples: social media copy, emails, sales pages, scripts.

- Typical steps: (1) briefing (brand, audience, goal, channel), (2) research and angle, (3) draft, (4) review against the tone and claims guide, (5) delivery in the template.
- Gates: "briefing confirmed", "3 angles offered", "text reviewed against the list of forbidden promises", "final version in the template".
- Useful calibration: brand tone, audience, main channel, what never to say. Store it as the profile.
- Natural differentiators: `memory` (brand and tone) and `liveData` (platform formats and rules, dated).

## Content and marketing: knowledge and pitfalls

- Knowledge: a tone guide with good and bad examples, text structures (hook, proof, call to action), each channel's rules (limits, formats) with a date, a list of promises that cannot be made (guaranteed result, cure, sure gain).
- Pitfalls: promising results ("double your sales"); copying third-party text; reproducing protected brands and names as if they were yours; invented testimonials; a step that tells the AI to "hide" that the text was generated when the channel requires disclosure.
- Test cases: the text has a hook and a call to action (`regex`), cites the profile's tone, and contains no forbidden promises (`not_contains`).

## Consultative with business rules: process

Examples: monthly closing, pricing policy, process diagnosis, operational compliance (excluding regulated Finance and Legal).

- Typical steps: (1) gather the situation with numbers, (2) apply the rules with the source and date, (3) calculate and check, (4) deliver a report in the template with the disclaimer.
- Gates: "values collected and confirmed", "rule cited with source and date", "calculation redone another way", "reminder to check the official source included".
- Since there is no calculation tool, write the calculation step by step in the step, with a numeric example, and tell the AI to check it another way.
- Natural differentiators: `liveData` (dated rules and values) and `escalation` (complex cases to the creator) or `memory`.

## Consultative with business rules: knowledge and pitfalls

- Knowledge: each rule in a section, with a number, a unit, an effective period, exceptions and the official source. Mark `valid_until` on everything that expires.
- Pitfalls: an outdated rule without `valid_until`; tax or regulatory content without a disclaimer; giving an opinion ("you must do X") instead of guiding and telling the user to check; forgetting the exceptions.
- Test cases: the correct value appears (`contains`), the source and date are cited (`regex`), the disclaimer is present, and there is no "guaranteed" or definitive opinion (`not_contains`).

## Travel and planning

Examples: trip itinerary, study plan, event planning, moving.

- Typical steps: (1) profile and constraints, (2) prerequisites and deadlines (documents, bookings), (3) realistic budget, (4) a schedule that can actually be met, (5) final checklist with dates.
- The most common mistake is excess: tight schedules with no slack. Write rules such as "at most 2 big activities per day" and "a travel day counts as half a day".
- Natural differentiators: `memory` (preferences across trips or projects) and `liveData` (dated rules, deadlines and prices, always with a reminder to check the official source).
- Test cases: points out the prerequisite that is usually forgotten, uses the pacing rules, tells the user to confirm on the official site, does not promise fixed prices.

## Data analysis and spreadsheets

Examples: spreadsheet cleaning, sales dashboards, survey analysis.

- Typical steps: (1) understand the base (columns, units, period), (2) clean and check, (3) analyze with objective questions, (4) present the result with limits and assumptions.
- Ask for a **made-up or anonymized sample**, never the base with personal data. Say in the step that the AI must not repeat names, documents or contacts.
- Gates: "columns and units confirmed", "duplicate and empty rows handled and counted", "each conclusion carries the number that supports it", "sample limitations stated".
- Knowledge: a guide to common data errors, definitions of your business's metrics, naming conventions. Cite the source of the definitions.
- Pitfalls: a conclusion without a number; correlation treated as cause; mixing periods and currencies; promising a forecast.
- Natural differentiators: `memory` (type of spreadsheet and goals) and `escalation`.

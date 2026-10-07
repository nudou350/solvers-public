---
title: How to write steps the model follows
source: Solvers team curation experience with the steps of published packages and the validator rules
source_date: 2026-10-02
tags: [steps, writing, prompt, gates]
---

# How to write steps the model follows

This knowledge file gathers the practices that make the buyer's AI follow the Solver's process without skipping steps, making things up or rambling: imperative writing, numbered steps, short examples, a way out for missing information, and verifiable gates.

## Write for the AI, not for the buyer

A step is a set of instructions for the buyer's AI. Use the second person and the imperative: "Ask...", "Calculate...", "Show...". Say what to do, in order, and how to know it is finished. Talking to the buyer (marketing, storefront tone) is the AI's job, guided by the step.

## One step, one verb, one result

Each item in "How to run" must have **one clear verb and a verifiable result**. Bad: "Analyze the financial situation". Good: "List the 5 largest expenses of the month, sum them by category and show the total with two decimal places". Numbered steps keep the model from skipping stages.

## An order that works

1. First, **consult** what is already known (profile, results from the previous step).
2. Then **ask** only what is missing, grouped (at most 5 or 6 questions per message) and with what to do if the user does not know.
3. Next, **execute** with rules and examples.
4. Finally, **check** with the checklist (gate) and confirm with the user.

## Short examples beat descriptions

An input and output example teaches better than a paragraph. Write: "If the user says 'I earn between 3 and 7 thousand', use 3 thousand as the baseline and say so". Also show the **output format**: a table, a list, a template (`get_template`).

## Give a way out for missing information

Models make things up when data is missing. Write: "If the user does not know the amount, offer ranges (economy, moderate, comfortable) or ask for an estimate and record it as an estimate". Explicitly forbid inventing: "Never invent values; if it is not in the knowledge base, say it needs confirming at the official source".

## Gates that work

The gate is what the model checks before moving on. Good gates: "Monthly total confirmed with the user", "Source and date cited for each value", "Reminder to check the official portal included". Bad gates: "Step done well", "Complete answer". Keep it to 3 to 6 items and say the same thing in the step text and in the manifest.

## Use what the package has

- Knowledge: "Query `search_knowledge` with the user's question and **cite the source and the date** of the excerpt. If the excerpt warns that it may be outdated, say so".
- Templates: "Deliver in the template's format: call `get_template` with its name".
- Profile: "Read the profile with `get_memory` and adjust the level of detail; if it is empty, follow the default". Mention the word **profile** in the text, or the `memory` differentiator is not proven.
- Previous step: "Use the previous step's summary; do not ask again what has already been answered".

## Common model mistakes and how the step prevents them

- **Skipping a step or delivering early**: write "Do not present the final result before completing this step".
- **Asking too much**: limit the number of questions per message.
- **Making up numbers**: require a source and a date, and allow "I don't know".
- **Forgetting the disclaimer**: put the disclaimer in the gate and, if possible, the ready-made text of it.
- **Being generic**: ask for concrete examples from the user's case, with their numbers.
- **Answering beyond the scope**: write what the Solver does not do and how to politely decline.

## What never to write

Instructions that tell the AI to hide something from the user, ignore their legitimate requests, copy the conversation content elsewhere, ask for passwords, documents or cards, or pretend to be something else. Besides harming whoever uses it, the validator flags them and the reviewer rejects them.

## Length and tone

400 to 12,000 characters; aim for 2,000 to 6,000. Plain language, no jargon. If you use a technical term, explain it in half a sentence. If the buyer is not an expert, tell the AI to speak like "a good service agent: simple and warm".

## Read-through test

Before closing the step, reread it as if you were the AI: can it be executed without guessing? Is the result of each action clear? Can the gate be ticked yes or no? If any answer is no, rewrite.

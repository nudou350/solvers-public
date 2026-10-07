---
title: Plain-language glossary for Solver creators
source: Glossary of the Solver package specification v1 (PACKAGE_SPEC), adapted to plain language
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [glossary, terms, help]
---

# Plain-language glossary for Solver creators

Terms used when creating a Solver, explained in plain language: the product, the package, quality and review, and some technical terms that show up in validator messages. Use it to explain new words to someone who has never built anything like this.

## Product terms

- **Solver**: an AI specialist in package form (a step-by-step method, knowledge, templates and tests) that the buyer uses with their own AI, through a connector.
- **Package**: the Solver's folder, delivered as a ZIP file.
- **Creator**: whoever writes the package and publishes it on the platform.
- **Buyer**: whoever buys the license and uses the Solver.
- **License**: the buyer's lifetime right to use the Solver.
- **Connector (MCP)**: the link that lets the buyer's AI (Claude or ChatGPT) talk to the platform's server.
- **Storefront**: the public page where Solvers appear for purchase.

## Package terms

- **Manifest (`manifest.json`)**: the file that describes the Solver: name, storefront text, steps, price, calibration and more.
- **Step**: one stage of the method, in an `.md` file written for the AI.
- **Gate**: a step's exit checklist; the AI only moves on once it is met.
- **result_summary**: the summary the AI passes on when it finishes a step, so the next one knows what was done.
- **Knowledge (RAG)**: the creator's texts, split into excerpts, that the AI consults while working.
- **Excerpt (chunk)**: a piece of the knowledge returned by a search.
- **Front-matter**: the header at the top of an `.md` file, between two `---` lines, with source, date and validity.
- **Template**: a ready-made file the Solver delivers to the buyer, such as a report.
- **Eval (test case)**: a sample request with checks on the expected answer.
- **Calibration (onboarding)**: short questions on first use, which adapt the Solver to the buyer.
- **Profile**: the calibration answers, stored in the buyer's memory.
- **Memory**: what the Solver keeps about the buyer between sessions (profile, notes and summary).
- **Note**: something the buyer asks to keep ("save this").

## Quality and review terms

- **Validator**: the server program that checks the package and points out errors and warnings with how to fix them.
- **Error**: a problem that blocks submission.
- **Warning**: a point that goes to the reviewer to decide.
- **Differentiator**: something a Solver has and an ordinary skill does not: a tool, a verifier, living knowledge, memory, creator support.
- **2-of-5 criterion**: the reviewer only approves with at least 2 proven differentiators.
- **Reviewer**: the team member who reads the package before it is published (target: up to 5 business days).
- **Core and Opening**: the two phases of the platform. Today the Core phase applies (invited creators and more restricted rules); the Opening phase comes later.
- **Tool**: a feature that runs on the server and that the AI calls to calculate or look something up. New creators do not have them yet.
- **Verifier**: an automatic test of the delivered result (platform packages only).

## Technical terms that appear

- **Slug**: the Solver's short name in the address (`my-solver`).
- **Version (semver)**: `MAJOR.MINOR.PATCH`, like `1.0.0`.
- **ZIP**: the compressed file in which the package is delivered, with a single folder inside.
- **UTF-8**: the text format the package requires (it supports accents).
- **Regex**: a regular expression, a way of describing a text pattern; used in test cases.
- **Hash**: the package's fingerprint, which changes if any file changes.

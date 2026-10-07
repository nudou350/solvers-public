---
title: How to convert PDFs, web pages and spreadsheets into .md files for the knowledge base
source: Solver package specification v1 (PACKAGE_SPEC), section 6.1 and the platform chunking rules
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [conversion, pdf, html, spreadsheet, markdown, chunking]
---

# How to convert PDFs, web pages and spreadsheets into .md files for the knowledge base

This knowledge file shows, step by step, how to turn PDFs, web pages, spreadsheets, presentations and notes into `.md` files that work well for search: one file per topic, sections by headings of 200 to 2,000 characters, and a source and date in every file.

## Why convert

In this phase knowledge accepts only `.md` and `.txt`. The conversion is done **in the creator's own AI**, which reads the file on the computer or from the conversation attachment and writes the `.md` files. It costs the platform nothing, nothing is uploaded before the final ZIP submission, and the reviewer reads exactly the text that will be indexed.

## Principles

- **One file per topic**, 1 to 8 KB. Never a whole PDF in a single file.
- **Sections by headings**, 200 to 2,000 characters, each one standing alone (search returns a loose excerpt).
- **Facts with a number, a unit and a date.** Do not summarize what has a precise value.
- **Front-matter in every file** with `source`, `source_date` and, if it expires, `valid_until`.
- **Never invent** what you could not read. If an excerpt is illegible, leave it out and say so.

## PDF with text

1. Read the PDF and extract the text page by page.
2. Discard headers, footers, page numbers and the table of contents.
3. Rejoin words broken by hyphens at the end of a line and paragraphs split by a page break.
4. Identify the chapters and sections from the document's headings; each chapter becomes a file (or each group of small sections).
5. Rewrite headings to carry the subject: "Deadlines" becomes "Payment deadlines of the services contract".
6. Keep numbers, acronyms and units exactly as they are. If the PDF has a version or date, use it in `source` and `source_date`.

## Scanned PDF (image)

Without a text layer there is no safe way to read it. Ask the creator for a searchable version, the original text, or to retype the main passages. **Do not reconstruct from memory.** If the creator's AI can transcribe images and the creator reviews the transcription line by line, it is acceptable, but the responsibility for fidelity is theirs.

## Web page

1. Take the main text; remove menus, ads, footers and cookie notices.
2. Keep the address in `source_url` and the access or publication date in `source_date`.
3. Preserve the page's heading structure.
4. Facts from official public pages can be used, **citing the source**. Third-party authored text (blog, course, news) must not be copied: only with permission.

## Spreadsheet

1. Understand the columns, the units and the period.
2. If the spreadsheet is a **reference table** (values, brackets, deadlines), convert it into "column: value" lists per row or into a small Markdown table per section. Example: "Bracket 1: up to R$ 5,000 | rate: 6%" (R$ is the Brazilian real, BRL).
3. If it is a **database** (thousands of rows, clients, sales), it does not go into the knowledge: knowledge holds rules and definitions, not records. Personal data never goes in.
4. Describe the meaning of each column and the units in a "How to read this table" section.

## Presentation or notes

Each slide or block of notes becomes a section with a complete heading. Turn loose phrases into sentences that make sense alone, spell out acronyms the first time, and merge slides that cover the same topic. Short bullet points without context produce weak search excerpts: add the explanation you would give when speaking.

## Structure of a converted file

A header (front-matter) followed by a level-1 heading, a short introduction and level-2 sections with the subject in the heading. End with a "What this file does not cover" section. See the `conhecimento-front-matter` template (via `get_template`).

## Final check

- Does the file have a valid `source` and `source_date`?
- Does each section have 200 to 2,000 characters and make sense alone?
- Is any personal data or third-party text without permission left in?
- Do the numbers in the file match the source? Check at least 5 values at random.
- Did the creator review the result? The conversion is their responsibility.

## Size

File up to 10 MB and at most 10,000 excerpts in the package; in practice, excellent bases have 8 to 30 files. If the material is large, start with the topics that appear most in buyers' questions.

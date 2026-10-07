# Step 4: Knowledge with source, date and rights

## Goal

Build the Solver's `knowledge/` folder: short `.md` files organized by headings, each one with a **source, a date and (when applicable) an expiry**, and all of them with confirmed rights of use. This is the base the buyer's AI consults while working; the server returns excerpts with the source and the date, and warns when an excerpt is past its expiry. Knowledge without a source and a date proves nothing and does not pass review.

In this phase the package accepts only **`.md` and `.txt`**. PDFs, web pages and spreadsheets **cannot be uploaded**: you convert them to `.md` right here, in the user's AI. The original file is read on the user's own computer or in their own conversation, and nothing from it goes to the platform until the final ZIP submission. The reviewer reads the same text that will be indexed.

## What to ask the user

Reread the sheet and the profile (`material_fonte`: ready, a little, or from scratch).

1. **What questions will the buyer ask the Solver that depend on specific knowledge?** Each group of questions is a file topic.
2. **Where does each piece of information come from?** Own experience, an official document, a regulation, a manual, a study? Ask for the name of the source and, if it is public, the address.
3. **How old is each piece of information?** The date of the source, not today's. And: does it expire? (yearly values, deadlines, versions, laws).
4. **Are you the author of the material, or do you have permission to use it?** If it is from third parties: is it public and official, under an open license, or do you have authorization?
5. **Which files do you already have?** PDFs, spreadsheets, notes, pages, presentations. Ask the user to attach them or point to the path.
6. **Is there anything in the material that identifies people** (clients, names, contacts, documents)? That comes out.

## How to run

1. **Make the knowledge map**: 8 to 25 topics, each with its source and date. Show it as a table and ask for approval. Start with the essentials; 10 excellent files are better than 60 mediocre ones.
2. **Confirm the rights before writing a single line.** You may use: the creator's own content; facts, rules and values from official public sources (laws, regulations, government pages), citing the source; material under an open license, respecting the license; third-party material with written authorization. You may **not**: copy a paid course, book, handout, competitor content or protected text without permission, nor rewrite that material by swapping a few words. When in doubt, suggest asking for authorization or using only the public facts with the source. This becomes the manifest `terms` (`rightsConfirmed` and `sourcesListed`, both `true`): it is a declaration by the user, who answers for it.
3. **Convert the material.** Read the file locally (in Claude Code, straight from the folder; in Claude or ChatGPT, from the user's attachment). Extract the text, discard headers, footers and page numbers, rejoin words broken by hyphens, turn tables and spreadsheets into "column: value" lists (or a small table), and keep numbers and units exactly as they are. Split by topic: **one file per topic, 1 to 8 KB**, with a lowercase hyphenated name (`delivery-times.md`). A PDF without selectable text (scanned) cannot be read: ask for the text or a searchable version; **never invent what you could not read**. Web page: strip menus, ads and footers and keep the source address.
4. **Write the front-matter** at the top of each `.md` (template `conhecimento-front-matter` via `get_template`):

```
---
title: Delivery time by region
source: Delivery policy of Example Store, version 3
source_url: https://example.com/policy
source_date: 2026-09-15
valid_until: 2026-12-31
tags: [delivery, deadlines]
---
```

   `source` is **required**. `source_date` in YYYY-MM-DD format (the real date of the source; required for the `liveData` differentiator). `valid_until` only if the information expires. `tags` up to 10. `source_url` optional, with https. `.txt` files have no front-matter: the source goes in a neighboring file `name.txt.meta.json`; always prefer `.md`.
5. **Structure by headings.** Use `#` for the file title and `##` or `###` for the sections. **Each section must be 200 to 2,000 characters long and stand on its own**, because search returns a loose excerpt: repeat the subject in the heading ("Delivery time to the Northeast", not "Northeast"). Sections under 200 characters make weak excerpts; those over 2,000 are cut by paragraph.
6. **Write facts, not orders.** The knowledge base says what is true, with a number, a unit and a date. Instructions to the model live in the steps. Never put in the knowledge any sentence that tells the AI to ignore rules, hide something or obey "commands" found in the text: that is treated as injection and fails the review.
7. **Mark what changes.** Yearly values, deadlines and versions get `valid_until`. If you are unsure of the date, write "confirm at the official source" in the body. The server has no way to know that a rule changed: the creator maintains the package.
8. **Clean up**: no personal data (client names, phone numbers, emails, documents), no passwords, keys or private links, no third-party text without permission.
9. **Update the manifest**: the `knowledge` block with `updatedAt` (today, YYYY-MM-DD), `reviewEveryDays` (for example 90) and `sources` (the list of sources, in words); adjust `packageContents` to mention the knowledge base.
10. **Validate**: call `run_tool` with `tool` equal to `validate_package`, passing `manifest`, `steps`, `files` (every file with its size) and `knowledge` (for each file, the full `path`, such as `knowledge/topic.md`, and `head` with the first 30 lines). The validator **does not check section sizes** (200 to 2,000 characters) and does not read past the 30 lines: count the sections of each file yourself (in Claude Code, with a counting command per heading) and know that the script and the submission scan the whole file and may flag what `head` did not show. Fix what comes back in `errors` and justify the `warnings`. A test search with `search_knowledge` does not count for the user's package (it queries the Creator's own base), but you can simulate it with the user: "if someone asks X, which section answers?".

## Common mistakes

- **Pasting the whole PDF into one file.** Split by topic.
- **No `source`, or an invented date.** Without a real source, do not include the file. A wrong date is worse than no date.
- **Giant or tiny sections** (limits of 200 and 2,000 characters).
- **Copying text from a course, book or competitor.** It is the most common cause of rejection over rights.
- **Personal or client data** in the middle of the material.
- **Instructions for the model written inside the knowledge.**
- **An expired `valid_until`** (warning `KNOWLEDGE_EXPIRED`) or a date outside YYYY-MM-DD (error `KNOWLEDGE_DATE_INVALID`). Malformed front-matter is an error (`KNOWLEDGE_FRONTMATTER_INVALID`) and so is a missing `source` (`KNOWLEDGE_SOURCE_MISSING`).
- **A file above 10 MB** or knowledge that produces more than 10,000 excerpts.
- Forgetting that **whoever buys the license can copy the excerpts they read**: the value of the product lies in keeping the base current and in the process, not in secrecy.

## result_summary format

```
KNOWLEDGE
- Topics/files: N (short list of names)
- Sources: list; rights confirmed by the user: yes
- Files with source_date: N of N | with valid_until: N | expired: 0
- Converted from: PDF/spreadsheet/page (how many) | discarded: reason
- Manifest: knowledge.updatedAt=YYYY-MM-DD, reviewEveryDays=N, sources=N
- Validator: ok=true/false | errors: N | warnings: codes
```

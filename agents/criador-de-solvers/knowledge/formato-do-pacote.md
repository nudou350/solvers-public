---
title: Solver package format (folders, ZIP and limits)
source: Solver package specification v1 (PACKAGE_SPEC), sections 3, 6 and 7, approved on 2026-09-30
source_date: 2026-09-30
valid_until: 2027-03-31
tags: [format, zip, folders, limits]
---

# Solver package format (folders, ZIP and limits)

The server validator always decides whether a package is valid. This text explains the format: the folder structure, the ZIP rules, the manifest paths, the platform phases and the accepted knowledge formats. If there is a difference, the validator wins.

## What a package is

A Solver is a folder delivered as a ZIP with a manifest, steps, knowledge, templates and test cases. The server never hands the folder to the buyer: it delivers one step at a time, searches the knowledge, keeps the memory and delivers the declared templates. The buyer uses their own AI (Claude or ChatGPT) through a connector. What sets a Solver apart from an ordinary skill is what only exists on the server: a step-by-step guided process, cited and dated knowledge, memory and creator support.

## Folder tree

Inside the ZIP there is **a single root folder** (the Solver's slug) with:

- `manifest.json`: required. Describes the Solver (field by field in another file of this knowledge base).
- `steps/`: 1 to 12 `.md` files, one step per file. Recommended: 3 to 6.
- `knowledge/`: optional. `.md` or `.txt` files in free subfolders, with source and date.
- `templates/`: optional. Templates delivered to the buyer (`.md`, `.txt`, `.json`), only those declared in the manifest's `templates[]`.
- `evals/cases/`: 10 to 40 `.json` files, one test case per file.
- `evals/outputs/` and `evals/report.json`: optional on submission. The platform generates the official report. Never make up a score.
- `README.md`: optional. A note for the reviewer; it does not reach the buyer.
- `verifier/`: platform packages only. In a new creator's submission it is an error.

## ZIP rules (current phase, the Core phase)

- ZIP size: up to 50 MB (error `ZIP_TOO_LARGE`).
- Real size once uncompressed: up to 150 MB (`ZIP_EXPANDS_TOO_MUCH`).
- Number of files: up to 2,000 (`ZIP_TOO_MANY_FILES`).
- Root: exactly 1 folder containing the `manifest.json` (`ZIP_BAD_ROOT`).
- Unique file names, ignoring case (`ZIP_DUPLICATE_ENTRY`).
- Relative paths, no `..`, no backslash, no control character, no name starting with a dot; letters and digits (including accented ones), dot, hyphen, underscore, space and the slash `/` are allowed (`ZIP_BAD_PATH`).
- System junk (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) is removed with a warning (`ZIP_IGNORED_FILE`).
- Symbolic links are rejected (`ZIP_SYMLINK`).
- Allowed extensions: `.json`, `.md` and `.txt` (`FILE_TYPE_NOT_ALLOWED`).
- Valid UTF-8 text (`FILE_NOT_UTF8`).
- Individual file: up to 10 MB (`FILE_TOO_LARGE`).
- Knowledge: up to 10,000 excerpts in the package (`KNOWLEDGE_TOO_BIG`).

Nothing in the ZIP is executed: extraction happens in an isolated folder.

## Paths written in the manifest

Every path in the manifest (`steps[].file`, `templates[].path`) must be relative, start with `steps/` or `templates/`, exist in the ZIP and stay inside the package folder. Otherwise the error is `MANIFEST_PATH_ESCAPE` (or `STEP_FILE_MISSING` and `TEMPLATE_MISSING` when the file does not exist).

## Opening phases

Today the **Core phase** applies: invited creators, knowledge in `.md` and `.txt`, templates in `.md`, `.txt` and `.json`, no creator-owned tools, no guarantee. In the **Opening phase** (no promised date) PDF, HTML and CSV in knowledge, tools over the internet (`http`), gates with evidence and platform-run evaluation come in. Do not write a package counting on the Opening phase.

## Hash and version

The platform computes a fingerprint (hash) of the package at approval, over all files, ignoring `evals/report.json`. Any file change changes the hash and requires a new review.

## Knowledge formats in this phase

`.md` is the recommended format. `.txt` becomes a single section and needs a neighboring file `name.txt.meta.json` with the source. PDFs, HTML and spreadsheets must be converted to `.md` beforehand (see the knowledge file on conversion). The server splits knowledge into excerpts by `#` to `###` headings, with a limit of about 2,000 characters per excerpt and a 200-character overlap, and searches by meaning (multilingual).

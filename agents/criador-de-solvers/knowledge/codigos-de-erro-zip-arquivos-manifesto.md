---
title: Validator error codes (ZIP, files and manifest) and how to fix them
source: Catalog of validation codes of the Solvers platform (Appendix A of the v1 specification)
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [errors, validator, zip, manifest]
---

# Validator error codes (ZIP, files and manifest) and how to fix them

Each validator response carries `code`, `path`, `message` and `fix`. An **error (E)** blocks submission. A **warning (W)** goes to the reviewer, who decides. In new-creator packages (specVersion 1), the strict rules apply.

## ZIP errors: size, root and names

- `ZIP_TOO_LARGE` (E): ZIP above 50 MB. Reduce the knowledge or split the content; `.md` text rarely comes close to the limit.
- `ZIP_EXPANDS_TOO_MUCH` (E): uncompressed content above 150 MB. Reduce the file sizes.
- `ZIP_TOO_MANY_FILES` (E): more than 2,000 files. Merge small knowledge files by topic.
- `ZIP_BAD_ROOT` (E): the ZIP does not have exactly one root folder containing `manifest.json`. Zip the **Solver folder** (not its loose contents), with everything inside a single folder.
- `ZIP_DUPLICATE_ENTRY` (E): two files with the same name (ignoring case and equivalent accents). Keep only one.
- `ZIP_BAD_PATH` (E): a path with `..`, a backslash, a control character, a name starting with a dot, or a character outside letters, digits, dot, hyphen, underscore and space. Rename it. On Windows PowerShell 5.1, `Compress-Archive` writes backslashes: use `tar -a -c -f file.zip folder` or a compression program.
- `ZIP_SYMLINK` (E): a shortcut (symbolic link) inside the ZIP. Replace it with the real file.
- `ZIP_IGNORED_FILE` (W): `__MACOSX/`, `.DS_Store`, `Thumbs.db` were ignored. Nothing to do; avoid generating them.

## File errors

- `FILE_TYPE_NOT_ALLOWED` (E): an extension or folder that is not valid in this phase (for example `.pdf`, `.html`, `.csv`, an image). Convert to `.md` or `.txt`.
- `FILE_NOT_UTF8` (E): a text file that is not valid UTF-8. Save as UTF-8 (no other encoding).
- `FILE_TOO_LARGE` (E): a file above 10 MB. Split it into smaller parts.
- `MANIFEST_PLATFORM_FORBIDDEN` (E): you used `platform` in the manifest or included the `verifier/` folder. Remove it: they are for the platform only.

## Manifest errors: format

- `MANIFEST_MISSING` (E): there is no `manifest.json` at the package root. Create one with the `manifest-esqueleto` template.
- `MANIFEST_INVALID_JSON` (E): invalid JSON (a stray comma, quotes, an unclosed key). The message says where. Use a JSON formatter.
- `MANIFEST_SCHEMA` (E): a field with the wrong type or size; the `path` says which. Examples: tagline outside 10 to 100 characters, description outside 120 to 2,000, `packageContents` with fewer than 3 or more than 8 items, an unknown category, `royaltyBps` outside 0 to 1,000. Fix the field as the message says.
- `MANIFEST_UNKNOWN_FIELD` (E): a field that does not exist in the specification. Remove it or use a supported field.
- `MANIFEST_SPEC_VERSION` (E): `"specVersion": 1` is missing. Add it.
- `TERMS_MISSING` (E): `"terms": { "rightsConfirmed": true, "sourcesListed": true }` is missing (and the user really must confirm both).

## Manifest errors: identity

- `MANIFEST_ID_OWNER` (E): the `id` or the `slug` already belongs to another creator. On the first version, remove the `id`; change the slug to a name of your own.
- `MANIFEST_SLUG_RESERVED` (E): a reserved slug (brand and platform names). Choose another.
- `MANIFEST_SLUG_LOOKS_LIKE_ID` (E): a slug with 32 letters and digits, like an `id`. Use words separated by hyphens.
- `MANIFEST_NAME_TOO_LONG` (E): a name over 32 bytes. Shorten it (accented letters count more).
- `MANIFEST_VERSION_TOO_LONG` (E): a version over 16 bytes. Use something like `1.0.0`.
- `MANIFEST_VERSION_NOT_GREATER` (E): the submitted version is not greater than the published one. Raise the number.
- `MANIFEST_VERSIONS_MISSING` (E): an entry in `versions[]` for the current version is missing. Add `{ version, releasedAt, notes }`.

## Manifest errors: phase rules

- `MANIFEST_CATEGORY_FORBIDDEN` (E): a category not accepted from new creators (Finance, Legal, health). Narrow the scope to an allowed category or wait for those categories to open. Do not hide the topic by switching the category: the reviewer reads the content.
- `MANIFEST_GUARANTEE_FORBIDDEN` (E): `guarantee.available: true`. Use `{ "available": false, "defaultCriteria": [] }`.
- `MANIFEST_PRICE_BELOW_MIN` (E): a price below the platform minimum (today 5). Use the minimum or more.
- `MANIFEST_PATH_ESCAPE` (E): a manifest path that leaves the folder or does not start with `steps/` or `templates/`. Use `steps/01-name.md`.
- `DIFF_ENDPOINT_CHANGED_MINOR` (E): in an update you changed `tools`, `onboarding`, `requirements` or the structure of `steps` without raising the MAJOR version. Raise it (e.g. 1.4.2 to 2.0.0).

## Manifest warnings

- `MANIFEST_DIFFERENTIATOR_UNPROVEN` (W): you declared a differentiator that the validator cannot prove. Meet the condition (see the differentiators knowledge file) or remove it from the field.
- `MANIFEST_DIFFERENTIATORS_FEW` (W): fewer than 2 proven. The reviewer only approves with 2 or more.
- `SUPPLY_WITH_TRIAL` (W): a license cap with the free trial turned on: the trial does not consume a slot. For real exclusivity, turn the trial off.
- `CATALOG_ONLY_IGNORED` (W): `catalogOnly` has no effect. Remove it.
- `CONTENTS_MISMATCH` (W): `packageContents` promises something the package does not have (templates, a tool, a guarantee, memory, a knowledge base). Adjust the list to reality.

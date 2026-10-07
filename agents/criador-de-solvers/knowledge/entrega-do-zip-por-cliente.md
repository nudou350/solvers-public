---
title: ZIP delivery by client: Claude Code, Claude or ChatGPT with files, and without files
source: Solver package specification v1 (PACKAGE_SPEC), sections 19.3 and 3.2
source_date: 2026-10-02
valid_until: 2027-03-31
tags: [zip, delivery, claude-code, chatgpt, step-by-step]
---

# ZIP delivery by client: Claude Code, Claude or ChatGPT with files, and without files

What the ZIP must have, in any client: **a single root folder** (the slug) with `manifest.json` inside; only `.json`, `.md` and `.txt` files; names that do not start with a dot; no system folders. Submission is through the site, which validates again on the server.

## Choosing the path

- Profile `onde_roda` = Claude Code: write the folder to disk and build the ZIP with a command.
- Claude or ChatGPT with file generation (data analysis, code environment): build the ZIP and offer the download.
- Without file generation: deliver the files in blocks and guide the user to assemble the folder and zip it.

## Claude Code

You write the folder straight into the working directory: `my-solver/manifest.json`, `my-solver/steps/01-...md` and so on, updating the files at each step of the Creator. At the end, build the ZIP by **zipping the folder**:

- macOS or Linux: `zip -r my-solver.zip my-solver -x "*.DS_Store"`
- Windows 10 or 11: `tar -a -c -f my-solver.zip my-solver`

Warning on Windows: `Compress-Archive` from Windows PowerShell 5.1 writes backslashes in the paths and leads to the `ZIP_BAD_PATH` error. Prefer the `tar` above, PowerShell 7 or a compression program.

To check the contents: `unzip -l my-solver.zip` (or `tar -tf my-solver.zip`). Every line must start with `my-solver/`. If the team's validation script exists (`solvers validate <folder or ZIP>`), run it on the ZIP.

## Claude or ChatGPT with file generation

Write the files in a code environment and build the ZIP with forward slashes in the internal paths. Python example, for a folder already written:

```
import zipfile, pathlib
root = pathlib.Path("my-solver")
with zipfile.ZipFile("my-solver.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob("*")):
        if p.is_file() and not p.name.startswith("."):
            z.write(p, p.as_posix())
```

If the files exist only as text in the conversation, create each one with `z.writestr("my-solver/manifest.json", content)`. Then offer the link to download `my-solver.zip` and list the ZIP contents for the user to check.

## Without file generation

1. Deliver **one block per file**, with the full path as the title (for example, `my-solver/steps/01-name.md`), in order: manifest.json, steps/, knowledge/, templates/, evals/cases/, README.md.
2. Step by step for the user:
   - Create a folder named after the slug.
   - Inside it, create the subfolders `steps`, `knowledge`, `templates` and `evals/cases`.
   - Paste the content of each block into the file with the same name (save as UTF-8, using a plain text editor; avoid editors that change quotes and dashes).
   - Zip **the whole folder**: on Windows, right-click, "Send to" and "Compressed (zipped) folder"; on macOS, right-click, "Compress".
   - Open the ZIP and check that a single folder appears with the manifest.json inside.
3. On macOS, Finder creates the `__MACOSX` folder: it is removed with a warning (`ZIP_IGNORED_FILE`) and does not block submission.

## Common mistakes when assembling

- Zipping the folder's **contents** instead of the folder: the ZIP has no single root (`ZIP_BAD_ROOT`).
- Two folders at the root (for example, the Solver folder and a "drafts" folder): root error.
- A file whose name starts with a dot, or has a strange character: `ZIP_BAD_PATH`.
- An editor that saves in another encoding: `FILE_NOT_UTF8`.
- Extensions such as `.docx`, `.pdf`, `.png` inside the package: `FILE_TYPE_NOT_ALLOWED`.
- Backslashes inside the ZIP (old PowerShell): `ZIP_BAD_PATH`.

## Submission

On the site, the creator area (`/creator/publish`) receives the ZIP: the server validates again and shows the errors, if any. Then a team member reviews the package within 5 business days. The Solver only appears on the storefront after approval and after the creator confirms the publication.

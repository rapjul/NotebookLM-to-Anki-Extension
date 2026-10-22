---
name: update-anki-templates
description: Synchronize NotebookLM card templates (Front, Back, and Styles) from the repository to Anki via AnkiConnect while safely preserving external user/addon code (e.g. AJT Japanese). Use when updating card templates, reviewing template diffs, pushing style updates to Anki, or troubleshooting AnkiConnect editor conflicts.
---

# Update Anki Card Templates

This skill guides AI agents through inspecting, diffing, and synchronizing local card templates ([`front.html`](../../../src/anki_templates/front.html), [`back.html`](../../../src/anki_templates/back.html), and [`styling.css`](../../../src/anki_templates/styling.css)) to the **`NotebookLM Quiz`** card type in Anki using the repository CLI tool ([`./scripts/update_card_templates.py`](../../../scripts/update_card_templates.py)).

---

## When to Use This Skill

Activate this skill whenever:
- User asks to "update card templates", "sync styles to Anki", "push template changes", or "update Anki card type".
- Modifying HTML or CSS templates under [`./src/anki_templates/`](../../../src/anki_templates/).
- Inspecting template drift between Anki and the repository via unified diff.
- Troubleshooting AnkiConnect `editorConflict` errors (`Close the affected editor before this API write`).

---

## Prerequisites

1. **Anki Desktop Running:** Anki Desktop must be running with the `AnkiConnect` add-on active on `http://127.0.0.1:8765`.
2. **The "Single Main Window" Rule:** All secondary windows with an editor pane (Browse, Add, Edit Current, Cards... dialog) **must be closed** before writing updates to Anki. Only the single main Anki window (Decks list or Study screen) should remain open.

---

## Quick Reference CLI Commands

All commands are executed from the repository root:

```bash
# 1. Preview unified diff against live Anki collection
python3 ./scripts/update_card_templates.py diff

# 2. Preview push in dry-run mode without modifying Anki
python3 ./scripts/update_card_templates.py push -n

# 3. Synchronize local templates to Anki (creates automatic backup)
python3 ./scripts/update_card_templates.py push

# 4. Check delimiter status and external code detection
python3 ./scripts/update_card_templates.py status

# 5. Pull template edits made inside Anki back into the repository
python3 ./scripts/update_card_templates.py pull
```

---

## Step-by-Step Runbook

### Step 1: Pre-flight & Diff Inspection
Before pushing changes, inspect the unified diff to verify that your modifications are clean and that external code blocks are recognized:

```bash
python3 ./scripts/update_card_templates.py diff
```
Verify that:
- Addon template modifications appear strictly between the boundary comments:
  - HTML: `<!-- -------------------- NotebookLM Template: Start -------------------- -->` and `<!-- -------------------- NotebookLM Template: End -------------------- -->`
  - CSS: `/* -------------------- NotebookLM Template: Start -------------------- */` and `/* -------------------- NotebookLM Template: End -------------------- */`
- Any external scripts (e.g. `<script>/* AJT Japanese JS ... */</script>`) or stylesheets (`@import url("_ajt_japanese.css");`) remain intact outside the delimiters.

### Step 2: Push Updates to Anki
Execute the synchronization push:

```bash
python3 ./scripts/update_card_templates.py push
```
The script will:
1. Verify AnkiConnect connectivity (or offer to auto-launch Anki).
2. Create an automated snapshot in `./backups/templates/<model>_<timestamp>/`.
3. Splicing-merge the updated templates with external code.
4. Dispatch `updateModelTemplates` and `updateModelStyling` to AnkiConnect.

### Step 3: Handle Editor Conflicts Gracefully
If AnkiConnect returns the following error:
```text
❌ Error executing 'push': AnkiConnect error: Close the affected editor before this API write, even if its content is saved.
```
**Cause:** The **Browse** window (`Cmd+B`), **Add** window (`A`), or **Cards...** dialog is open in Anki.
**Resolution:**
1. Switch to Anki Desktop and close any open secondary windows.
2. In the terminal, press `Enter` at the interactive retry prompt:
   ```text
   Press Enter once closed to retry (or 'q' to cancel): 
   ```
3. The script will automatically re-attempt the update and succeed.

### Step 4: Verification
Confirm that the update applied cleanly and that templates are in sync:

```bash
python3 ./scripts/update_card_templates.py diff
```
*Expected output:* `In sync (no changes).`

Run both test suites to ensure no regressions:
```bash
# Python CLI and template updater tests
python3 -m unittest discover -s ./tests/unit -p "test_update_templates.py"

# Node.js extension and template integrity tests
npm test
```

---

## Critical Safety Guidelines

1. **Never Overwrite External Code:** Always maintain boundary delimiters so third-party add-ons like `AJT Japanese` are preserved.
2. **Never Commit Backups:** Template dumps under `./backups/` are ignored via `.gitignore` and must never be committed.
3. **No Unescaped Double Curly Braces:** Do not write raw `{{` or `}}` inside `<script>` or comments in `front.html`/`back.html` unless referencing real Anki field replacements, to prevent Anki template engine compilation failures.

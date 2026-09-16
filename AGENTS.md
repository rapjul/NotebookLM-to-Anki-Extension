# Agent Guide: NotebookLM to Anki Extension

This document provides a comprehensive guide for AI agents and developers working on the **NotebookLM to Anki Extension** codebase. It outlines the architecture, recent major features, code style standards, and developer guidelines.

---

## 📁 Repository Structure & Architecture

The project consists of a Chrome Extension (Manifest V3) that interfaces with the desktop application **Anki** via the **AnkiConnect** API.

```mermaid
graph TD
    NotebookLM[NotebookLM Webpage] <-->|Injected scripts & UI| ContentJS[content.js]
    ContentJS <-->|Runtime Messages| BackgroundJS[background.js]
    BackgroundJS <-->|REST API / HTTP| AnkiConnect[AnkiConnect Port 8765]
    AnkiConnect <-->|Controls| Anki[Anki Desktop app]
```

### 1. Chrome Extension Core (located under `./src/`)

- [manifest.json](./src/manifest.json): Configuration, permissions (`storage`, `scripting`), host permissions, and web-accessible resources.
- [background.js](./src/background.js): Service worker that handles asynchronous interactions with AnkiConnect (connection checks, deck queries, creating/deleting decks, exporting notes, and counting skipped duplicates).
- [content.js](./src/content.js): Content script injected into NotebookLM pages. It extracts the raw quiz JSON from the page (`data-app-data`), formats deck titles, manages the export workflow, and handles UI events.
- [utils.js](./src/utils.js): Shared pure utilities for HTML decoding, title sanitization, deck template substitution, error formatting, 15-field card mapping, and note deduplication.
- [button.html](./src/button.html): HTML template for the injected "Anki Export" button.
- [modal.html](./src/modal.html): HTML structure for the duplicate deck conflict resolution overlay.
- [modal.css](./src/modal.css): Stylesheet containing design tokens, animations, and layouts for the injected extension buttons and overlays.
- [popup.html](./src/popup.html) / [popup.js](./src/popup.js): Extension configuration popup.

### 2. Anki Card Templates

Located under `./src/anki_templates/` directory. These govern how the exported notes look and behave inside Anki:

- [front.html](./src/anki_templates/front.html): Frontend logic for rendering options, supporting LaTeX equations, and triggering auto-flip actions.
- [back.html](./src/anki_templates/back.html): Backend logic for grading choices, displaying rationales for all options, rendering colored state overrides, and injecting auto-grading elements.
- [styling.css](./src/anki_templates/styling.css): Shared styling rules for card appearance, dark theme support, fonts, option states, and buttons.

### 3. Automated Testing & Static Fixtures (located under `./tests/`)

The test suite uses Node.js 24's native test runner (`node:test` and `node:assert/strict`) with zero external runtime dependencies.

- [helpers/utils.js](./tests/helpers/utils.js): ES module adapter re-exporting shared utilities from `src/utils.js`.
- [fixtures/standard-quiz.json](./tests/fixtures/standard-quiz.json): Sanitized academic quiz fixtures covering basic chemistry and astronomy.
- [fixtures/math-physics-quiz.json](./tests/fixtures/math-physics-quiz.json): Mathematical formulas verifying LaTeX rendering across algebra, geometry, trigonometry, calculus, and quantum physics.
- [fixtures/edge-cases-quiz.json](./tests/fixtures/edge-cases-quiz.json): Edge-case payloads covering HTML entity escaping, missing optional hints, partial option sets, and nested query structures.
- [fixtures/raw-app-data.json](./tests/fixtures/raw-app-data.json): Synthetic payload simulating raw and HTML-escaped DOM data attributes.
- [unit/formatter.test.js](./tests/unit/formatter.test.js): Unit tests for HTML entity decoding, title normalization, deck templates, and error message formatting.
- [unit/transformer.test.js](./tests/unit/transformer.test.js): Unit tests for JSON extraction, 4-option card normalization, LaTeX preservation, and 15-field Anki payload mapping.
- [unit/deduplication.test.js](./tests/unit/deduplication.test.js): Unit tests for question text normalization, duplicate note filtering, and skipped duplicate counts.
- [unit/templates.test.js](./tests/unit/templates.test.js): Structural integrity tests verifying card HTML templates, CSS selectors, and extension manifest validity.
- [integration/anki-connect.test.js](./tests/integration/anki-connect.test.js): Contract integration tests with mocked network calls verifying AnkiConnect status checks, model creation, and batch export flows (`merge`, `overwrite`, `increment`).

---

## 🚀 Key Features & Implementation Logic

### 1. Smart Duplicate Deck Handling & Modal Overlay

When exporting a deck that already exists in Anki, the extension displays an overlay modal asking the user how they would like to resolve the conflict:

- **Merge (Skip Duplicates):** Appends only new cards. Existing identical cards are skipped.
- **Auto-Increment:** Appends `(1)` (or incremental indices) to the deck name (e.g. `...Quiz | Topics (1)`).
- **Overwrite:** Completely deletes the existing deck in Anki and recreates it.
- _Note:_ Pre-flight connection checks ensure AnkiConnect is online before running the export.

### 2. Clean HTML/CSS Separation

To avoid cluttering `content.js` with stringified HTML templates and inline styles:

- HTML structures are separated into dedicated files ([button.html](./button.html)).
- All UI styles are defined in [modal.css](./modal.css).
- The script fetches the templates using `chrome.runtime.getURL()` and manages states via CSS classes (e.g. `.notebooklm-to-anki-btn-success`) instead of direct DOM manipulation.

### 3. Auto-Flip and Auto-Grading Cards

Multiple-choice cards automatically evaluate user answers and advance:

1.  **Selection (Front):** Clicking an option registers the choice (selected text and correct/incorrect flag) into `sessionStorage` and immediately flips the card using Anki's programmatic commands (`pycmd("ans")`, `showAnswer()`, or keyboard dispatch fallback).
2.  **Grading (Back):**
    - The correct option is always highlighted green (`.state-correct`).
    - If the user clicked a wrong option, it is highlighted red (`.state-wrong`), and the correct option shows a "Right answer" status header.
    - All non-selected/neutral options are slightly faded (`.state-dimmed`) but remain readable.
    - A dynamic **"Continue (Mark Correct)"** or **"Continue (Mark Incorrect)"** button is injected on the back to auto-submit grades (`ease3` for Good, `ease1` for Again) and advance instantly. Standard manual grading controls remain active.

---

## 🛠️ Code Conventions & Guidelines

When implementing changes, future agents **must** adhere to the following rules:

1.  **Code Comments & Documentation:**
    - Comment every function, method, parameter, and type.
    - Write JSDoc-formatted comments for all functions in JavaScript files.
2.  **No Direct Git Commits:**
    - Do not commit changes to Git unless explicitly requested by the user.
3.  **Modern CSS Guidelines:**
    - Maintain style hierarchy and prevent specificity collision (avoid nested overrides that trigger descending specificity selector warnings).
    - Prefer CSS variables / custom design tokens for themes.
4.  **Linter & Error Safety:**
    - Do not leave unused variables or parameter blocks in catch clauses.
    - Use modern JavaScript APIs (e.g., standard fetch, async/await patterns, optional chaining).
5.  **Automated Testing & Privacy:**
    - Run the test suite using `npm test`, `npm run test:watch`, or `npm run test:coverage`.
    - Ensure all committed test fixtures are sanitized and generic (basic chemistry, astronomy, algebra, geometry, trigonometry, calculus, physics) with zero personal or identifying information.
    - Maintain pure business logic in [`./src/utils.js`](./src/utils.js) without test-only backdoor branches in production code.

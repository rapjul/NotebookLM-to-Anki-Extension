---
status: draft
date: 2026-09-21
decision-makers: [rapjul]
---

# Adopt Multi-Browser Manifest V3 Staging Pipeline

## Context and Problem Statement

The extension targets both Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Opera) and Mozilla Firefox using Manifest V3 (MV3). However, browser vendors exhibit divergent specifications for background execution in MV3:
- **Chromium MV3** requires an extension service worker via `"background": { "service_worker": "background.js" }` and rejects `"background.scripts"`.
- **Mozilla Firefox Gecko MV3** requires background event pages via `"background": { "scripts": ["background.js"] }` and ignores `"background.service_worker"` (emitting `BACKGROUND_SERVICE_WORKER_IGNORED` warnings in `web-ext lint`).

Attempting to include both keys simultaneously in a single `./src/manifest.json` violates Chrome Web Store guidelines and fails Mozilla validation checks. How should the extension manage cross-browser manifest compatibility without maintaining duplicated, out-of-sync source manifests?

## Decision Drivers

- **Specification Compliance**: The manifest distributed to each store must comply strictly with that browser's MV3 schema without invalid or unsupported properties.
- **Single Source of Truth**: Core permissions, content scripts, and metadata must reside in a single canonical file (`./src/manifest.json`).
- **Zero Linter Warnings**: Development linting (`npm run lint`) and release packaging (`npm run build`) must pass with 0 errors and 0 warnings.
- **Automation**: Browser-specific packaging must occur automatically during build scripts without manual file copying.

## Considered Options

- **Option 1: Hybrid Universal Manifest** - Maintain both `service_worker` and `scripts` in `./src/manifest.json`.
- **Option 2: Dual Maintained Manifests** - Maintain separate `src/manifest.chrome.json` and `src/manifest.firefox.json` files in version control.
- **Option 3: Chromium-First Source Manifest with Automated Gecko Staging** (Chosen) - Keep `./src/manifest.json` strictly compliant with Chromium MV3, and use `./scripts/build.js` and `./scripts/lint.js` to stage the Firefox adaptation dynamically before linting and packaging.

## Decision Outcome

Chosen option: **Option 3**, because it preserves `./src/manifest.json` as the single canonical source of truth while ensuring that both Chromium and Gecko builds strictly satisfy their respective platform validators with zero warnings.

### Consequences

- **Good**: Eliminates invalid `background.scripts` key from Chrome builds, preventing Chrome Web Store submission warnings.
- **Good**: Eliminates `BACKGROUND_SERVICE_WORKER_IGNORED` warnings from Mozilla's `web-ext lint` by staging the Gecko event page definition during lint and build runs.
- **Good**: Developers only need to edit one source manifest file (`./src/manifest.json`) when adding permissions or updating icons.
- **Bad**: Firefox testing requires staging through `./scripts/lint.js` or `./scripts/build.js` rather than pointing Mozilla tools directly at the raw `./src` directory.
- **Neutral**: Release builder generates both `dist/notebooklm-to-anki-v4.1.0-chrome.zip` and `dist/notebooklm-to-anki-v4.1.0-firefox.zip` in one automated step.

### Confirmation

Automated tests in `./tests/unit/templates.test.js` verify that `./src/manifest.json` defines `background.service_worker` and omits `background.scripts`. Build execution (`npm run build`) and lint execution (`npm run lint`) verify 0 errors and 0 warnings.

## Pros and Cons of the Options

### Option 1: Hybrid Universal Manifest

- Good: No staging transformations required.
- Bad: Chrome Web Store review flags unsupported `background.scripts` array.
- Bad: Mozilla `web-ext lint` flags `BACKGROUND_SERVICE_WORKER_IGNORED`.

### Option 2: Dual Maintained Manifests

- Good: Clear separation per platform.
- Bad: Prone to configuration drift when updating permissions, version numbers, content scripts, or web-accessible resources.

### Option 3: Chromium-First Source Manifest with Automated Gecko Staging

- Good: Enforces single source of truth for all shared extension metadata.
- Good: Generates clean, zero-warning release packages for both browser ecosystems.

---
status: draft
date: 2026-09-21
decision-makers: [rapjul]
---

# Use DOM Image Resolution and WebP Serialization for Lazy-Loaded Media

## Context and Problem Statement

Google NotebookLM dynamically generates quizzes that contain diagrammatic schematics, charts, and mathematical figures. In many cases, these images are lazy-loaded into the page DOM or bound to authenticated Google user-content sessions and transient `blob:` URLs. Because desktop Anki runs on `localhost:8765` outside of the browser, its AnkiConnect background daemon cannot access Chrome session cookies or resolve browser-internal `blob:` URLs when fetching remote media. Furthermore, when unrendered questions are scrolled out of view, their raw media URLs may not be readily exposed in top-level JSON structures. How can the extension reliably extract, serialize, and export diagrams to Anki without causing memory exhaustion, duplicate assignments, or corrupting cards?

## Decision Drivers

- **Extraction Fidelity**: Diagrams must be captured even when referenced via `blob:` URLs, authenticated endpoints, or lazy-loaded containers.
- **Payload & Memory Safety**: Serialization must not exhaust browser memory, freeze the page UI thread, or exceed extension message IPC limits.
- **Collision Avoidance**: Unique 1-to-1 matching must prevent single lazy-loaded images from being assigned to multiple distinct quiz cards that cite the same source document.
- **Cross-Platform Compatibility**: Media formats must render natively across all Anki distributions (Anki Desktop, AnkiMobile on iOS, AnkiDroid on Android, and AnkiWeb).

## Considered Options

- **Option 1: Background Direct Fetching Only** - Pass remote URLs directly to AnkiConnect's `storeMediaFile` action via `url` parameter.
- **Option 2: Unbounded Off-Screen Canvas PNG Serialization** - Re-render all matched DOM images onto an off-screen canvas at raw natural dimensions as lossless PNG.
- **Option 3: Bounded 2048px Off-Screen Canvas with WebP Encoding and 1-to-1 DOM Matching** (Chosen) - Match rendered `<img>` elements to cards using local container captions and alt text, enforce unique 1-to-1 assignment, downscale images exceeding `2048px`, serialize using `image/webp` (quality 0.85) with automatic PNG fallback, and persist Base64 directly via `storeMediaFile`.

## Decision Outcome

Chosen option: **Option 3**, because it guarantees that diagrams render properly regardless of origin restrictions, eliminates cross-card image collisions, and maintains a lightweight memory footprint across browser messaging ports.

### Consequences

- **Good**: Supports `blob:`, authenticated Google CDN, and lazy-loaded diagrams without requiring user cookie synchronization with desktop Anki.
- **Good**: WebP compression achieves 25%–35% smaller file sizes than JPEG while preserving full alpha transparency on schematics, circuit plots, and equations.
- **Good**: Bounding dimensions to `2048px` (2K resolution) maintains pin-sharp clarity on Retina displays while capping memory usage.
- **Good**: Enforcing strict 1-to-1 DOM image matching prevents cards citing the same document from mistakenly receiving the same active diagram.
- **Bad**: Encoding off-screen canvas elements incurs minor CPU overhead on the content script thread during export.
- **Neutral**: If a card's diagram has not been rendered into the DOM due to aggressive lazy loading, the card remains unassigned and the user is guided to navigate to that question in NotebookLM and re-export.

### Confirmation

Automated unit tests in `./tests/unit/transformer.test.js` verify that `resolveCardsWithDomImages` enforces 1-to-1 matching without cross-card contamination, and `./tests/unit/content.test.js` verifies that `extractDomImageBase64` downscales oversized inputs to `2048px` and serializes to WebP.

## Pros and Cons of the Options

### Option 1: Background Direct Fetching Only

- Good: Zero content script canvas processing overhead.
- Bad: Completely fails for `blob:` URLs and authenticated Google user content because Anki desktop cannot authenticate browser sessions.
- Bad: Fails when image URLs are omitted from raw JSON attributes.

### Option 2: Unbounded Off-Screen Canvas PNG Serialization

- Good: Captures rendered DOM imagery without authentication requirements.
- Bad: Full-resolution camera uploads and high-density textbook scans generate 15MB–40MB+ Base64 strings.
- Bad: Multiple large PNG strings cause tab freezing, IPC message transmission failures, and high risk of out-of-memory crashes.

### Option 3: Bounded 2048px Off-Screen Canvas with WebP Encoding and 1-to-1 DOM Matching

- Good: Keeps Base64 payloads compact (typically 300KB–800KB).
- Good: Universal rendering support across Anki Desktop (Qt 6 WebEngine), AnkiMobile (iOS 15+ `WKWebView`), AnkiDroid (Android `WebView`), and AnkiWeb.
- Good: Clean fallback to `image/png` if WebP canvas export is unsupported in a specific runtime.

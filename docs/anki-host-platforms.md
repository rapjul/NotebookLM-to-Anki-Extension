# Anki Host Platform Bridge Specifications & Device Audit Guide

This document defines the host platform environments, JavaScript bridge APIs, card flip mechanisms, grading dispatches, mobile tap quirks, and platform detection signals across the four target Anki distributions supported by the NotebookLM to Anki card templates (`./src/anki_templates/front.html` and `./src/anki_templates/back.html`).

---

## 1. Cross-Platform Architectural Matrix

| Platform | Web Engine | Bridge Communication Interfaces | Answer Flip Triggers | Grading Dispatches | Tap / Interaction Quirks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Anki Desktop** | Qt 6 WebEngine (`Chromium`) | `pycmd(cmd)`, `bridgeCommand(cmd)` | `pycmd("ans")` | `bridgeCommand("ease3")` / `pycmd("ease3")`, `bridgeCommand("ease1")` / `pycmd("ease1")` | Standard mouse and keyboard events; in-card continue buttons rendered |
| **AnkiMobile (iOS - iPhone)** | Apple `WebKit` (`WKWebView`) | `window.webkit.messageHandlers.cb.postMessage(...)`, `window.webkit.messageHandlers.bridgeCommand.postMessage(...)`, `window.sendMessage2(...)` | `window.webkit.messageHandlers.cb.postMessage(JSON.stringify({ scheme: "ankitap", msg: "midCenter" }))` | Native bottom bar actions; fallback `ankitap` `midRight` (Good) / `midLeft` (Again) | Native host taps advance cards; requires `.tappable` and `touchstart`/`touchend` stopPropagation to prevent premature flip |
| **AnkiMobile (iPadOS + Keyboard)** | Apple `WebKit` (`WKWebView`) | Same as AnkiMobile iOS | Same as AnkiMobile iOS | Same as AnkiMobile iOS; supports physical keyboard shortcuts (`1`, `3`, `Space`) | Desktop-class Safari user agent (`MacIntel`), `navigator.maxTouchPoints > 1`; dynamic pointer detection (`pointer: fine`) |
| **AnkiDroid (Android)** | Android System `WebView` (`Chromium`) | Direct `window` globals: `showAnswer()`, `ankiAnswerEase1()`, `ankiAnswerEase3()`, or `window.AnkiDroidJS` | `showAnswer()` or `AnkiDroidJS.showAnswer()` | `ankiAnswerEase3()` (Good) / `ankiAnswerEase1()` (Again), or `AnkiDroidJS` | Mobile touch gestures; in-card continue buttons omitted to prioritize native navigation buttons |

---

## 2. Detailed Platform Specifications

### 2.1 Anki Desktop

- **Runtime Environment:** Anki 2.1.50+ on macOS, Windows, and Linux utilizes Qt 6 WebEngine based on Chromium.
- **Bridge Globals:**
  - `pycmd(command: string): void`: Legacy Python IPC bridge injected by Anki's `reviewer.py`.
  - `bridgeCommand(command: string): void`: Modern Anki Desktop / Webview bridge function.
- **Card Flip Execution:**
  - Dispatches `pycmd("ans")` to transition from Front to Back.
  - Fallback simulated `KeyboardEvent` (`Enter` / key code 13) for preview panes.
- **Grading Execution:**
  - Dispatches `bridgeCommand("ease3")` (or `pycmd("ease3")`) for correct answers ("Good").
  - Dispatches `bridgeCommand("ease1")` (or `pycmd("ease1")`) for incorrect or skipped answers ("Again").
- **UI Gating & Detection:**
  - `isMobilePlatform()` returns `false`.
  - In-card continue and self-grading action buttons (`.continue-btn`, `.self-grade-container`) are rendered with keyboard shortcut badges (`[Space / 3]`, `[1]`).
- **Verification Status:**
  - `pycmd("ans")`: **Verified** via Anki Desktop manual and `ankitects/anki` reviewer implementation.
  - `bridgeCommand("ease3")` / `bridgeCommand("ease1")`: **Verified** via Anki Desktop Webview bridge API.
- **Primary Sources:**
  - Anki Manual — Card Templates & Javascript: `https://docs.ankiweb.net/templates/styling.html#javascript` (Accessed: 2026-10-25).
  - Anki Core Repository (`ankitects/anki`): `https://github.com/ankitects/anki` (Accessed: 2026-10-25).

---

### 2.2 AnkiMobile (iOS - iPhone)

- **Runtime Environment:** AnkiMobile executes inside iOS `WKWebView` with persistent webview instances across sequential review cards.
- **Bridge Globals:**
  - `window.webkit.messageHandlers.cb`: WebKit callback message handler bridge for gesture emulation.
  - `window.webkit.messageHandlers.bridgeCommand`: Modern direct bridge command handler.
  - `window.anki`: Flag indicating native AnkiMobile host container.
  - `window.sendMessage2(scheme: string, msg: string)`: Legacy bridging function.
- **Card Flip Execution:**
  - Sends payload `{"scheme": "ankitap", "msg": "midCenter"}` to `window.webkit.messageHandlers.cb`.
- **Grading Execution:**
  - Primary path relies on AnkiMobile's native bottom grading bar.
  - Programmatic fallback dispatches `ankitap` gesture messages: `"midRight"` (Ease 3 / Good) or `"midLeft"` (Ease 1 / Again).
- **Touch Interception & Tap Safety:**
  - AnkiMobile natively intercepts touch events on the card to trigger "Show Answer".
  - To prevent accidental flips when tapping option buttons, checkboxes, inputs, or diagram thumbnails, custom interactive elements must be assigned the `.tappable` CSS class and call `e.stopPropagation()` on `touchstart` / `touchend`.
  - Background taps on whitespace outside interactive controls are permitted on Back to let users grade natively.
- **UI Gating & Detection:**
  - `isMobilePlatform()` evaluates `true` via `document.documentElement.classList.contains("mobile" | "iphone" | "ios")` or mobile user agents.
  - In-card continue buttons are suppressed on mobile so users interact with the native bottom bar.
- **Verification Status:**
  - `WKWebView` persistent lifecycle and listener leaks: **Verified** via AnkiMobile documentation and template issue reports.
  - `.tappable` class requirement for touch pass-through: **Verified** via AnkiMobile manual.
  - `ankitap` gesture message schema (`midCenter`, `midRight`, `midLeft`): **Unverified (inferred from template code)**.
- **Primary Sources:**
  - AnkiMobile Manual — Customizing Card Layout: `https://docs.ankimobile.net/more-custom-templates.html` (Accessed: 2026-10-25).
  - Apple Developer Documentation — `WKScriptMessageHandler`: `https://developer.apple.com/documentation/webkit/wkscriptmessagehandler` (Accessed: 2026-10-25).

---

### 2.3 AnkiMobile (iPadOS + External Keyboard / Trackpad)

- **Runtime Environment:** iPadOS executes desktop-class `WKWebView` with Retina scaling and hardware pointer support.
- **Platform Detection Idiosyncrasies:**
  - iPadOS Safari and `WKWebView` report `navigator.platform === "MacIntel"` and emit a desktop Macintosh user agent (`Macintosh; Intel Mac OS X ...`).
  - To differentiate iPadOS touch devices from genuine macOS desktops, templates inspect:
    `navigator.maxTouchPoints > 1 && (navigator.platform === "MacIntel" || /Macintosh/i.test(navigator.userAgent))`
- **Dynamic Keyboard Hint Discovery:**
  - Detects hardware keyboards via `window.matchMedia("(pointer: fine)").matches` (Magic Keyboard / trackpad) or session storage keys recorded on first `keydown` event (`notebooklm_has_keyboard`).
  - Automatically updates labels on buttons to include `[Space / 3]` and `[1]` when an external keyboard is connected.
- **Verification Status:**
  - Desktop-class Safari user agent on iPadOS: **Verified** via Apple WebKit documentation.
  - `maxTouchPoints > 1` touch detection: **Verified** via W3C Pointer Events Level 2 specification.
  - `matchMedia("(pointer: fine)")` dynamic detection: **Verified** via CSS Media Queries Level 4.
- **Primary Sources:**
  - WebKit Blog — Desktop-Class Browsing on iPad: `https://webkit.org/blog/9122/desktop-class-browsing-on-ipad/` (Accessed: 2026-10-25).
  - MDN Web Docs — `Navigator.maxTouchPoints`: `https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints` (Accessed: 2026-10-25).

---

### 2.4 AnkiDroid (Android)

- **Runtime Environment:** AnkiDroid runs within an Android system `WebView` (Chromium-based engine).
- **Bridge Globals:**
  - Direct global functions: `showAnswer(): void`, `ankiAnswerEase1(): void`, `ankiAnswerEase3(): void`.
  - Legacy button callbacks: `buttonAnswerEase1(): void`, `buttonAnswerEase3(): void`.
  - Object bridge: `window.AnkiDroidJS` exposing `showAnswer()` and `ankiAnswerEase*(ease: number)`.
- **Card Flip Execution:**
  - Calls `showAnswer()` or `AnkiDroidJS.showAnswer()`.
- **Grading Execution:**
  - Calls `ankiAnswerEase3()` / `buttonAnswerEase3()` for Good.
  - Calls `ankiAnswerEase1()` / `buttonAnswerEase1()` for Again.
- **UI Gating & Detection:**
  - Detected via `typeof AnkiDroidJS !== "undefined"`, presence of `ankiAnswerEase1`, or `android` class on root/body.
- **Verification Status:**
  - `AnkiDroidJS` object API: **Verified** via AnkiDroid GitHub documentation.
  - Direct global functions (`showAnswer`, `ankiAnswerEase3`): **Verified** via AnkiDroid `Reviewer.kt` / `AbstractFlashcardViewer.java`.
- **Primary Sources:**
  - AnkiDroid Wiki — Javascript API: `https://github.com/ankidroid/Anki-Android/wiki/Javascript-API` (Accessed: 2026-10-25).
  - AnkiDroid Source Repository (`ankidroid/Anki-Android`): `https://github.com/ankidroid/Anki-Android` (Accessed: 2026-10-25).

---

## 3. Manual Device Verification Checklists

When making template changes that affect bridge dispatch, gesture handling, or viewport management, perform these 8 manual verification steps on real devices:

### 3.1 Desktop Verification Checklist (macOS / Windows / Linux)
1. **Single-Choice Flip**: Click an option on a `MULTIPLE_CHOICE` card. Verify instant card flip without double-clicking.
2. **Desktop Score Pill & Button**: Verify `.score-pill` displays correct status and `.continue-btn` shows keyboard hint `[Space / 3]` or `[1]`.
3. **Desktop Space Key**: Press `Space` or `3` to grade Good. Verify card advances to next review.
4. **Multi-Select Empty Check**: Click "Select at least 1 option" with 0 checkboxes selected. Verify button shakes (`.btn-shake`) and warning appears.
5. **Multi-Select Flow**: Select 2 correct options, click "Check Answer". Verify card flips and Back displays full correctness breakdown.
6. **Fill in the Blank Enter**: Type accepted answer into input, press `Enter`. Verify front feedback card appears and flips immediately.
7. **Short Answer Self-Grading**: Press `1` on Short Answer Back. Verify card grades "Again".
8. **Diagram Description Toggle**: Click diagram thumbnail on Front and Back. Verify image description expands and collapses without flipping card.

### 3.2 AnkiMobile iOS Verification Checklist (iPhone)
1. **Whitespace Tap Guard**: Tap whitespace outside options on Front. Verify card **does not** flip.
2. **Single-Choice Tap**: Tap option directly. Verify card flips to Back.
3. **In-Card Button Suppression**: Verify `.continue-btn` and `.self-grade-container` are **not rendered** on Back.
4. **Native Bottom Bar**: Grade the card using AnkiMobile's native bottom bar buttons ("Again", "Good").
5. **Multi-Select Touch Interception**: Tap multi-select options. Verify checkboxes toggle without triggering card flip.
6. **Fill-in-the-Blank Keyboard Dismissal**: Type answer in text input and tap "Done" on virtual keyboard. Verify virtual keyboard dismisses cleanly.
7. **Diagram Touch Interception**: Tap diagram thumbnail. Verify description modal opens and card does not flip.
8. **Consecutive Review Cleanup**: Review 5 cards in a row. Verify taps remain responsive and memory/listeners do not leak.

### 3.3 AnkiMobile iPadOS Verification Checklist (iPad + Magic Keyboard)
1. **Touch vs. Trackpad Detection**: With Magic Keyboard attached, verify keyboard hints `[Space / 3]` appear on buttons.
2. **Keyboard Grading**: Press `Space` or `3` on Back. Verify card advances.
3. **Scratchpad Focus**: Tap into `#sa-scratchpad`. Verify virtual/hardware keyboard input works without jumpy auto-scrolling.
4. **Multi-Select Space Submission**: Select options with trackpad and press `Enter`. Verify card flips.
5. **Diagram Tab Navigation**: Navigate to diagram using `Tab` and press `Space`. Verify description opens.
6. **Dynamic Detach**: Detach iPad from Magic Keyboard. Verify touch interactions still prevent premature whitespace flip.
7. **Orientation Change**: Rotate between landscape and portrait. Verify viewport realignment functions without clipping.
8. **Full Review Session**: Complete 10 reviews with mixed input modes.

### 3.4 AnkiDroid Verification Checklist (Android Phone / Tablet)
1. **Option Tap Flip**: Tap single-choice option. Verify `showAnswer()` triggers immediate transition.
2. **Multi-Select Toggle**: Check options. Verify rapid tapping does not cause missed checks or ghost clicks.
3. **Form Enter Submit**: In fill-in-the-blank, tap software keyboard "Go" / "Enter". Verify answer submits.
4. **Native Ease Buttons**: Grade via AnkiDroid's bottom navigation bar. Verify rating saves.
5. **Dark Mode Toggle**: Enable Android system dark mode. Verify card styles adapt smoothly.
6. **MathJax Formula Rendering**: Render physics and chemistry equations. Verify LaTeX formulas typeset without error.
7. **Diagram Description Expansion**: Tap diagram alt text box. Verify container expands.
8. **Back Navigation**: Use Android system back gesture. Verify card state cleanly recovers.

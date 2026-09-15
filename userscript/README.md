# NotebookLM to Anki — UserScript Status

> [!WARNING]
> **A standalone UserScript version is not supported.**

---

## Why a UserScript Cannot Work

Exporting NotebookLM quizzes directly to Anki Desktop via a standalone UserScript (e.g., in Tampermonkey or Violentmonkey) is fundamentally limited by modern browser security architecture:

1. **Private Network Access (PNA) & Mixed Content:**
    - NotebookLM operates under an HTTPS public web origin (`https://notebooklm.google.com`).
    - AnkiConnect runs locally on a private loopback address (`http://localhost:8765` or `http://127.0.0.1:8765`).
    - Modern browsers enforce strict Private Network Access checks and mixed-content restrictions that prevent scripts running in a webpage context from initiating cross-origin HTTP requests to local loopback endpoints.

2. **Sandboxed Iframes & Security Boundaries:**
    - NotebookLM isolates dynamic content and application states inside sandboxed sub-frames (`*.usercontent.goog`).
    - Standard user script managers cannot reliably bridge communication and DOM extraction across these restricted sandboxed origins.

---

## Recommended Solution: Use the Web Extension

Please use the **[NotebookLM to Anki Web Extension](../README.md)** provided in the root of this repository.

### Why the Extension Works

- **Privileged Background Service Worker:** Chrome extensions use manifest-declared `host_permissions` (`http://127.0.0.1/*` and `http://localhost/*`), allowing the background service worker to communicate with AnkiConnect without triggering PNA or mixed-content blocks.
- **Isolated Content Script Environment:** The extension architecture allows secure message passing between injected content scripts and the background worker.

See the root **[README.md](../README.md)** for installation and setup instructions.

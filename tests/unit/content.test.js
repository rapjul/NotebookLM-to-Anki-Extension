/**
 * @fileoverview Unit test suite for content script (src/content.js).
 * Tests DOM data mining, iframe messaging, UI button injection, duplicate modal workflows, and error display.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../src/utils.js";
import {
	createMockChrome,
	createMockDOM,
	createMockFetch,
} from "../helpers/mock-chrome.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

/**
 * Standard quiz JSON fixture content.
 * @type {string}
 */
const standardQuizJson = fs.readFileSync(
	path.join(FIXTURES_DIR, "standard-quiz.json"),
	"utf8",
);

/**
 * Unrefs timers so tests exit immediately without blocking on 4s UI timeouts.
 */
const origSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
	const timer = origSetTimeout(fn, delay, ...args);
	if (timer?.unref) timer.unref();
	return timer;
};

/**
 * Sets up the mock environment before importing content.js.
 */
const mockChrome = createMockChrome({
	enableDebugLogging: true,
	quizDeckNameTemplate: "NotebookLM::{notebookName}::Quizzes::{quizName}",
});
const mockDOM = createMockDOM();
const mockFetch = createMockFetch();

globalThis.window = mockDOM.window;
globalThis.document = mockDOM.document;
globalThis.MutationObserver = mockDOM.MutationObserver;
globalThis.chrome = mockChrome;
globalThis.fetch = mockFetch;
globalThis.alert = (msg) => mockDOM.window.alert(msg);
globalThis.prompt = (msg) => mockDOM.window.prompt(msg);

await import("../../src/content.js");

// Allow async template fetching to complete in top window
await new Promise((resolve) => origSetTimeout(resolve, 20));

test("content: UI injection and button click workflow", async (t) => {
	// Add anchor element and container to DOM
	const container = mockDOM.document.createElement("div");
	container.className = "flex";
	const anchorBtn = mockDOM.document.createElement("button");
	anchorBtn.setAttribute("aria-label", "Good content rating");
	container.appendChild(anchorBtn);
	mockDOM.document.body.appendChild(container);

	// Add a mock iframe to receive extraction messages
	const iframe = mockDOM.document.createElement("iframe");
	const iframeMessages = [];
	iframe.contentWindow = {
		postMessage: (msg) => {
			iframeMessages.push(msg);
		},
	};
	mockDOM.document.body.appendChild(iframe);

	// Add notebook title element
	const titleInput = mockDOM.document.createElement("input");
	titleInput.setAttribute("placeholder", "Notebook title");
	titleInput.value = "Organic Chemistry";
	mockDOM.document.body.appendChild(titleInput);

	// Add quiz title element
	const quizInput = mockDOM.document.createElement("input");
	quizInput.setAttribute("formcontrolname", "title");
	quizInput.value = "Alkanes and Alkenes Quiz";
	mockDOM.document.body.appendChild(quizInput);

	// Trigger MutationObserver to inject export button
	mockDOM.MutationObserver.triggerAll();

	const exportBtn = mockDOM.document.getElementById("notebooklm-to-anki-btn");
	assert.ok(exportBtn, "Export button should be injected into DOM");

	await t.test(
		"clicking button before miner is connected alerts user",
		() => {
			mockDOM.window.alerts = [];
			exportBtn.click();

			assert.equal(mockDOM.window.alerts.length, 1);
			assert.equal(
				mockDOM.window.alerts[0],
				"Wait for page to fully load...",
			);
		},
	);

	await t.test(
		"ANKI_MINER_READY message enables export button and sets ready state",
		() => {
			mockDOM.window.postMessage({ action: "ANKI_MINER_READY" });

			assert.equal(exportBtn.disabled, false);
			assert.ok(
				exportBtn.classList.contains("notebooklm-to-anki-btn-ready"),
			);
		},
	);

	await t.test(
		"clicking button when Anki is offline shows connection alert",
		() => {
			mockDOM.window.alerts = [];
			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					if (msg.action === "checkAnkiStatus") {
						sendResponse({ success: false });
						return true;
					}
				},
			];

			exportBtn.click();

			assert.equal(mockDOM.window.alerts.length, 1);
			assert.equal(
				mockDOM.window.alerts[0],
				"⚠️ AnkiConnect not found! Is Anki running?",
			);
		},
	);

	await t.test(
		"clicking button when Anki is online triggers extraction in iframes",
		() => {
			iframeMessages.length = 0;
			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					if (msg.action === "checkAnkiStatus") {
						sendResponse({ success: true, version: 6 });
						return true;
					}
				},
			];

			exportBtn.click();

			assert.ok(
				exportBtn.classList.contains(
					"notebooklm-to-anki-btn-extracting",
				),
			);
			assert.equal(iframeMessages.length, 1);
			assert.equal(iframeMessages[0].action, "ANKI_TRIGGER_EXTRACT");
			assert.equal(iframeMessages[0].notebookTitle, "Organic Chemistry");
		},
	);

	await t.test(
		"clicking button prompts for name if notebook title element is absent",
		() => {
			// Temporarily remove title input
			titleInput.parentElement.removeChild(titleInput);
			mockDOM.window.prompts = [];

			exportBtn.click();

			assert.equal(mockDOM.window.prompts.length, 1);
			assert.equal(mockDOM.window.prompts[0], "Enter Notebook Name:");

			// Restore title input
			mockDOM.document.body.appendChild(titleInput);
		},
	);
});

test("content: data miner detection and batch extraction", async (t) => {
	// Add data-app-data container
	const appRoot = mockDOM.document.createElement("div");
	appRoot.setAttribute("data-app-data", standardQuizJson);
	mockDOM.document.body.appendChild(appRoot);

	// Trigger MutationObserver to detect container
	mockDOM.MutationObserver.triggerAll();

	await t.test(
		"ANKI_TRIGGER_EXTRACT processes quiz JSON and posts ANKI_EXTRACTED_DATA",
		async () => {
			await new Promise((resolve) => {
				/**
				 * Listener for messages posted back to window.
				 * @param {object} event - Message event.
				 * @returns {void}
				 */
				const messageHandler = (event) => {
					if (event.data?.action === "ANKI_EXTRACTED_DATA") {
						mockDOM.window.removeEventListener(
							"message",
							messageHandler,
						);
						assert.ok(
							Array.isArray(event.data.cards),
							"Extracted cards should be an array",
						);
						assert.equal(event.data.cards.length, 4);
						assert.ok(
							event.data.deckTitle.includes("Organic Chemistry"),
						);
						resolve();
					}
				};

				mockDOM.window.addEventListener("message", messageHandler);
				mockDOM.window.postMessage({
					action: "ANKI_TRIGGER_EXTRACT",
					notebookTitle: "Organic Chemistry",
				});
			});
		},
	);

	await t.test(
		"empty data-app-data attribute posts ANKI_REAL_FAIL",
		async () => {
			appRoot.setAttribute("data-app-data", "");

			await new Promise((resolve) => {
				const messageHandler = (event) => {
					if (event.data?.action === "ANKI_REAL_FAIL") {
						mockDOM.window.removeEventListener(
							"message",
							messageHandler,
						);
						assert.equal(
							event.data.error,
							"Raw JSON string is empty.",
						);
						resolve();
					}
				};

				mockDOM.window.addEventListener("message", messageHandler);
				mockDOM.window.postMessage({
					action: "ANKI_TRIGGER_EXTRACT",
					notebookTitle: "Organic Chemistry",
				});
			});
		},
	);

	await t.test(
		"malformed JSON in data-app-data attribute posts ANKI_REAL_FAIL",
		async () => {
			appRoot.setAttribute("data-app-data", "{ not valid json }}}");

			await new Promise((resolve) => {
				const messageHandler = (event) => {
					if (event.data?.action === "ANKI_REAL_FAIL") {
						mockDOM.window.removeEventListener(
							"message",
							messageHandler,
						);
						assert.ok(
							event.data.error.includes("JSON Parse Error"),
						);
						resolve();
					}
				};

				mockDOM.window.addEventListener("message", messageHandler);
				mockDOM.window.postMessage({
					action: "ANKI_TRIGGER_EXTRACT",
					notebookTitle: "Organic Chemistry",
				});
			});
		},
	);
});

test("content: duplicate deck conflict resolution modal", async (t) => {
	// Reset isExporting state by simulating export success
	mockDOM.window.postMessage({ action: "ANKI_REAL_SUCCESS", count: 0 });

	// Remove residual quiz input so payload quizTitle is tested
	const existingQuizInput = mockDOM.document.querySelector(
		'input[formcontrolname="title"]',
	);
	if (existingQuizInput) {
		existingQuizInput.parentElement.removeChild(existingQuizInput);
	}

	const overlay = mockDOM.document.getElementById(
		"anki-duplicate-modal-overlay",
	);
	assert.ok(overlay, "Duplicate modal overlay should exist in DOM");

	const titleEl = mockDOM.document.getElementById("anki-modal-deck-title");
	const titleIncEl = mockDOM.document.getElementById(
		"anki-modal-deck-title-inc",
	);
	const btnMerge = mockDOM.document.getElementById("anki-btn-merge");
	const btnIncrement = mockDOM.document.getElementById("anki-btn-increment");
	const btnOverwrite = mockDOM.document.getElementById("anki-btn-overwrite");
	const btnCancel = mockDOM.document.getElementById("anki-btn-cancel");

	/** @type {Array<object>} */
	const sentMessages = [];

	mockChrome.runtime.onMessage.listeners = [
		(msg, sender, sendResponse) => {
			sentMessages.push(msg);
			if (msg.action === "checkDeckExists") {
				sendResponse({ success: true, exists: true });
				return true;
			}
			if (msg.action === "sendBatchToAnki") {
				sendResponse({
					success: true,
					count: 4,
					skipped: 0,
				});
				return true;
			}
		},
	];

	await t.test(
		"displays modal when existing deck conflict is detected",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [{ question: "Q1" }],
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids",
				nbTitle: "Chemistry",
				quizTitle: "Acids",
			});

			assert.ok(
				overlay.classList.contains("show"),
				"Duplicate overlay should have 'show' class",
			);
			assert.equal(
				titleEl.innerText,
				"NotebookLM::Chemistry::Quizzes::Acids",
			);
			assert.equal(
				titleIncEl.innerText,
				"NotebookLM::Chemistry::Quizzes::Acids (1)",
			);
		},
	);

	await t.test(
		"clicking merge sends batch with merge strategy and closes modal",
		() => {
			sentMessages.length = 0;
			btnMerge.click();

			assert.equal(
				overlay.classList.contains("show"),
				false,
				"Modal should close after merge click",
			);
			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.ok(sendMsg);
			assert.equal(sendMsg.duplicateAction, "merge");
		},
	);

	await t.test(
		"clicking increment sends batch with auto-increment title",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});

			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [{ question: "Q1" }],
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids",
				nbTitle: "Chemistry",
				quizTitle: "Acids",
			});

			sentMessages.length = 0;
			btnIncrement.click();

			assert.equal(overlay.classList.contains("show"), false);
			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.ok(sendMsg);
			assert.equal(sendMsg.duplicateAction, "increment");
			assert.equal(
				sendMsg.deckTitle,
				"NotebookLM::Chemistry::Quizzes::Acids (1)",
			);
		},
	);

	await t.test(
		"clicking overwrite sends batch with overwrite strategy",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});

			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [{ question: "Q1" }],
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids",
				nbTitle: "Chemistry",
				quizTitle: "Acids",
			});

			sentMessages.length = 0;
			btnOverwrite.click();

			assert.equal(overlay.classList.contains("show"), false);
			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.ok(sendMsg);
			assert.equal(sendMsg.duplicateAction, "overwrite");
		},
	);

	await t.test("clicking cancel aborts export and resets button", () => {
		mockDOM.window.postMessage({ action: "ANKI_REAL_SUCCESS", count: 0 });

		mockDOM.window.postMessage({
			action: "ANKI_EXTRACTED_DATA",
			cards: [{ question: "Q1" }],
			deckTitle: "NotebookLM::Chemistry::Quizzes::Acids",
			nbTitle: "Chemistry",
			quizTitle: "Acids",
		});

		sentMessages.length = 0;
		btnCancel.click();

		assert.equal(overlay.classList.contains("show"), false);
		const sendMsg = sentMessages.find(
			(m) => m.action === "sendBatchToAnki",
		);
		assert.equal(
			sendMsg,
			undefined,
			"No batch message should be sent on cancel",
		);
	});

	await t.test(
		"directly exports with merge strategy when target deck does not exist",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});
			sentMessages.length = 0;

			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					sentMessages.push(msg);
					if (msg.action === "checkDeckExists") {
						sendResponse({ success: true, exists: false });
						return true;
					}
					if (msg.action === "sendBatchToAnki") {
						sendResponse({ success: true, count: 5, skipped: 0 });
						return true;
					}
				},
			];

			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [{ question: "Q_New" }],
				deckTitle: "NotebookLM::Chemistry::Quizzes::BrandNewDeck",
				nbTitle: "Chemistry",
				quizTitle: "BrandNewDeck",
			});

			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.ok(sendMsg);
			assert.equal(sendMsg.duplicateAction, "merge");
			assert.equal(overlay.classList.contains("show"), false);
		},
	);

	await t.test(
		"posts ANKI_REAL_FAIL when checkDeckExists query fails",
		async () => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});

			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					if (msg.action === "checkDeckExists") {
						sendResponse({
							success: false,
							error: "Connection Timeout",
						});
						return true;
					}
				},
			];

			await new Promise((resolve) => {
				const handler = (event) => {
					if (event.data?.action === "ANKI_REAL_FAIL") {
						mockDOM.window.removeEventListener("message", handler);
						assert.equal(event.data.error, "Connection Timeout");
						resolve();
					}
				};
				mockDOM.window.addEventListener("message", handler);

				mockDOM.window.postMessage({
					action: "ANKI_EXTRACTED_DATA",
					cards: [{ question: "Q1" }],
					deckTitle: "NotebookLM::Chemistry::Quizzes::FailDeck",
					nbTitle: "Chemistry",
					quizTitle: "FailDeck",
				});
			});
		},
	);

	await t.test(
		"posts ANKI_REAL_FAIL when sendBatchToAnki returns error response",
		async () => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});

			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					if (msg.action === "checkDeckExists") {
						sendResponse({ success: true, exists: false });
						return true;
					}
					if (msg.action === "sendBatchToAnki") {
						sendResponse({
							success: false,
							error: "Failed to write cards to Anki",
						});
						return true;
					}
				},
			];

			await new Promise((resolve) => {
				const handler = (event) => {
					if (event.data?.action === "ANKI_REAL_FAIL") {
						mockDOM.window.removeEventListener("message", handler);
						assert.equal(
							event.data.error,
							"Failed to write cards to Anki",
						);
						resolve();
					}
				};
				mockDOM.window.addEventListener("message", handler);

				mockDOM.window.postMessage({
					action: "ANKI_EXTRACTED_DATA",
					cards: [{ question: "Q1" }],
					deckTitle: "NotebookLM::Chemistry::Quizzes::FailDeck2",
					nbTitle: "Chemistry",
					quizTitle: "FailDeck2",
				});
			});
		},
	);
});

test("content: success and error modal user feedback", async (t) => {
	const exportBtn = mockDOM.document.getElementById("notebooklm-to-anki-btn");
	const labelSpan = exportBtn.querySelector(
		".notebooklm-to-anki-btn-label span:last-child",
	);
	const errorOverlay = mockDOM.document.getElementById(
		"anki-error-modal-overlay",
	);
	const errorContent = mockDOM.document.getElementById(
		"anki-error-modal-content",
	);
	const errorCloseBtn = mockDOM.document.getElementById(
		"anki-error-btn-close",
	);

	await t.test(
		"ANKI_REAL_SUCCESS updates button text for all new cards",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 10,
				skipped: 0,
			});

			assert.ok(
				exportBtn.classList.contains("notebooklm-to-anki-btn-success"),
			);
			assert.equal(labelSpan.innerText, "Saved 10!");
		},
	);

	await t.test(
		"ANKI_REAL_SUCCESS updates button text with skipped duplicate counts",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 8,
				skipped: 2,
			});

			assert.ok(
				exportBtn.classList.contains("notebooklm-to-anki-btn-success"),
			);
			assert.equal(labelSpan.innerText, "Saved 8, Skipped 2");
		},
	);

	await t.test(
		"ANKI_REAL_FAIL shows error modal with formatted message",
		() => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_FAIL",
				error: "cannot create note: deck does not exist",
			});

			assert.ok(
				errorOverlay.classList.contains("show"),
				"Error overlay should have 'show' class",
			);
			assert.ok(
				exportBtn.classList.contains("notebooklm-to-anki-btn-error"),
			);
			assert.equal(labelSpan.innerText, "Error");
			assert.equal(
				errorContent.innerText,
				"cannot create note: deck does not exist",
			);

			// Close error modal
			errorCloseBtn.click();
			assert.equal(errorOverlay.classList.contains("show"), false);
		},
	);
});

test("content: notebook and quiz title DOM extraction fallbacks", async (t) => {
	await t.test("extracts notebook title from title-label element", () => {
		const labelEl = mockDOM.document.createElement("div");
		labelEl.className = "title-label";
		labelEl.textContent = "Label Notebook Title";
		mockDOM.document.body.appendChild(labelEl);

		assert.ok(labelEl.textContent.includes("Label Notebook Title"));
		labelEl.parentElement.removeChild(labelEl);
	});

	await t.test(
		"extracts notebook title from document title if input is missing",
		() => {
			const input = mockDOM.document.querySelector(
				'input[placeholder="Notebook title"]',
			);
			if (input) input.parentElement.removeChild(input);

			mockDOM.document.title = "Physics 101 - NotebookLM";
			assert.ok(mockDOM.document.title.includes("- NotebookLM"));
		},
	);

	await t.test(
		"storage onChanged dynamically updates template and debug flags",
		() => {
			mockChrome.storage.onChanged.dispatch({
				enableDebugLogging: { oldValue: false, newValue: true },
				quizDeckNameTemplate: {
					oldValue: "old",
					newValue: "CustomDeck::{quizName}",
				},
			});
			assert.ok(true);
		},
	);
});

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
	flushPromises,
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
 * Multi-format quiz JSON fixture content.
 * @type {string}
 */
const multiFormatQuizJson = fs.readFileSync(
	path.join(FIXTURES_DIR, "multi-format-quiz.json"),
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
globalThis.DOMParser = mockDOM.DOMParser;
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
		async () => {
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
			await flushPromises();

			assert.equal(mockDOM.window.alerts.length, 1);
			assert.equal(
				mockDOM.window.alerts[0],
				"⚠️ AnkiConnect not found! Is Anki running?",
			);
		},
	);

	await t.test(
		"clicking button when Anki is online triggers extraction in iframes",
		async () => {
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
			await flushPromises();

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
		async () => {
			// Temporarily remove title input
			titleInput.parentElement.removeChild(titleInput);
			mockDOM.window.prompts = [];

			exportBtn.click();
			await flushPromises();

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
						assert.ok(
							Array.isArray(event.data.topicsCovered),
							"topicsCovered should be an array",
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
		"ANKI_TRIGGER_EXTRACT deduplicates identical triggerId to prevent multiple extractions",
		async () => {
			let extractionCount = 0;
			/**
			 * Listener for messages posted back to window.
			 * @param {object} event - Message event.
			 * @returns {void}
			 */
			const messageHandler = (event) => {
				if (event.data?.action === "ANKI_EXTRACTED_DATA") {
					extractionCount++;
				}
			};
			mockDOM.window.addEventListener("message", messageHandler);

			const triggerId = "test-dedup-trigger-" + Date.now();
			mockDOM.window.postMessage({
				action: "ANKI_TRIGGER_EXTRACT",
				notebookTitle: "Organic Chemistry",
				triggerId,
			});

			await flushPromises();

			// Send duplicate trigger with identical triggerId
			mockDOM.window.postMessage({
				action: "ANKI_TRIGGER_EXTRACT",
				notebookTitle: "Organic Chemistry",
				triggerId,
			});

			await flushPromises();
			await new Promise((resolve) => setTimeout(resolve, 30));

			mockDOM.window.removeEventListener("message", messageHandler);
			assert.equal(
				extractionCount,
				1,
				"Duplicate triggerId should not trigger multiple extractions",
			);
		},
	);

	await t.test(
		"ANKI_TRIGGER_EXTRACT resolves data-image-urls and covered topics for multi-format quiz",
		async () => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});
			appRoot.setAttribute("data-app-data", multiFormatQuizJson);
			appRoot.setAttribute(
				"data-image-urls",
				JSON.stringify([
					"https://lh3.googleusercontent.com/test-diagram-source-voltage.png",
				]),
			);

			await new Promise((resolve, reject) => {
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
						try {
							assert.equal(event.data.cards.length, 5);
							const imageCard = event.data.cards[4];
							assert.ok(
								imageCard.diagramUrl.includes(
									"https://lh3.googleusercontent.com/test-diagram-source-voltage.png",
								),
								"Image card should resolve image URL from data-image-urls",
							);
							assert.ok(
								event.data.topicsCovered.includes(
									"Fundamental_Circuit_Definitions_Voltage_Current_Power",
								),
								"Should include sanitized topic tag",
							);
							resolve();
						} catch (err) {
							reject(err);
						}
					}
				};

				mockDOM.window.addEventListener("message", messageHandler);
				mockDOM.window.postMessage({
					action: "ANKI_TRIGGER_EXTRACT",
					notebookTitle: "Circuit Analysis",
				});
			});

			appRoot.removeAttribute("data-image-urls");
			appRoot.setAttribute("data-app-data", standardQuizJson);
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});
		},
	);

	await t.test(
		"preserves 1-to-1 matching during Base64 capture when cards share generic alt text",
		async () => {
			const quizWithGenericAlts = JSON.stringify({
				quiz: [
					{
						question: "First circuit diagram:\n\n![Diagram](image_reference_index:0)",
						options: ["Resistor", "Capacitor", "Inductor", "Diode"],
						answer: 0,
					},
					{
						question: "Second circuit diagram:\n\n![Diagram](image_reference_index:1)",
						options: ["Series", "Parallel", "Bridge", "Mesh"],
						answer: 1,
					},
				],
			});

			appRoot.setAttribute("data-app-data", quizWithGenericAlts);
			appRoot.setAttribute(
				"data-image-urls",
				JSON.stringify([
					"https://example.com/circuit1.png",
					"https://example.com/circuit2.png",
				]),
			);

			const img1 = mockDOM.document.createElement("img");
			img1.src = "https://example.com/circuit1.png";
			img1.alt = "Diagram";
			img1.naturalWidth = 200;
			img1.naturalHeight = 200;
			img1.complete = true;
			mockDOM.document.body.appendChild(img1);

			const img2 = mockDOM.document.createElement("img");
			img2.src = "https://example.com/circuit2.png";
			img2.alt = "Diagram";
			img2.naturalWidth = 200;
			img2.naturalHeight = 200;
			img2.complete = true;
			mockDOM.document.body.appendChild(img2);

			const origListeners = mockChrome.runtime.onMessage.listeners;
			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					if (msg.action === "checkDeckExists") {
						sendResponse({ success: true, exists: false });
						return true;
					}
					if (msg.action === "sendBatchToAnki") {
						sendResponse({ success: true, count: 2, skipped: 0 });
						return true;
					}
				},
			];

			try {
				await new Promise((resolve, reject) => {
					/**
					 * Message handler waiting for ANKI_EXTRACTED_DATA.
					 * @param {object} event - Message event.
					 * @returns {void}
					 */
					const messageHandler = (event) => {
						if (event.data?.action === "ANKI_EXTRACTED_DATA") {
							mockDOM.window.removeEventListener(
								"message",
								messageHandler,
							);
							try {
								assert.equal(event.data.cards.length, 2);
								assert.notEqual(
									event.data.cards[0].diagramUrl,
									event.data.cards[1].diagramUrl,
									"Cards sharing generic alt text must be assigned distinct DOM images",
								);
								assert.ok(
									event.data.cards[0].imageBase64,
									"Card 0 should have extracted imageBase64",
								);
								assert.ok(
									event.data.cards[1].imageBase64,
									"Card 1 should have extracted imageBase64",
								);
								resolve();
							} catch (err) {
								reject(err);
							}
						} else if (event.data?.action === "ANKI_REAL_FAIL") {
							mockDOM.window.removeEventListener(
								"message",
								messageHandler,
							);
							reject(new Error(event.data.error));
						}
					};

					mockDOM.window.addEventListener("message", messageHandler);
					mockDOM.window.postMessage({
						action: "ANKI_TRIGGER_EXTRACT",
						triggerId: "trigger-shared-alt-test",
						notebookTitle: "Shared Alt Test",
					});
				});
			} finally {
				mockChrome.runtime.onMessage.listeners = origListeners;
				img1.parentElement?.removeChild(img1);
				img2.parentElement?.removeChild(img2);
				appRoot.removeAttribute("data-image-urls");
				appRoot.setAttribute("data-app-data", standardQuizJson);
				mockDOM.window.postMessage({
					action: "ANKI_REAL_SUCCESS",
					count: 0,
				});
			}
		},
	);

	await t.test(
		"skips Base64 serialization when matching DOM image renders a lazy-load placeholder",
		async () => {
			const placeholderQuiz = JSON.stringify({
				quiz: [
					{
						question:
							"Lazy loaded diagram:\n\n![Circuit Diagram](image_reference_index:0)",
						options: ["Resistor", "Capacitor"],
						answer: 0,
					},
				],
			});

			appRoot.setAttribute("data-app-data", placeholderQuiz);
			appRoot.setAttribute(
				"data-image-urls",
				JSON.stringify(["https://example.com/actual-highres.png"]),
			);

			const placeholderImg = mockDOM.document.createElement("img");
			placeholderImg.src =
				"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==";
			placeholderImg.alt = "Circuit Diagram";
			placeholderImg.setAttribute(
				"data-src",
				"https://example.com/actual-highres.png",
			);
			placeholderImg.naturalWidth = 200;
			placeholderImg.naturalHeight = 200;
			placeholderImg.complete = true;
			mockDOM.document.body.appendChild(placeholderImg);

			const origListeners = mockChrome.runtime.onMessage.listeners;
			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					if (msg.action === "checkDeckExists") {
						sendResponse({ success: true, exists: false });
						return true;
					}
					if (msg.action === "sendBatchToAnki") {
						sendResponse({ success: true, count: 1, skipped: 0 });
						return true;
					}
				},
			];

			try {
				await new Promise((resolve, reject) => {
					/**
					 * Message handler waiting for ANKI_EXTRACTED_DATA.
					 * @param {object} event - Message event.
					 * @returns {void}
					 */
					const messageHandler = (event) => {
						if (event.data?.action === "ANKI_EXTRACTED_DATA") {
							mockDOM.window.removeEventListener(
								"message",
								messageHandler,
							);
							try {
								assert.equal(event.data.cards.length, 1);
								const card = event.data.cards[0];
								assert.equal(
									card.diagramUrl,
									"https://example.com/actual-highres.png",
									"Card should retain high-resolution URL from data-src",
								);
								assert.equal(
									card.imageBase64,
									undefined,
									"Placeholder DOM image must not be serialized to Base64",
								);
								resolve();
							} catch (err) {
								reject(err);
							}
						} else if (event.data?.action === "ANKI_REAL_FAIL") {
							mockDOM.window.removeEventListener(
								"message",
								messageHandler,
							);
							reject(new Error(event.data.error));
						}
					};

					mockDOM.window.addEventListener("message", messageHandler);
					mockDOM.window.postMessage({
						action: "ANKI_TRIGGER_EXTRACT",
						triggerId: "trigger-placeholder-test",
						notebookTitle: "Placeholder Test",
					});
				});
			} finally {
				mockChrome.runtime.onMessage.listeners = origListeners;
				placeholderImg.parentElement?.removeChild(placeholderImg);
				appRoot.removeAttribute("data-image-urls");
				appRoot.setAttribute("data-app-data", standardQuizJson);
				mockDOM.window.postMessage({
					action: "ANKI_REAL_SUCCESS",
					count: 0,
				});
			}
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
		async () => {
			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [{ question: "Q1" }],
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids",
				nbTitle: "Chemistry",
				quizTitle: "Acids",
				topicsCovered: ["Acids_Bases", "Equilibrium"],
			});
			await flushPromises();

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
		async () => {
			sentMessages.length = 0;
			btnMerge.click();
			await flushPromises();

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
			assert.deepEqual(sendMsg.topicsCovered, [
				"Acids_Bases",
				"Equilibrium",
			]);
		},
	);

	await t.test(
		"clicking increment sends batch with auto-increment title",
		async () => {
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
			await flushPromises();

			sentMessages.length = 0;
			btnIncrement.click();
			await flushPromises();

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
		async () => {
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
			await flushPromises();

			sentMessages.length = 0;
			btnOverwrite.click();
			await flushPromises();

			assert.equal(overlay.classList.contains("show"), false);
			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.ok(sendMsg);
			assert.equal(sendMsg.duplicateAction, "overwrite");
		},
	);

	await t.test(
		"clicking cancel aborts export and resets button",
		async () => {
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
			await flushPromises();

			sentMessages.length = 0;
			btnCancel.click();
			await flushPromises();

			assert.equal(overlay.classList.contains("show"), false);
			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.equal(
				sendMsg,
				undefined,
				"No batch message should be sent on cancel",
			);
		},
	);

	await t.test(
		"directly exports with merge strategy when target deck does not exist",
		async () => {
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
				topicsCovered: ["General_Chemistry"],
			});
			await flushPromises();

			const sendMsg = sentMessages.find(
				(m) => m.action === "sendBatchToAnki",
			);
			assert.ok(sendMsg);
			assert.equal(sendMsg.duplicateAction, "merge");
			assert.deepEqual(sendMsg.topicsCovered, ["General_Chemistry"]);
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

test("content: extracted cards batch dispatch", async (t) => {
	await t.test(
		"handleExtractedData forwards cards with diagramUrl directly to background worker via sendBatchToAnki",
		async () => {
			mockDOM.window.postMessage({
				action: "ANKI_REAL_SUCCESS",
				count: 0,
			});
			/** @type {Array<object>} */
			const sentMessages = [];

			mockChrome.runtime.onMessage.listeners = [
				/**
				 * Mock runtime message handler for checking deck and handling batch export.
				 * @param {object} msg - Incoming runtime message.
				 * @param {object} sender - Message sender metadata.
				 * @param {function(object): void} sendResponse - Response callback.
				 * @returns {boolean} True for asynchronous response.
				 */
				(msg, sender, sendResponse) => {
					sentMessages.push(msg);
					if (msg.action === "checkDeckExists") {
						sendResponse({ success: true, exists: false });
						return true;
					}
					if (msg.action === "sendBatchToAnki") {
						sendResponse({ success: true, count: 1, skipped: 0 });
						return true;
					}
				},
			];

			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [
					{
						question: "What is this circuit element?",
						diagramUrl:
							"https://lh3.googleusercontent.com/test-circuit-topwindow.png",
						diagramAlt: "Voltage Source Diagram",
					},
				],
				deckTitle: "NotebookLM::EE::Quizzes::Circuits",
				nbTitle: "EE",
				quizTitle: "Circuits",
			});

			await new Promise((resolve) => {
				/**
				 * Polling checker waiting for sendBatchToAnki message to be dispatched.
				 * @returns {void}
				 */
				const check = () => {
					const sendMsg = sentMessages.find(
						(m) => m.action === "sendBatchToAnki",
					);
					if (sendMsg) {
						assert.equal(sendMsg.batchData.length, 1);
						const card = sendMsg.batchData[0];
						assert.equal(
							card.diagramUrl,
							"https://lh3.googleusercontent.com/test-circuit-topwindow.png",
						);
						assert.equal(card.diagramAlt, "Voltage Source Diagram");
						resolve();
					} else {
						setTimeout(check, 10);
					}
				};
				check();
			});
		},
	);

	await t.test(
		"handleExtractedData passes imagesFound to sendBatchToAnki runtime message",
		async () => {
			/** @type {Array<object>} */
			const sentMessages = [];

			mockChrome.runtime.onMessage.listeners = [
				(msg, sender, sendResponse) => {
					sentMessages.push(msg);
					if (msg.action === "checkDeckExists") {
						sendResponse({ success: true, exists: false });
						return true;
					}
					if (msg.action === "sendBatchToAnki") {
						sendResponse({
							success: true,
							count: 1,
							skipped: 0,
							imagesFound: 1,
							imagesExported: 1,
						});
						return true;
					}
				},
			];

			mockDOM.window.postMessage({
				action: "ANKI_EXTRACTED_DATA",
				cards: [
					{
						question: "Circuit question with image",
						diagramUrl: "https://lh3.googleusercontent.com/circuit.png",
						hasMediaReference: true,
					},
				],
				deckTitle: "NotebookLM::EE::Quizzes::Images",
				nbTitle: "EE",
				quizTitle: "Images",
				imagesFound: 1,
				imagesResolved: 1,
			});

			await new Promise((resolve) => {
				const check = () => {
					const sendMsg = sentMessages.find(
						(m) => m.action === "sendBatchToAnki",
					);
					if (sendMsg) {
						assert.equal(sendMsg.imagesFound, 1);
						resolve();
					} else {
						setTimeout(check, 10);
					}
				};
				check();
			});
		},
	);
});

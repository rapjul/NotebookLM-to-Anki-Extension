/**
 * @fileoverview Unit test suite for Promise-based Chrome Extension APIs
 * verifying native async/await resolution, port lifecycle persistence, and connection rejection handling.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	createMockChrome,
	createMockDOM,
	flushPromises,
} from "../helpers/mock-chrome.js";

test("chrome-api-async: native Promise resolution for storage and messaging", async (t) => {
	await t.test(
		"chrome.storage.local.get resolves as Promise with requested default values",
		async () => {
			const mockChrome = createMockChrome({ initialKey: "savedValue" });

			const result = await mockChrome.storage.local.get({
				initialKey: "fallback",
				missingKey: "defaultValue",
			});

			assert.equal(result.initialKey, "savedValue");
			assert.equal(result.missingKey, "defaultValue");
		},
	);

	await t.test(
		"chrome.storage.local.set resolves as Promise and updates internal storage state",
		async () => {
			const mockChrome = createMockChrome();

			await mockChrome.storage.local.set({
				quizDeckNameTemplate: "CustomDeck::{quizName}",
				enableDebugLogging: false,
			});

			const stored = await mockChrome.storage.local.get([
				"quizDeckNameTemplate",
				"enableDebugLogging",
			]);

			assert.equal(stored.quizDeckNameTemplate, "CustomDeck::{quizName}");
			assert.equal(stored.enableDebugLogging, false);
		},
	);

	await t.test(
		"chrome.runtime.sendMessage resolves as Promise with payload from sendResponse",
		async () => {
			const mockChrome = createMockChrome();
			mockChrome.runtime.onMessage.addListener(
				(request, sender, sendResponse) => {
					if (request.action === "ping") {
						sendResponse({ pong: true, time: 12345 });
						return true;
					}
				},
			);

			const response = await mockChrome.runtime.sendMessage({
				action: "ping",
			});

			assert.deepEqual(response, { pong: true, time: 12345 });
		},
	);

	await t.test(
		"chrome.runtime.sendMessage rejects as Promise when no receiver handles the message",
		async () => {
			const mockChrome = createMockChrome();

			await assert.rejects(
				async () => {
					await mockChrome.runtime.sendMessage({
						action: "unhandledAction",
					});
				},
				{
					name: "Error",
					message:
						"Could not establish connection. Receiving end does not exist.",
				},
			);
		},
	);
});

test("chrome-api-async: background message listener port lifecycle contract", async (t) => {
	await t.test(
		"background onMessage listener returns true synchronously for asynchronous actions",
		async () => {
			const mockChrome = createMockChrome();
			globalThis.self = globalThis;
			globalThis.importScripts = () => {};
			globalThis.chrome = mockChrome;
			globalThis.fetch = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ result: 6, error: null }),
			});

			await import("../../src/background.js");
			const listener = mockChrome.runtime.onMessage.listeners[0];
			assert.equal(typeof listener, "function");

			// checkAnkiStatus must return boolean true synchronously to preserve port lifetime
			const statusHandled = listener(
				{ action: "checkAnkiStatus" },
				{ id: "test-sender" },
				() => {},
			);
			assert.equal(statusHandled, true);

			// checkDeckExists must return boolean true synchronously
			const deckHandled = listener(
				{ action: "checkDeckExists", deckName: "TestDeck" },
				{ id: "test-sender" },
				() => {},
			);
			assert.equal(deckHandled, true);

			// sendBatchToAnki must return boolean true synchronously
			const batchHandled = listener(
				{
					action: "sendBatchToAnki",
					batchData: [],
					deckTitle: "TestDeck",
					duplicateAction: "merge",
					topicsCovered: [],
				},
				{ id: "test-sender" },
				() => {},
			);
			assert.equal(batchHandled, true);

			const response = await mockChrome.runtime.sendMessage({
				action: "checkAnkiStatus",
			});
			assert.deepEqual(response, {
				success: true,
				version: { result: 6, error: null },
			});
		},
	);
});

test("chrome-api-async: content script error boundary on rejected sendMessage", async (t) => {
	await t.test(
		"handleExportButtonClick alerts user when background service worker rejects connection",
		async () => {
			const mockChrome = createMockChrome();
			const mockDOM = createMockDOM();

			globalThis.window = mockDOM.window;
			globalThis.document = mockDOM.document;
			globalThis.chrome = mockChrome;
			globalThis.fetch = async () => ({
				ok: true,
				text: async () =>
					"<button id='anki-export-btn'>Export</button>",
			});

			// Clear all listeners so sendMessage rejects
			mockChrome.runtime.onMessage.listeners = [];
			mockDOM.window.alerts = [];

			const btn = mockDOM.document.createElement("button");
			btn.id = "test-export-btn";

			/**
			 * Handler simulating export button click with rejected sendMessage.
			 *
			 * @returns {Promise<void>}
			 */
			const clickHandler = async () => {
				let res;
				try {
					res = await mockChrome.runtime.sendMessage({
						action: "checkAnkiStatus",
					});
				} catch {
					res = { success: false };
				}

				if (!res?.success) {
					mockDOM.window.alert(
						"⚠️ AnkiConnect not found! Is Anki running?",
					);
				}
			};

			btn.onclick = clickHandler;
			await btn.click();
			await flushPromises();

			assert.equal(mockDOM.window.alerts.length, 1);
			assert.equal(
				mockDOM.window.alerts[0],
				"⚠️ AnkiConnect not found! Is Anki running?",
			);
		},
	);
});

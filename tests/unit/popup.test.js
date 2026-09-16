/**
 * @fileoverview Unit test suite for popup UI script (src/popup.js).
 * Tests DOM initialization, debug logging toggling, template persistence, and script injection.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createMockChrome, createMockDOM } from "../helpers/mock-chrome.js";

/**
 * Helper to build the required popup HTML elements in a mock DOM.
 *
 * @param {object} mockDOM - The mock DOM environment.
 * @returns {Record<string, import('../helpers/mock-chrome.js').MockElement>} Elements map.
 */
function setupPopupDOM(mockDOM) {
	const sendToAnki = mockDOM.document.createElement("button");
	sendToAnki.id = "sendToAnki";

	const status = mockDOM.document.createElement("div");
	status.id = "status";

	const debugStatus = mockDOM.document.createElement("span");
	debugStatus.id = "debug-status";

	const toggleDebug = mockDOM.document.createElement("button");
	toggleDebug.id = "toggleDebug";

	const quizDeckNameTemplate = mockDOM.document.createElement("input");
	quizDeckNameTemplate.id = "quizDeckNameTemplate";

	mockDOM.document.body.appendChild(sendToAnki);
	mockDOM.document.body.appendChild(status);
	mockDOM.document.body.appendChild(debugStatus);
	mockDOM.document.body.appendChild(toggleDebug);
	mockDOM.document.body.appendChild(quizDeckNameTemplate);

	return {
		sendToAnki,
		status,
		debugStatus,
		toggleDebug,
		quizDeckNameTemplate,
	};
}

test("popup: initialization and user interactions", async (t) => {
	const mockChrome = createMockChrome({
		enableDebugLogging: true,
		quizDeckNameTemplate: "NotebookLM::{notebookName}::Quizzes::{quizName}",
	});
	const mockDOM = createMockDOM();
	const elements = setupPopupDOM(mockDOM);

	globalThis.document = mockDOM.document;
	globalThis.chrome = mockChrome;

	await import("../../src/popup.js");

	await t.test(
		"DOMContentLoaded populates deck template and debug status enabled",
		() => {
			mockDOM.document.dispatchEvent({ type: "DOMContentLoaded" });

			assert.equal(
				elements.quizDeckNameTemplate.value,
				"NotebookLM::{notebookName}::Quizzes::{quizName}",
			);
			assert.equal(elements.debugStatus.textContent, "Enabled");
			assert.equal(elements.debugStatus.className, "status-enabled");
			assert.equal(
				elements.toggleDebug.textContent,
				"Disable Debug Logging",
			);
			assert.equal(elements.toggleDebug.className, "btn-dark");
		},
	);

	await t.test(
		"input on quizDeckNameTemplate persists changes to storage",
		() => {
			const customTemplate = "CustomDeck::{quizName}";
			elements.quizDeckNameTemplate.value = customTemplate;
			elements.quizDeckNameTemplate.dispatchEvent({
				type: "input",
				target: { value: customTemplate },
			});

			mockChrome.storage.local.get("quizDeckNameTemplate", (res) => {
				assert.equal(res.quizDeckNameTemplate, customTemplate);
			});
		},
	);

	await t.test(
		"toggleDebug button flips logging state and updates UI",
		() => {
			// First toggle: Enabled -> Disabled
			elements.toggleDebug.click();

			assert.equal(elements.debugStatus.textContent, "Disabled");
			assert.equal(elements.debugStatus.className, "status-disabled");
			assert.equal(
				elements.toggleDebug.textContent,
				"Enable Debug Logging",
			);
			assert.equal(elements.toggleDebug.className, "");

			mockChrome.storage.local.get("enableDebugLogging", (res) => {
				assert.equal(res.enableDebugLogging, false);
			});

			// Second toggle: Disabled -> Enabled
			elements.toggleDebug.click();

			assert.equal(elements.debugStatus.textContent, "Enabled");
			assert.equal(elements.debugStatus.className, "status-enabled");
			assert.equal(
				elements.toggleDebug.textContent,
				"Disable Debug Logging",
			);
			assert.equal(elements.toggleDebug.className, "btn-dark");

			mockChrome.storage.local.get("enableDebugLogging", (res) => {
				assert.equal(res.enableDebugLogging, true);
			});
		},
	);

	await t.test(
		"sendToAnki button initiates content script injection into active tab",
		async () => {
			elements.sendToAnki.click();

			assert.equal(
				elements.status.textContent,
				"🤖 Robot initializing...",
			);

			// Allow async microtasks in click handler to resolve
			await new Promise((resolve) => setTimeout(resolve, 10));

			assert.equal(mockChrome.scripting.injections.length, 1);
			const injection = mockChrome.scripting.injections[0];
			assert.deepEqual(injection.target, { tabId: 101, allFrames: true });
			assert.deepEqual(injection.files, ["content.js"]);
		},
	);

	await t.test(
		"sendToAnki button displays error when tab querying or injection fails",
		async () => {
			const originalQuery = mockChrome.tabs.query;
			mockChrome.tabs.query = async () => {
				throw new Error("No active tab found");
			};

			elements.sendToAnki.click();
			await new Promise((resolve) => setTimeout(resolve, 10));

			assert.equal(
				elements.status.textContent,
				"Error: No active tab found",
			);

			mockChrome.tabs.query = originalQuery;
		},
	);
});

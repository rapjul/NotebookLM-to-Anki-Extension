/**
 * @fileoverview Unit test suite for background service worker (src/background.js).
 * Tests message routing, AnkiConnect HTTP requests, model creation, and batch export flows.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../src/utils.js";
import { createMockChrome, createMockFetch } from "../helpers/mock-chrome.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

/**
 * Raw standard quiz fixture data.
 * @type {object}
 */
const rawQuiz = JSON.parse(
	fs.readFileSync(path.join(FIXTURES_DIR, "standard-quiz.json"), "utf8"),
);

/**
 * Normalized cards mapped from standard quiz fixture.
 * @type {Array<object>}
 */
const standardCards = NotebookLMToAnkiUtils.mapQuizDataToCards(rawQuiz.quiz);

/**
 * Helper to dispatch a message to the background service worker message listener.
 *
 * @param {function(object, object, function(object): void): boolean} listener - Registered background message listener.
 * @param {object} message - Message payload to send.
 * @returns {Promise<object>} Response returned via sendResponse.
 */
function sendRuntimeMessage(listener, message) {
	return new Promise((resolve) => {
		listener(message, { id: "test-sender" }, (response) => {
			resolve(response);
		});
	});
}

// Setup environment before importing background.js
const mockChrome = createMockChrome({ enableDebugLogging: false });
let fetchHandler = async () => ({
	ok: true,
	status: 200,
	json: async () => ({ result: 6, error: null }),
});

globalThis.self = globalThis;
globalThis.importScripts = () => {};
globalThis.chrome = mockChrome;
globalThis.fetch = (url, options) => fetchHandler(url, options);

await import("../../src/background.js");
const messageListener = mockChrome.runtime.onMessage.listeners[0];

test("background: service worker message routing and storage updates", async (t) => {
	assert.equal(
		typeof messageListener,
		"function",
		"Background script should register a runtime onMessage listener",
	);

	await t.test(
		"storage change listener dynamically updates debug state",
		() => {
			// Dispatch storage update
			mockChrome.storage.onChanged.dispatch({
				enableDebugLogging: { oldValue: false, newValue: true },
			});
			// Should execute cleanly without throwing
			assert.ok(true);
		},
	);

	await t.test(
		"checkAnkiStatus reports success when AnkiConnect returns version",
		async () => {
			fetchHandler = async (_url, options) => {
				const body = JSON.parse(options.body);
				assert.equal(body.action, "version");
				return {
					ok: true,
					status: 200,
					json: async () => 6,
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "checkAnkiStatus",
			});
			assert.equal(response.success, true);
			assert.equal(response.version, 6);
		},
	);

	await t.test(
		"checkAnkiStatus handles network offline failure",
		async () => {
			fetchHandler = async () => {
				throw new Error("Failed to fetch");
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "checkAnkiStatus",
			});
			assert.equal(response.success, false);
			assert.equal(response.error, "Connection Failed: Is Anki open?");
		},
	);

	await t.test(
		"checkDeckExists returns true when deck is present",
		async () => {
			fetchHandler = async (_url, options) => {
				const body = JSON.parse(options.body);
				assert.equal(body.action, "deckNames");
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: ["Default", "Chemistry::Basic"],
						error: null,
					}),
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "checkDeckExists",
				deckName: "Chemistry::Basic",
			});
			assert.equal(response.success, true);
			assert.equal(response.exists, true);
		},
	);

	await t.test(
		"checkDeckExists returns false when deck is absent",
		async () => {
			fetchHandler = async () => {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: ["Default"],
						error: null,
					}),
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "checkDeckExists",
				deckName: "Astronomy::Solar System",
			});
			assert.equal(response.success, true);
			assert.equal(response.exists, false);
		},
	);

	await t.test(
		"checkDeckExists handles AnkiConnect API error envelope",
		async () => {
			fetchHandler = async () => {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: null,
						error: "Permission denied",
					}),
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "checkDeckExists",
				deckName: "Chemistry::Basic",
			});
			assert.equal(response.success, false);
			assert.equal(response.error, "Permission denied");
		},
	);

	await t.test("checkDeckExists handles network rejection", async () => {
		fetchHandler = async () => {
			throw new Error("ECONNREFUSED");
		};

		const response = await sendRuntimeMessage(messageListener, {
			action: "checkDeckExists",
			deckName: "Chemistry::Basic",
		});
		assert.equal(response.success, false);
		assert.equal(response.error, "Connection Failed");
	});
});

test("background: model verification and batch export flows", async (t) => {
	const baseMockFetch = createMockFetch();

	/** @type {Array<{ action: string, params?: object }>} */
	const ankiCalls = [];

	/**
	 * Custom responder handling AnkiConnect requests and delegating extension templates.
	 *
	 * @param {string} url - Target URL.
	 * @param {object} [options={}] - Fetch options.
	 * @returns {Promise<object>} HTTP response.
	 */
	const customFetch = async (url, options = {}) => {
		if (url.startsWith("chrome-extension://")) {
			return baseMockFetch(url, options);
		}

		if (options.body) {
			const parsed = JSON.parse(options.body);
			ankiCalls.push(parsed);

			if (parsed.action === "modelNames") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: ["NotebookLM Quiz"],
						error: null,
					}),
				};
			}

			if (parsed.action === "createDeck") {
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: 123456789, error: null }),
				};
			}

			if (parsed.action === "deleteDecks") {
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: null, error: null }),
				};
			}

			if (parsed.action === "findNotes") {
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: [1001], error: null }),
				};
			}

			if (parsed.action === "notesInfo") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: [
							{
								fields: {
									Question: {
										value: standardCards[0].question,
									},
								},
							},
						],
						error: null,
					}),
				};
			}

			if (parsed.action === "addNotes") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: parsed.params.notes.map((_, i) => 2000 + i),
						error: null,
					}),
				};
			}
		}

		return {
			ok: true,
			status: 200,
			json: async () => ({ result: null, error: null }),
		};
	};

	fetchHandler = customFetch;

	await t.test(
		"sendBatchToAnki with merge action filters duplicates and adds remaining notes",
		async () => {
			ankiCalls.length = 0;
			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids and Bases",
				duplicateAction: "merge",
				batchData: standardCards,
			});

			assert.equal(response.success, true);
			assert.equal(response.count, standardCards.length - 1);
			assert.equal(response.skipped, 1);

			const actions = ankiCalls.map((c) => c.action);
			assert.ok(actions.includes("modelNames"));
			assert.ok(actions.includes("createDeck"));
			assert.ok(actions.includes("findNotes"));
			assert.ok(actions.includes("notesInfo"));
			assert.ok(actions.includes("addNotes"));
		},
	);

	await t.test(
		"sendBatchToAnki returns count 0 when all notes are filtered out as duplicates",
		async () => {
			ankiCalls.length = 0;
			const duplicateData = [standardCards[0]];

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids and Bases",
				duplicateAction: "merge",
				batchData: duplicateData,
			});

			assert.equal(response.success, true);
			assert.equal(response.count, 0);
			assert.equal(response.skipped, 1);
		},
	);

	await t.test(
		"sendBatchToAnki with merge action proceeds with all notes when target deck is empty",
		async () => {
			ankiCalls.length = 0;
			fetchHandler = async (url, options = {}) => {
				if (url.startsWith("chrome-extension://")) {
					return baseMockFetch(url, options);
				}
				const parsed = JSON.parse(options.body);
				ankiCalls.push(parsed);
				if (parsed.action === "modelNames") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							result: ["NotebookLM Quiz"],
							error: null,
						}),
					};
				}
				if (parsed.action === "createDeck") {
					return {
						ok: true,
						status: 200,
						json: async () => ({ result: 101, error: null }),
					};
				}
				if (parsed.action === "findNotes") {
					return {
						ok: true,
						status: 200,
						json: async () => ({ result: [], error: null }),
					};
				}
				if (parsed.action === "addNotes") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							result: parsed.params.notes.map((_, i) => 3000 + i),
							error: null,
						}),
					};
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: null, error: null }),
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "EmptyDeck",
				duplicateAction: "merge",
				batchData: standardCards,
			});

			assert.equal(response.success, true);
			assert.equal(response.count, standardCards.length);
			assert.equal(response.skipped, 0);
		},
	);

	await t.test(
		"sendBatchToAnki with merge action catches findNotes failure and proceeds with all notes",
		async () => {
			ankiCalls.length = 0;
			fetchHandler = async (url, options = {}) => {
				if (url.startsWith("chrome-extension://")) {
					return baseMockFetch(url, options);
				}
				const parsed = JSON.parse(options.body);
				ankiCalls.push(parsed);
				if (parsed.action === "modelNames") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							result: ["NotebookLM Quiz"],
							error: null,
						}),
					};
				}
				if (parsed.action === "createDeck") {
					return {
						ok: true,
						status: 200,
						json: async () => ({ result: 101, error: null }),
					};
				}
				if (parsed.action === "findNotes") {
					throw new Error("Simulated findNotes network error");
				}
				if (parsed.action === "addNotes") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							result: parsed.params.notes.map((_, i) => 4000 + i),
							error: null,
						}),
					};
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: null, error: null }),
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "FaultyFindDeck",
				duplicateAction: "merge",
				batchData: standardCards,
			});

			assert.equal(response.success, true);
			assert.equal(response.count, standardCards.length);
			assert.equal(response.skipped, 0);
		},
	);

	await t.test(
		"sendBatchToAnki with overwrite action deletes deck before recreating and adding notes",
		async () => {
			ankiCalls.length = 0;
			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "NotebookLM::Chemistry::Quizzes::Acids and Bases",
				duplicateAction: "overwrite",
				batchData: standardCards,
			});

			assert.equal(response.success, true);
			assert.equal(response.count, standardCards.length);
			assert.equal(response.skipped, 0);

			const actions = ankiCalls.map((c) => c.action);
			const deleteIndex = actions.indexOf("deleteDecks");
			const createIndex = actions.indexOf("createDeck");
			const addIndex = actions.indexOf("addNotes");

			assert.ok(deleteIndex !== -1, "deleteDecks should be called");
			assert.ok(
				createIndex > deleteIndex,
				"createDeck must be called after deleteDecks",
			);
			assert.ok(
				addIndex > createIndex,
				"addNotes must be called after createDeck",
			);
		},
	);

	await t.test(
		"sendBatchToAnki with increment action adds notes without deleting",
		async () => {
			ankiCalls.length = 0;
			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle:
					"NotebookLM::Chemistry::Quizzes::Acids and Bases (1)",
				duplicateAction: "increment",
				batchData: standardCards,
			});

			assert.equal(response.success, true);
			assert.equal(response.count, standardCards.length);
			assert.equal(response.skipped, 0);

			const actions = ankiCalls.map((c) => c.action);
			assert.ok(
				!actions.includes("deleteDecks"),
				"increment should not delete existing deck",
			);
			assert.ok(actions.includes("createDeck"));
			assert.ok(actions.includes("addNotes"));
		},
	);

	await t.test("sendBatchToAnki handles createDeck error", async () => {
		fetchHandler = async (url, options = {}) => {
			if (url.startsWith("chrome-extension://")) {
				return baseMockFetch(url, options);
			}
			const parsed = JSON.parse(options.body);
			if (parsed.action === "modelNames") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: ["NotebookLM Quiz"],
						error: null,
					}),
				};
			}
			if (parsed.action === "createDeck") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: null,
						error: "Cannot create deck with illegal character",
					}),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: null, error: null }),
			};
		};

		const response = await sendRuntimeMessage(messageListener, {
			action: "sendBatchToAnki",
			deckTitle: "Invalid::Deck",
			duplicateAction: "increment",
			batchData: standardCards,
		});

		assert.equal(response.success, false);
		assert.ok(
			response.error.includes(
				"Cannot create deck with illegal character",
			),
		);
	});

	await t.test("sendBatchToAnki handles addNotes API error", async () => {
		fetchHandler = async (url, options = {}) => {
			if (url.startsWith("chrome-extension://")) {
				return baseMockFetch(url, options);
			}
			const parsed = JSON.parse(options.body);
			if (parsed.action === "modelNames") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: ["NotebookLM Quiz"],
						error: null,
					}),
				};
			}
			if (parsed.action === "createDeck") {
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: 12345, error: null }),
				};
			}
			if (parsed.action === "addNotes") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						result: null,
						error: "model 'NotebookLM Quiz' not found",
					}),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: null, error: null }),
			};
		};

		const response = await sendRuntimeMessage(messageListener, {
			action: "sendBatchToAnki",
			deckTitle: "Deck",
			duplicateAction: "increment",
			batchData: standardCards,
		});

		assert.equal(response.success, false);
		assert.ok(
			response.error.includes(
				"Anki Error: model 'NotebookLM Quiz' not found",
			),
		);
	});
});

test("background: model auto-creation when missing in Anki", async (t) => {
	const baseMockFetch = createMockFetch();
	let modelCreated = false;

	fetchHandler = async (url, options = {}) => {
		if (url.startsWith("chrome-extension://")) {
			return baseMockFetch(url, options);
		}

		const parsed = JSON.parse(options.body);
		if (parsed.action === "modelNames") {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					result: ["Basic", "Cloze"],
					error: null,
				}),
			};
		}

		if (parsed.action === "createModel") {
			modelCreated = true;
			assert.equal(parsed.params.modelName, "NotebookLM Quiz");
			assert.ok(Array.isArray(parsed.params.inOrderFields));
			assert.equal(parsed.params.inOrderFields.length, 15);
			assert.ok(parsed.params.css.includes(".quiz-column"));
			assert.ok(
				parsed.params.cardTemplates[0].Front.includes("{{Question}}"),
			);
			assert.ok(
				parsed.params.cardTemplates[0].Back.includes("{{Question}}"),
			);
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: { id: 987654 }, error: null }),
			};
		}

		if (parsed.action === "createDeck") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: 111, error: null }),
			};
		}

		if (parsed.action === "addNotes") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: [1], error: null }),
			};
		}

		return {
			ok: true,
			status: 200,
			json: async () => ({ result: null, error: null }),
		};
	};

	await t.test(
		"automatically fetches templates and creates model when absent",
		async () => {
			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "AutoCreateModelDeck",
				duplicateAction: "increment",
				batchData: [standardCards[0]],
			});

			assert.equal(response.success, true);
			assert.equal(
				modelCreated,
				true,
				"createModel should have been called",
			);
		},
	);

	await t.test(
		"propagates error when createModel fails in Anki",
		async () => {
			fetchHandler = async (url, options = {}) => {
				if (url.startsWith("chrome-extension://")) {
					return baseMockFetch(url, options);
				}
				const parsed = JSON.parse(options.body);
				if (parsed.action === "modelNames") {
					return {
						ok: true,
						status: 200,
						json: async () => ({ result: ["Basic"], error: null }),
					};
				}
				if (parsed.action === "createModel") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							result: null,
							error: "model already exists in collection",
						}),
					};
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ result: null, error: null }),
				};
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "FailedModelDeck",
				duplicateAction: "increment",
				batchData: [standardCards[0]],
			});

			assert.equal(response.success, false);
			assert.ok(
				response.error.includes(
					"Failed to create note type: model already exists in collection",
				),
			);
		},
	);
});

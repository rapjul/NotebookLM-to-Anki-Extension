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
			assert.equal(parsed.params.inOrderFields.length, 20);
			assert.ok(parsed.params.inOrderFields.includes("Image"));
			assert.ok(parsed.params.inOrderFields.includes("QuestionType"));
			assert.ok(parsed.params.inOrderFields.includes("TargetAnswer"));
			assert.ok(
				parsed.params.inOrderFields.includes("AcceptableAnswers"),
			);
			assert.ok(parsed.params.inOrderFields.includes("Rubric"));
			assert.ok(parsed.params.inOrderFields.includes("GeneralRationale"));
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

test("background: model schema migration for existing Note Type", async (t) => {
	const baseMockFetch = createMockFetch();
	const migrationCalls = [];

	fetchHandler = async (url, options = {}) => {
		if (url.startsWith("chrome-extension://")) {
			return baseMockFetch(url, options);
		}

		const parsed = JSON.parse(options.body);
		migrationCalls.push(parsed);

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

		if (parsed.action === "modelFieldNames") {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					result: [
						"Question",
						"Hint",
						"ArchDiagram",
						"Option1",
						"Rationale1",
						"Flag1",
						"Option2",
						"Flag2",
						"Rationale2",
						"Option3",
						"Flag3",
						"Rationale3",
						"Option4",
						"Flag4",
						"Rationale4",
					],
					error: null,
				}),
			};
		}

		if (parsed.action === "modelFieldRename") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: null, error: null }),
			};
		}

		if (parsed.action === "modelFieldAdd") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: null, error: null }),
			};
		}

		if (parsed.action === "updateModelTemplates") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: null, error: null }),
			};
		}

		if (parsed.action === "updateModelStyling") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: null, error: null }),
			};
		}

		if (parsed.action === "createDeck") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: 501, error: null }),
			};
		}

		if (parsed.action === "addNotes") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: [5001], error: null }),
			};
		}

		return {
			ok: true,
			status: 200,
			json: async () => ({ result: null, error: null }),
		};
	};

	await t.test(
		"renames ArchDiagram to Image and adds missing adaptive fields",
		async () => {
			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "MigrateModelDeck",
				duplicateAction: "increment",
				batchData: [standardCards[0]],
			});

			assert.equal(response.success, true);

			const renames = migrationCalls.filter(
				(c) => c.action === "modelFieldRename",
			);
			assert.equal(renames.length, 1);
			assert.equal(renames[0].params.oldFieldName, "ArchDiagram");
			assert.equal(renames[0].params.newFieldName, "Image");

			const additions = migrationCalls.filter(
				(c) => c.action === "modelFieldAdd",
			);
			const addedNames = additions.map((c) => c.params.fieldName);
			assert.ok(addedNames.includes("QuestionType"));
			assert.ok(addedNames.includes("TargetAnswer"));
			assert.ok(addedNames.includes("AcceptableAnswers"));
			assert.ok(addedNames.includes("Rubric"));
			assert.ok(addedNames.includes("GeneralRationale"));
		},
	);
});

test("background: media downloading and embedding", async (t) => {
	const baseMockFetch = createMockFetch();
	const ankiCalls = [];

	fetchHandler = async (url, options = {}) => {
		if (url.startsWith("chrome-extension://")) {
			return baseMockFetch(url, options);
		}

		if (url.startsWith("https://lh3.googleusercontent.com/")) {
			if (url.includes("fail")) {
				return {
					ok: false,
					status: 404,
					statusText: "Not Found",
					headers: { get: () => "text/plain" },
					arrayBuffer: async () => new Uint8Array([]).buffer,
				};
			}
			if (url.includes("html-redirect")) {
				const encoder = new TextEncoder();
				return {
					ok: true,
					status: 200,
					statusText: "OK",
					redirected: true,
					url: "https://accounts.google.com/v3/signin/",
					headers: { get: () => "text/html" },
					arrayBuffer: async () =>
						encoder.encode(
							'<!doctype html><html lang="en"><head><base href="https://accounts.google.com/v3/signin/">',
						).buffer,
				};
			}
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {
					get: (h) =>
						h.toLowerCase() === "content-type" ? "image/png" : null,
				},
				arrayBuffer: async () =>
					new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
			};
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
				json: async () => ({ result: 601, error: null }),
			};
		}

		if (parsed.action === "storeMediaFile") {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					result: parsed.params.filename,
					error: null,
				}),
			};
		}

		if (parsed.action === "addNotes") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: [6001], error: null }),
			};
		}

		return {
			ok: true,
			status: 200,
			json: async () => ({ result: null, error: null }),
		};
	};

	await t.test(
		"downloads diagramUrl in browser, converts to base64, and persists via storeMediaFile",
		async () => {
			const cardWithMedia = {
				question: "What does this circuit diagram depict?",
				hint: "Check polarity",
				diagramUrl:
					"https://lh3.googleusercontent.com/test-circuit-symbol.png",
				diagramAlt: "Circuit Diagram",
				diagramCaption: "Figure 1.1 Schematic",
				option1: "Voltage Source",
				flag1: "True",
				rationale1: "Polarity indicates voltage",
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "MediaDeck",
				duplicateAction: "increment",
				batchData: [cardWithMedia],
				topicsCovered: ["Circuits", "Ohm's Law"],
			});

			assert.equal(response.success, true);

			const mediaCall = ankiCalls.find(
				(c) => c.action === "storeMediaFile",
			);
			assert.ok(mediaCall, "storeMediaFile should have been called");
			assert.ok(
				mediaCall.params.data,
				"storeMediaFile should receive base64 encoded data",
			);
			assert.ok(
				mediaCall.params.filename.startsWith("notebooklm_"),
				"filename should start with notebooklm_",
			);

			const addNotesCall = ankiCalls.find((c) => c.action === "addNotes");
			assert.ok(addNotesCall, "addNotes should have been called");
			const note = addNotesCall.params.notes[0];
			assert.ok(
				note.fields.Image.includes(
					`<img src="${mediaCall.params.filename}" alt="Circuit Diagram" title="Circuit Diagram">`,
				),
			);
			assert.ok(
				note.fields.Image.includes(
					'<div class="diagram-caption">Figure 1.1 Schematic</div>',
				),
			);
			assert.ok(
				note.tags.includes("Circuits"),
				"Topic tags should be included in note",
			);
		},
	);

	await t.test(
		"handles image download failure gracefully by inserting placeholder and completing export",
		async () => {
			const cardWithFailedMedia = {
				question: "What is depicted in this missing diagram?",
				hint: "Inspect caption",
				diagramUrl:
					"https://lh3.googleusercontent.com/fail-circuit.png",
				diagramAlt: "Missing Circuit",
				diagramCaption: "Figure 2.1 Missing Schematic",
				option1: "Resistor",
				flag1: "True",
				rationale1: "A standard resistor",
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "FailedMediaDeck",
				duplicateAction: "increment",
				batchData: [cardWithFailedMedia],
			});

			assert.equal(response.success, true);

			const addNotesCall = ankiCalls.find(
				(c) =>
					c.action === "addNotes" &&
					c.params.notes[0].fields.Question.includes(
						"missing diagram",
					),
			);
			assert.ok(addNotesCall, "addNotes should have been called");
			const note = addNotesCall.params.notes[0];
			assert.ok(
				note.fields.Image.includes("diagram-placeholder"),
				"Image field should contain diagram-placeholder",
			);
			assert.ok(
				note.fields.Image.includes("Diagram unavailable"),
				"Image field should contain error notice",
			);
			assert.ok(
				note.fields.Image.includes("Figure 2.1 Missing Schematic"),
				"Image field should preserve caption text",
			);
		},
	);

	await t.test(
		"rejects HTML sign-in redirect payload even if HTTP 200, inserting placeholder instead of saving HTML file",
		async () => {
			const cardWithHtmlMedia = {
				question: "What is depicted in this html-redirect diagram?",
				hint: "Check schematic",
				diagramUrl:
					"https://lh3.googleusercontent.com/html-redirect-diagram.png",
				diagramAlt: "Circuit Diagram",
				diagramCaption: "Figure 3.1 Schematic",
				option1: "Capacitor",
				flag1: "True",
				rationale1: "A standard capacitor",
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "HtmlRedirectDeck",
				duplicateAction: "increment",
				batchData: [cardWithHtmlMedia],
			});

			assert.equal(response.success, true);

			// Verify storeMediaFile was NOT called with HTML payload
			const storeMediaCall = ankiCalls.find(
				(c) =>
					c.action === "storeMediaFile" &&
					c.params.filename.includes("html-redirect"),
			);
			assert.equal(
				storeMediaCall,
				undefined,
				"storeMediaFile should NOT be called for HTML payloads",
			);

			const addNotesCall = ankiCalls.find(
				(c) =>
					c.action === "addNotes" &&
					c.params.notes[0].fields.Question.includes("html-redirect"),
			);
			assert.ok(addNotesCall, "addNotes should have been called");
			const note = addNotesCall.params.notes[0];
			assert.ok(
				note.fields.Image.includes("diagram-placeholder"),
				"Image field should contain diagram-placeholder",
			);
			assert.ok(
				note.fields.Image.includes("Diagram unavailable"),
				"Image field should contain error notice",
			);
			assert.ok(
				note.fields.Image.includes("Figure 3.1 Schematic"),
				"Image field should preserve caption text",
			);
		},
	);

	await t.test(
		"persists pre-resolved imageBase64 directly via storeMediaFile without fetching network",
		async () => {
			const cardWithPreResolvedMedia = {
				question: "What does this pre-resolved diagram depict?",
				hint: "Check polarity",
				diagramUrl:
					"https://lh3.googleusercontent.com/test-circuit-topwindow.png",
				imageBase64:
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
				imageFormat: "png",
				diagramAlt: "Pre-resolved Circuit Diagram",
				diagramCaption: "Figure 4.1 Schematic",
				option1: "Current Source",
				flag1: "True",
				rationale1: "Polarity indicates current",
			};

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "PreResolvedDeck",
				duplicateAction: "increment",
				batchData: [cardWithPreResolvedMedia],
				topicsCovered: ["Circuits"],
			});

			assert.equal(response.success, true);
			assert.equal(response.imagesFound, 1);
			assert.equal(response.imagesExported, 1);

			const mediaCall = ankiCalls.find(
				(c) =>
					c.action === "storeMediaFile" &&
					c.params.data === cardWithPreResolvedMedia.imageBase64,
			);
			assert.ok(
				mediaCall,
				"storeMediaFile should have been called with pre-resolved Base64 data",
			);
			assert.ok(
				mediaCall.params.filename.endsWith(".png"),
				"filename should end with .png detected format",
			);

			const addNotesCall = ankiCalls.find(
				(c) =>
					c.action === "addNotes" &&
					c.params.notes[0].fields.Question.includes(
						"pre-resolved diagram depict",
					),
			);
			assert.ok(addNotesCall, "addNotes should have been called");
			const note = addNotesCall.params.notes[0];
			assert.ok(
				note.fields.Image.includes(
					`<img src="${mediaCall.params.filename}" alt="Pre-resolved Circuit Diagram" title="Pre-resolved Circuit Diagram">`,
				),
			);
		},
	);

	await t.test(
		"reports imagesFound and imagesExported counts accurately in response envelope",
		async () => {
			const mixedBatch = [
				{
					question: "Q1 with valid media",
					diagramUrl: "https://lh3.googleusercontent.com/q1.png",
					imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
					imageFormat: "png",
					diagramAlt: "Alt1",
					hasMediaReference: true,
					option1: "A",
					flag1: "True",
				},
				{
					question: "Q2 without media",
					diagramUrl: "",
					hasMediaReference: false,
					option1: "B",
					flag1: "True",
				},
			];

			const response = await sendRuntimeMessage(messageListener, {
				action: "sendBatchToAnki",
				deckTitle: "ReportDeck",
				duplicateAction: "increment",
				batchData: mixedBatch,
				imagesFound: 1,
			});

			assert.equal(response.success, true);
			assert.equal(response.imagesFound, 1);
			assert.equal(response.imagesExported, 1);
		},
	);

	await t.test(
		"preserves imagesFound, imagesExported, and mediaLogs in error response envelope when note creation fails",
		async () => {
			const origFetchHandler = fetchHandler;
			fetchHandler = async (url, options) => {
				if (options?.body) {
					try {
						const body = JSON.parse(options.body);
						if (body.action === "addNotes") {
							throw new Error("AnkiConnect database locked");
						}
					} catch (e) {
						if (e.message === "AnkiConnect database locked") throw e;
					}
				}
				return origFetchHandler(url, options);
			};

			try {
				const response = await sendRuntimeMessage(messageListener, {
					action: "sendBatchToAnki",
					deckTitle: "FailDeck",
					duplicateAction: "increment",
					batchData: [
						{
							question: "Q with media that fails on addNotes",
							diagramUrl:
								"https://lh3.googleusercontent.com/success-media.png",
							imageBase64:
								"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
							imageFormat: "png",
							diagramAlt: "FailAlt",
							hasMediaReference: true,
							option1: "A",
							flag1: "True",
						},
					],
					imagesFound: 1,
				});

				assert.equal(response.success, false);
				assert.ok(response.error.includes("AnkiConnect database locked"));
				assert.equal(response.imagesFound, 1);
				assert.equal(response.imagesExported, 1);
				assert.ok(Array.isArray(response.mediaLogs));
				assert.ok(response.mediaLogs.length >= 1);
				assert.ok(
					response.mediaLogs.some((log) =>
						log.includes("Successfully"),
					),
				);
			} finally {
				fetchHandler = origFetchHandler;
			}
		},
	);

	await t.test(
		"downloads and persists AVIF format images via storeMediaFile",
		async () => {
			const ankiCalls = [];
			const origFetchHandler = fetchHandler;

			// Construct synthetic AVIF binary buffer (ftypavif box)
			const avifBytes = new Uint8Array([
				0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76,
				0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
			]);

			fetchHandler = async (url, options) => {
				if (url.includes("lh3.googleusercontent.com")) {
					return {
						ok: true,
						status: 200,
						headers: {
							get: (h) =>
								h === "content-type" ? "image/avif" : null,
						},
						arrayBuffer: async () => avifBytes.buffer,
					};
				}
				const parsed = options?.body ? JSON.parse(options.body) : {};
				ankiCalls.push(parsed);
				return origFetchHandler(url, options);
			};

			try {
				const cardWithAvifMedia = {
					question: "What is depicted in this AVIF schematic?",
					diagramUrl:
						"https://lh3.googleusercontent.com/schematic.avif",
					diagramAlt: "AVIF Schematic",
					hasMediaReference: true,
					option1: "A",
					flag1: "True",
				};

				const response = await sendRuntimeMessage(messageListener, {
					action: "sendBatchToAnki",
					deckTitle: "AvifDeck",
					duplicateAction: "increment",
					batchData: [cardWithAvifMedia],
				});

				assert.equal(response.success, true);
				assert.equal(response.imagesExported, 1);

				const storeMediaCall = ankiCalls.find(
					(c) =>
						c.action === "storeMediaFile" &&
						c.params.filename.endsWith(".avif"),
				);
				assert.ok(
					storeMediaCall,
					"storeMediaFile should have been called with .avif filename",
				);
			} finally {
				fetchHandler = origFetchHandler;
			}
		},
	);
});

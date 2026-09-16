// tests/integration/anki-connect.test.js - Integration contract tests for AnkiConnect API communication

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	mapQuizDataToCards,
	mapCardsToAnkiNotes,
	filterDuplicateNotes,
	normalizeQuestionText,
} from "../helpers/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../fixtures");

/**
 * Helper to load and parse a JSON fixture file.
 *
 * @param {string} filename - The fixture file name.
 * @returns {object} The parsed JSON content.
 */
function loadFixture(filename) {
	const filePath = path.join(fixturesDir, filename);
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Simulates the AnkiConnect request dispatcher for testing background export workflows.
 *
 * @param {string} action - AnkiConnect action name.
 * @param {object} [params={}] - Action parameters.
 * @param {number} [version=6] - API version.
 * @returns {Promise<object>} JSON response from AnkiConnect.
 */
async function callAnkiConnect(action, params = {}, version = 6) {
	const res = await fetch("http://127.0.0.1:8765", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, version, params }),
	});
	return res.json();
}

test("integration: AnkiConnect status checks", async (t) => {
	await t.test(
		"reports success when AnkiConnect returns version 6",
		async () => {
			t.mock.method(globalThis, "fetch", async (url, options) => {
				assert.equal(url, "http://127.0.0.1:8765");
				const body = JSON.parse(options.body);
				assert.equal(body.action, "version");

				return {
					ok: true,
					status: 200,
					json: async () => ({ result: 6, error: null }),
				};
			});

			const data = await callAnkiConnect("version");
			assert.equal(data.result, 6);
			assert.equal(data.error, null);
		},
	);

	await t.test(
		"handles network failure when Anki desktop is closed",
		async () => {
			t.mock.method(globalThis, "fetch", async () => {
				throw new Error("fetch failed: ECONNREFUSED");
			});

			await assert.rejects(
				async () => {
					await callAnkiConnect("version");
				},
				{ message: /fetch failed/ },
			);
		},
	);
});

test("integration: deck existence queries", async (t) => {
	await t.test("identifies whether target deck exists in Anki", async () => {
		const existingDecks = [
			"Default",
			"NotebookLM::Astronomy::Quizzes::Planets",
			"Science::Chemistry",
		];

		t.mock.method(globalThis, "fetch", async (url, options) => {
			const body = JSON.parse(options.body);
			assert.equal(body.action, "deckNames");
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: existingDecks, error: null }),
			};
		});

		const data = await callAnkiConnect("deckNames");
		assert.equal(data.error, null);
		assert.equal(
			data.result.includes("NotebookLM::Astronomy::Quizzes::Planets"),
			true,
		);
		assert.equal(
			data.result.includes("NotebookLM::Nonexistent::Quizzes::Test"),
			false,
		);
	});
});

test("integration: batch export with merge (skip duplicates)", async (t) => {
	await t.test(
		"queries existing notes and only inserts non-duplicate cards",
		async () => {
			const standardData = loadFixture("standard-quiz.json");
			const cards = mapQuizDataToCards(standardData.quiz);
			const targetDeck =
				"NotebookLM::Chemistry & Astronomy::Quizzes::Test";
			const notes = mapCardsToAnkiNotes(cards, targetDeck);

			// First question already exists in Anki
			const existingQuestionText = cards[0].question;
			const callHistory = [];

			t.mock.method(globalThis, "fetch", async (url, options) => {
				const body = JSON.parse(options.body);
				callHistory.push(body.action);

				if (body.action === "createDeck") {
					assert.equal(body.params.deck, targetDeck);
					return {
						ok: true,
						json: async () => ({ result: 123456789, error: null }),
					};
				}

				if (body.action === "findNotes") {
					assert.equal(body.params.query, `deck:"${targetDeck}"`);
					return {
						ok: true,
						json: async () => ({ result: [101], error: null }),
					};
				}

				if (body.action === "notesInfo") {
					assert.deepEqual(body.params.notes, [101]);
					return {
						ok: true,
						json: async () => ({
							result: [
								{
									noteId: 101,
									fields: {
										Question: {
											value: existingQuestionText,
										},
									},
								},
							],
							error: null,
						}),
					};
				}

				if (body.action === "addNotes") {
					assert.equal(body.params.notes.length, 3);
					return {
						ok: true,
						json: async () => ({
							result: [201, 202, 203],
							error: null,
						}),
					};
				}

				throw new Error(`Unexpected action: ${body.action}`);
			});

			// 1. Create deck
			const createDeckRes = await callAnkiConnect("createDeck", {
				deck: targetDeck,
			});
			assert.equal(createDeckRes.error, null);

			// 2. Find existing notes
			const findNotesRes = await callAnkiConnect("findNotes", {
				query: `deck:"${targetDeck}"`,
			});
			const noteIds = findNotesRes.result;

			// 3. Query notesInfo and filter duplicates
			const notesInfoRes = await callAnkiConnect("notesInfo", {
				notes: noteIds,
			});
			const existingSet = new Set();
			for (const note of notesInfoRes.result) {
				if (note.fields?.Question?.value) {
					existingSet.add(
						normalizeQuestionText(note.fields.Question.value),
					);
				}
			}

			const { notesToSend, skippedCount } = filterDuplicateNotes(
				notes,
				existingSet,
			);

			assert.equal(notesToSend.length, 3);
			assert.equal(skippedCount, 1);

			// 4. Add notes
			const addNotesRes = await callAnkiConnect("addNotes", {
				notes: notesToSend,
			});
			assert.equal(addNotesRes.error, null);
			assert.equal(addNotesRes.result.length, 3);

			// Verify API interaction flow
			assert.deepEqual(callHistory, [
				"createDeck",
				"findNotes",
				"notesInfo",
				"addNotes",
			]);
		},
	);
});

test("integration: batch export with overwrite", async (t) => {
	await t.test(
		"deletes target deck and recreates it before adding all notes",
		async () => {
			const targetDeck =
				"NotebookLM::Chemistry & Astronomy::Quizzes::Test";
			const standardData = loadFixture("standard-quiz.json");
			const cards = mapQuizDataToCards(standardData.quiz);
			const notes = mapCardsToAnkiNotes(cards, targetDeck);

			const callHistory = [];

			t.mock.method(globalThis, "fetch", async (url, options) => {
				const body = JSON.parse(options.body);
				callHistory.push(body.action);

				if (body.action === "deleteDecks") {
					assert.deepEqual(body.params.decks, [targetDeck]);
					assert.equal(body.params.cardsToo, true);
					return {
						ok: true,
						json: async () => ({ result: null, error: null }),
					};
				}

				if (body.action === "createDeck") {
					return {
						ok: true,
						json: async () => ({ result: 987654321, error: null }),
					};
				}

				if (body.action === "addNotes") {
					assert.equal(body.params.notes.length, notes.length);
					return {
						ok: true,
						json: async () => ({
							result: [301, 302, 303, 304],
							error: null,
						}),
					};
				}

				throw new Error(`Unexpected action: ${body.action}`);
			});

			// 1. Delete deck
			await callAnkiConnect("deleteDecks", {
				decks: [targetDeck],
				cardsToo: true,
			});

			// 2. Recreate deck
			await callAnkiConnect("createDeck", { deck: targetDeck });

			// 3. Add all notes
			const addRes = await callAnkiConnect("addNotes", { notes });
			assert.equal(addRes.result.length, 4);

			assert.deepEqual(callHistory, [
				"deleteDecks",
				"createDeck",
				"addNotes",
			]);
		},
	);
});

test("integration: AnkiConnect API error propagation", async (t) => {
	await t.test(
		"returns descriptive error response when AnkiConnect rejects note creation",
		async () => {
			t.mock.method(globalThis, "fetch", async () => {
				return {
					ok: true,
					json: async () => ({
						result: null,
						error: "cannot create note because model does not exist",
					}),
				};
			});

			const res = await callAnkiConnect("addNotes", { notes: [] });
			assert.equal(
				res.error,
				"cannot create note because model does not exist",
			);
			assert.equal(res.result, null);
		},
	);
});

test("integration: media file storage and model schema contract", async (t) => {
	await t.test(
		"storeMediaFile contracts with AnkiConnect media storage endpoint",
		async () => {
			t.mock.method(globalThis, "fetch", async (url, options) => {
				const body = JSON.parse(options.body);
				assert.equal(body.action, "storeMediaFile");
				assert.equal(body.params.filename, "notebooklm_test_0.png");
				assert.equal(
					body.params.url,
					"https://lh3.googleusercontent.com/test.png",
				);
				return {
					ok: true,
					json: async () => ({
						result: "notebooklm_test_0.png",
						error: null,
					}),
				};
			});

			const res = await callAnkiConnect("storeMediaFile", {
				filename: "notebooklm_test_0.png",
				url: "https://lh3.googleusercontent.com/test.png",
			});
			assert.equal(res.result, "notebooklm_test_0.png");
			assert.equal(res.error, null);
		},
	);

	await t.test(
		"modelFieldRename and modelFieldAdd contract with AnkiConnect schema API",
		async () => {
			const actions = [];
			t.mock.method(globalThis, "fetch", async (url, options) => {
				const body = JSON.parse(options.body);
				actions.push(body.action);
				return {
					ok: true,
					json: async () => ({ result: null, error: null }),
				};
			});

			await callAnkiConnect("modelFieldRename", {
				modelName: "NotebookLM Quiz",
				oldFieldName: "ArchDiagram",
				newFieldName: "Image",
			});

			await callAnkiConnect("modelFieldAdd", {
				modelName: "NotebookLM Quiz",
				fieldName: "QuestionType",
			});

			assert.deepEqual(actions, ["modelFieldRename", "modelFieldAdd"]);
		},
	);
});

// tests/unit/formatter.test.js - Unit tests for formatting and normalization utilities

import test from "node:test";
import assert from "node:assert/strict";
import {
	unescapeHtml,
	cleanNotebookTitle,
	cleanQuizTitle,
	formatDeckTitle,
	formatErrorMessage,
} from "../helpers/utils.js";

test("formatter: unescapeHtml", async (t) => {
	await t.test("decodes all standard HTML entities", () => {
		const input = "&quot;Gold&quot; &amp; &lt;Silver&gt; isn&#39;t Bronze";
		const expected = '"Gold" & <Silver> isn\'t Bronze';
		assert.equal(unescapeHtml(input), expected);
	});

	await t.test("returns string unchanged if no entities exist", () => {
		const input = "Plain alphanumeric text with symbols: + - * /";
		assert.equal(unescapeHtml(input), input);
	});

	await t.test("handles empty and nullish inputs gracefully", () => {
		assert.equal(unescapeHtml(""), "");
		assert.equal(unescapeHtml(null), "");
		assert.equal(unescapeHtml(undefined), "");
	});
});

test("formatter: cleanNotebookTitle", async (t) => {
	await t.test("trims and leaves clean titles unchanged", () => {
		assert.equal(
			cleanNotebookTitle("  Inorganic Chemistry 101  "),
			"Inorganic Chemistry 101",
		);
	});

	await t.test("replaces subdeck delimiter colons with dashes", () => {
		assert.equal(
			cleanNotebookTitle("Science::Chemistry::Periodic Table"),
			"Science - Chemistry - Periodic Table",
		);
	});

	await t.test(
		"replaces default NotebookLM title with Unknown Notebook",
		() => {
			assert.equal(cleanNotebookTitle("NotebookLM"), "Unknown Notebook");
			assert.equal(cleanNotebookTitle(""), "Unknown Notebook");
			assert.equal(cleanNotebookTitle(null), "Unknown Notebook");
			assert.equal(cleanNotebookTitle(undefined), "Unknown Notebook");
		},
	);
});

test("formatter: cleanQuizTitle", async (t) => {
	await t.test("strips 'Quiz | ' prefix", () => {
		assert.equal(
			cleanQuizTitle("Quiz | Orbital Mechanics"),
			"Orbital Mechanics",
		);
	});

	await t.test("strips 'Quiz - ' prefix", () => {
		assert.equal(
			cleanQuizTitle("Quiz - Planetary Motion"),
			"Planetary Motion",
		);
	});

	await t.test("strips 'Quiz: ' prefix case-insensitively", () => {
		assert.equal(
			cleanQuizTitle("quiz: Stellar Classification"),
			"Stellar Classification",
		);
	});

	await t.test("strips ' Quiz' suffix case-insensitively", () => {
		assert.equal(cleanQuizTitle("Acids and Bases quiz"), "Acids and Bases");
		assert.equal(
			cleanQuizTitle("Electrochemistry Quiz"),
			"Electrochemistry",
		);
	});

	await t.test("strips both prefix and suffix cleanly", () => {
		assert.equal(
			cleanQuizTitle("Quiz: Quantum Physics Quiz"),
			"Quantum Physics",
		);
	});

	await t.test("replaces subdeck colons with dashes", () => {
		assert.equal(
			cleanQuizTitle("Quiz | Astronomy::Solar System"),
			"Astronomy - Solar System",
		);
	});

	await t.test("defaults to 'Quiz' when title is empty or null", () => {
		assert.equal(cleanQuizTitle(""), "Quiz");
		assert.equal(cleanQuizTitle(null), "Quiz");
		assert.equal(cleanQuizTitle(undefined), "Quiz");
	});
});

test("formatter: formatDeckTitle", async (t) => {
	await t.test("applies default template with clean titles", () => {
		const result = formatDeckTitle(
			"Physical Chemistry",
			"Quiz | Thermodynamics Quiz",
		);
		assert.equal(
			result,
			"NotebookLM::Physical Chemistry::Quizzes::Thermodynamics",
		);
	});

	await t.test("handles colons in notebook and quiz titles safely", () => {
		const result = formatDeckTitle(
			"Physics::Mechanics",
			"Quiz: Rotational Dynamics::Torque",
		);
		assert.equal(
			result,
			"NotebookLM::Physics - Mechanics::Quizzes::Rotational Dynamics - Torque",
		);
	});

	await t.test("supports custom user-defined template strings", () => {
		const customTemplate = "Study::{notebookName} - {quizName}";
		const result = formatDeckTitle(
			"Astrophysics",
			"General Relativity",
			customTemplate,
		);
		assert.equal(result, "Study::Astrophysics - General Relativity");
	});

	await t.test("handles missing or default inputs in template", () => {
		const result = formatDeckTitle(null, null);
		assert.equal(result, "NotebookLM::Unknown Notebook::Quizzes::Quiz");
	});
});

test("formatter: formatErrorMessage", async (t) => {
	await t.test("formats simple string error message", () => {
		assert.equal(
			formatErrorMessage("Connection Failed: Is Anki open?"),
			"Connection Failed: Is Anki open?",
		);
	});

	await t.test("formats array of error messages", () => {
		const errors = ["Deck not found", "Note type missing"];
		const expected = "Deck not found\nNote type missing";
		assert.equal(formatErrorMessage(errors), expected);
	});

	await t.test(
		"parses Python-style stringified list and aggregates duplicates",
		() => {
			const pythonListStr =
				'["cannot add note: duplicate", "cannot add note: duplicate", "deck not found"]';
			const expected = "cannot add note: duplicate (x2)\ndeck not found";
			assert.equal(formatErrorMessage(pythonListStr), expected);
		},
	);

	await t.test("returns 'Unknown Error' for empty or nullish inputs", () => {
		assert.equal(formatErrorMessage(""), "Unknown Error");
		assert.equal(formatErrorMessage(null), "Unknown Error");
		assert.equal(formatErrorMessage(undefined), "Unknown Error");
	});
});

// tests/unit/formatter.test.js - Unit tests for formatting and normalization utilities

import test from "node:test";
import assert from "node:assert/strict";
import {
	unescapeHtml,
	cleanNotebookTitle,
	cleanQuizTitle,
	formatDeckTitle,
	formatErrorMessage,
	sanitizeTopicTags,
	normalizeBlankAnswer,
	extractQuestionMedia,
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

test("formatter: sanitizeTopicTags", async (t) => {
	await t.test(
		"converts spaces to underscores and strips special characters",
		() => {
			const rawTopics = [
				"Fundamental Circuit Definitions (Voltage, Current, Power)",
				"Kirchhoff's Voltage Law (KVL) and Conservation of Energy",
				"Standard Reference Syntax (SRS) & Ohm's Law!",
			];
			const sanitized = sanitizeTopicTags(rawTopics);
			assert.deepEqual(sanitized, [
				"Fundamental_Circuit_Definitions_Voltage_Current_Power",
				"Kirchhoffs_Voltage_Law_KVL_and_Conservation_of_Energy",
				"Standard_Reference_Syntax_SRS_Ohms_Law",
			]);
		},
	);

	await t.test(
		"handles hyphens, multiple spaces, and underscores cleanly",
		() => {
			const raw = ["  Electro-Magnetic   Fields__  ", "Quantum--Physics"];
			const sanitized = sanitizeTopicTags(raw);
			assert.deepEqual(sanitized, [
				"Electro-Magnetic_Fields",
				"Quantum--Physics",
			]);
		},
	);

	await t.test(
		"handles empty array, null, undefined, or non-string items",
		() => {
			assert.deepEqual(sanitizeTopicTags([]), []);
			assert.deepEqual(sanitizeTopicTags(null), []);
			assert.deepEqual(sanitizeTopicTags(undefined), []);
			assert.deepEqual(
				sanitizeTopicTags(["", "   ", "???", null, 123]),
				[],
			);
		},
	);
});

test("formatter: normalizeBlankAnswer", async (t) => {
	await t.test("trims and converts to lowercase", () => {
		assert.equal(normalizeBlankAnswer("  Ampere  "), "ampere");
		assert.equal(normalizeBlankAnswer("Coulomb/Second"), "coulomb/second");
	});

	await t.test("strips surrounding LaTeX math dollar delimiters", () => {
		assert.equal(normalizeBlankAnswer("$Ampere$"), "ampere");
		assert.equal(
			normalizeBlankAnswer("$$100\\,\\text{V}$$"),
			"100\\,\\text{v}",
		);
	});

	await t.test("handles empty and nullish inputs gracefully", () => {
		assert.equal(normalizeBlankAnswer(""), "");
		assert.equal(normalizeBlankAnswer(null), "");
		assert.equal(normalizeBlankAnswer(undefined), "");
	});
});

test("formatter: extractQuestionMedia", async (t) => {
	await t.test(
		"resolves indexed image reference with imageUrls array",
		() => {
			const question =
				'Identify the circuit element:\n\n![Source Symbol](image_reference_index:1 "Voltage Reference")';
			const imageUrls = [
				"https://example.com/resistor.png",
				"https://example.com/voltage-source.png",
			];
			const result = extractQuestionMedia(question, imageUrls);

			assert.equal(result.cleanQuestion, "Identify the circuit element:");
			assert.equal(
				result.mediaUrl,
				"https://example.com/voltage-source.png",
			);
			assert.equal(result.alt, "Source Symbol");
			assert.equal(result.caption, "Voltage Reference");
		},
	);

	await t.test("extracts direct http(s) URL in markdown image syntax", () => {
		const question =
			'Diagram:\n![Circuit diagram](https://example.com/schematic.png "Schematic diagram")\nWhat is the value?';
		const result = extractQuestionMedia(question, []);

		assert.equal(result.cleanQuestion, "Diagram:\n\nWhat is the value?");
		assert.equal(result.mediaUrl, "https://example.com/schematic.png");
		assert.equal(result.alt, "Circuit diagram");
		assert.equal(result.caption, "Schematic diagram");
	});

	await t.test(
		"returns clean question when no media markup is present",
		() => {
			const question = "What is the speed of light in a vacuum?";
			const result = extractQuestionMedia(question, [
				"https://example.com/unused.png",
			]);

			assert.equal(result.cleanQuestion, question);
			assert.equal(result.mediaUrl, "");
			assert.equal(result.alt, "");
			assert.equal(result.caption, "");
		},
	);
});

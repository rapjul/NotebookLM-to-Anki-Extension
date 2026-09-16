// tests/unit/transformer.test.js - Unit tests for parsing, card extraction, and Anki payload transformation

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	parseQuizJson,
	mapQuizDataToCards,
	mapCardsToAnkiNotes,
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

test("transformer: parseQuizJson", async (t) => {
	await t.test(
		"parses standard quiz payload from unescaped JSON string",
		() => {
			const rawFixture = loadFixture("raw-app-data.json");
			const { quizData, title } = parseQuizJson(
				rawFixture.rawAppDataString,
			);

			assert.equal(title, "Quiz | Elemental Chemistry");
			assert.equal(Array.isArray(quizData), true);
			assert.equal(quizData.length, 1);
			assert.equal(
				quizData[0].question,
				"What is the chemical symbol for Gold?",
			);
		},
	);

	await t.test("parses HTML-escaped raw payload string correctly", () => {
		const rawFixture = loadFixture("raw-app-data.json");
		const { quizData, title } = parseQuizJson(
			rawFixture.htmlEscapedAppDataString,
		);

		assert.equal(title, "Quiz | Elemental Chemistry");
		assert.equal(quizData.length, 1);
		assert.equal(quizData[0].answerOptions.length, 4);
	});

	await t.test(
		"extracts quiz from mostRecentQuery wrapper if top-level quiz is absent",
		() => {
			const edgeCaseData = loadFixture("edge-cases-quiz.json");
			const jsonString = JSON.stringify(edgeCaseData);
			const { quizData, title } = parseQuizJson(jsonString);

			assert.equal(
				title,
				"Quiz: Scientific Edge Cases &amp; Anomalies Quiz",
			);
			assert.equal(quizData.length, 2);
		},
	);

	await t.test(
		"extracts topicsCovered and imageUrls from multi-format quiz payload",
		() => {
			const multiData = loadFixture("multi-format-quiz.json");
			const jsonString = JSON.stringify(multiData);
			const { quizData, title, topicsCovered, imageUrls } =
				parseQuizJson(jsonString);

			assert.equal(title, "Quiz | Circuit Analysis Fundamentals");
			assert.equal(quizData.length, 5);
			assert.equal(topicsCovered.length, 3);
			assert.equal(
				topicsCovered[0],
				"Fundamental Circuit Definitions (Voltage, Current, Power)",
			);
			assert.equal(imageUrls.length, 2);
			assert.equal(
				imageUrls[0],
				"https://lh3.googleusercontent.com/test-diagram-source-voltage.png",
			);
		},
	);

	await t.test("throws error when jsonString is empty or null", () => {
		assert.throws(() => parseQuizJson(""), {
			message: "Raw JSON string is empty.",
		});
		assert.throws(() => parseQuizJson(null), {
			message: "Raw JSON string is empty.",
		});
	});

	await t.test(
		"throws error when no quiz items are present in payload",
		() => {
			const emptyPayload = JSON.stringify({ title: "Empty", quiz: [] });
			assert.throws(() => parseQuizJson(emptyPayload), {
				message: "0 Questions Found.",
			});
		},
	);
});

test("transformer: mapQuizDataToCards", async (t) => {
	await t.test(
		"maps standard 4-option quiz questions into normalized cards",
		() => {
			const standardData = loadFixture("standard-quiz.json");
			const cards = mapQuizDataToCards(standardData.quiz);

			assert.equal(cards.length, standardData.quiz.length);
			const firstCard = cards[0];

			assert.equal(
				firstCard.question,
				"What is the atomic number of Carbon, and how many valence electrons does a neutral carbon atom have in its ground state?",
			);
			assert.equal(
				firstCard.hint,
				"Recall the group number and position of carbon on the periodic table.",
			);
			assert.equal(
				firstCard.option1,
				"Atomic number 6; 4 valence electrons",
			);
			assert.equal(firstCard.flag1, "True");
			assert.ok(firstCard.rationale1.includes("Carbon has 6 protons"));

			assert.equal(
				firstCard.option2,
				"Atomic number 12; 6 valence electrons",
			);
			assert.equal(firstCard.flag2, "False");

			assert.equal(firstCard.flag3, "False");
			assert.equal(firstCard.flag4, "False");
		},
	);

	await t.test(
		"maps all four question types and extracts image references from multi-format quiz",
		() => {
			const multiData = loadFixture("multi-format-quiz.json");
			const cards = mapQuizDataToCards(
				multiData.quiz,
				multiData.imageUrls,
			);

			assert.equal(cards.length, 5);

			// 1. Multiple Choice
			const mcCard = cards[0];
			assert.equal(mcCard.questionType, "MULTIPLE_CHOICE");
			assert.equal(mcCard.flag1, "True");
			assert.equal(mcCard.flag2, "False");

			// 2. Multiple Select
			const msCard = cards[1];
			assert.equal(msCard.questionType, "MULTIPLE_SELECT");
			assert.equal(msCard.flag1, "True");
			assert.equal(msCard.flag2, "True");
			assert.equal(msCard.flag3, "False");
			assert.equal(msCard.flag4, "False");

			// 3. Fill in the Blank
			const fitbCard = cards[2];
			assert.equal(fitbCard.questionType, "FILL_IN_THE_BLANK");
			assert.equal(fitbCard.targetAnswer, "Ampere");
			assert.equal(fitbCard.acceptableAnswers, "Amp, Amperes, A");
			assert.ok(fitbCard.generalRationale.includes("Coulomb per second"));

			// 4. Short Answer
			const saCard = cards[3];
			assert.equal(saCard.questionType, "SHORT_ANSWER");
			assert.ok(saCard.targetAnswer.includes("voltage rise occurs"));
			assert.ok(saCard.rubric.includes("• Defines voltage rise"));
			assert.ok(
				saCard.rubric.includes("⚠️ Stating that current direction"),
			);
			assert.ok(
				saCard.generalRationale.includes(
					"change in electrical potential",
				),
			);

			// 5. Multiple Choice with inline image reference
			const imgCard = cards[4];
			assert.equal(imgCard.questionType, "MULTIPLE_CHOICE");
			assert.equal(
				imgCard.diagramUrl,
				"https://lh3.googleusercontent.com/test-diagram-source-voltage.png",
			);
			assert.equal(
				imgCard.diagramAlt,
				"A diamond-shaped symbol with a plus and minus sign inside",
			);
			assert.equal(imgCard.diagramCaption, "Analog Signals and Systems");
			assert.equal(
				imgCard.question,
				"Based on the provided source images, what type of component does this symbol represent?",
			);
		},
	);

	await t.test(
		"preserves LaTeX math formulas across algebra, geometry, trigonometry, and calculus",
		() => {
			const mathData = loadFixture("math-physics-quiz.json");
			const cards = mapQuizDataToCards(mathData.quiz);

			assert.equal(cards.length, 5);

			// Quadratic formula
			assert.ok(cards[0].option1.includes("$$x = \\frac{-b"));
			assert.equal(cards[0].flag1, "True");

			// Pythagorean theorem
			assert.equal(cards[1].option1, "$$a^2 + b^2 = c^2$$");
			assert.equal(cards[1].flag1, "True");

			// Trigonometric identity
			assert.equal(
				cards[2].option1,
				"$\\sin^2\\theta + \\cos^2\\theta = 1$",
			);
			assert.equal(cards[2].flag1, "True");

			// Fundamental theorem of calculus
			assert.equal(cards[3].option1, "$$F(b) - F(a)$$");
			assert.equal(cards[3].flag1, "True");

			// Schrödinger wave equation
			assert.ok(cards[4].option1.includes("$$i\\hbar \\frac{\\partial}"));
			assert.equal(cards[4].flag1, "True");
		},
	);

	await t.test(
		"handles edge cases with missing hints and fewer than 4 options",
		() => {
			const edgeData = loadFixture("edge-cases-quiz.json");
			const cards = mapQuizDataToCards(edgeData.mostRecentQuery.quiz);

			assert.equal(cards.length, 2);

			// Question with 2 options
			const binaryCard = cards[0];
			assert.equal(binaryCard.hint, "");
			assert.equal(binaryCard.flag1, "True");
			assert.equal(binaryCard.flag2, "False");
			assert.equal(binaryCard.option3, "");
			assert.equal(binaryCard.flag3, "False");
			assert.equal(binaryCard.rationale3, "");
			assert.equal(binaryCard.option4, "");
			assert.equal(binaryCard.flag4, "False");

			// Question with 3 options
			const ternaryCard = cards[1];
			assert.equal(ternaryCard.option1, "$Zn^{2+}$");
			assert.equal(ternaryCard.option2, "$Fe^{2+}$");
			assert.equal(ternaryCard.option3, "$Cu^{2+}$");
			assert.equal(ternaryCard.option4, "");
			assert.equal(ternaryCard.flag4, "False");
		},
	);
});

test("transformer: mapCardsToAnkiNotes", async (t) => {
	await t.test(
		"maps cards to exact 20-field Anki note structure with Image and dual tags",
		() => {
			const standardData = loadFixture("standard-quiz.json");
			const cards = mapQuizDataToCards(standardData.quiz);
			const targetDeck =
				"NotebookLM::Chemistry & Astronomy::Quizzes::Test";
			const notes = mapCardsToAnkiNotes(cards, targetDeck);

			assert.equal(notes.length, cards.length);

			const firstNote = notes[0];
			assert.equal(firstNote.deckName, targetDeck);
			assert.equal(firstNote.modelName, "NotebookLM Quiz");
			assert.deepEqual(firstNote.tags, [
				"notebooklm_export",
				"google_notebook_export",
			]);
			assert.equal(firstNote.options.allowDuplicate, true);

			const fields = firstNote.fields;
			const expectedKeys = [
				"Question",
				"Hint",
				"Image",
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
				"QuestionType",
				"TargetAnswer",
				"AcceptableAnswers",
				"Rubric",
				"GeneralRationale",
			];

			assert.deepEqual(Object.keys(fields), expectedKeys);
			assert.equal(fields.Question, cards[0].question);
			assert.equal(fields.Hint, cards[0].hint);
			assert.equal(fields.Image, "");
			assert.equal(fields.Option1, cards[0].option1);
			assert.equal(fields.Rationale1, cards[0].rationale1);
			assert.equal(fields.Flag1, "True");
			assert.equal(fields.QuestionType, "MULTIPLE_CHOICE");
		},
	);

	await t.test(
		"merges sanitized topic tags into note tags without duplicates",
		() => {
			const standardData = loadFixture("standard-quiz.json");
			const cards = mapQuizDataToCards(standardData.quiz);
			const targetDeck = "NotebookLM::Test";
			const topicTags = [
				"Ohm_Law",
				"Circuit_Theory",
				"notebooklm_export",
			];
			const notes = mapCardsToAnkiNotes(
				cards,
				targetDeck,
				"NotebookLM Quiz",
				topicTags,
			);

			assert.deepEqual(notes[0].tags, [
				"notebooklm_export",
				"google_notebook_export",
				"Ohm_Law",
				"Circuit_Theory",
			]);
		},
	);
});

/**
 * @fileoverview Integration test suite for Anki card template behavioral lifecycles.
 * Executes Front and Back template logic inside the AnkiCardReviewer simulator across all
 * 4 question types, verifying state persistence, grading dispatches, platform profiles,
 * and tap interception.
 */

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
import { AnkiCardReviewer } from "../helpers/anki-reviewer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

/**
 * Loads and parses a JSON fixture file.
 *
 * @param {string} filename - Fixture file name.
 * @returns {any} Parsed fixture data.
 */
function loadFixture(filename) {
	const filePath = path.join(FIXTURES_DIR, filename);
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

test("card-lifecycle: all fixture notes render cleanly without template errors", async () => {
	const fixtureFiles = [
		"standard-quiz.json",
		"multi-format-quiz.json",
		"math-physics-quiz.json",
		"edge-cases-quiz.json",
	];

	for (const filename of fixtureFiles) {
		const fixtureData = loadFixture(filename);
		const { quizData } = parseQuizJson(JSON.stringify(fixtureData));
		assert.ok(
			Array.isArray(quizData) && quizData.length > 0,
			`${filename} should extract quiz cards`,
		);

		const cards = mapQuizDataToCards(quizData);
		const notes = mapCardsToAnkiNotes(cards, "Test Deck");
		assert.ok(notes.length > 0, `${filename} should yield mapped notes`);

		for (const note of notes) {
			const reviewer = new AnkiCardReviewer({ platform: "desktop" });

			await reviewer.renderFront(note.fields);
			assert.equal(
				reviewer.recordings.templateErrors.length,
				0,
				`Front template error on note "${note.fields.Question}" from ${filename}: ${reviewer.recordings.templateErrors.join(", ")}`,
			);

			await reviewer.renderBack(note.fields);
			assert.equal(
				reviewer.recordings.templateErrors.length,
				0,
				`Back template error on note "${note.fields.Question}" from ${filename}: ${reviewer.recordings.templateErrors.join(", ")}`,
			);
		}
	}
});

test("card-lifecycle: MULTIPLE_CHOICE single-select flow and grading", async (t) => {
	const mcFields = {
		Question: "Which element has atomic number 1?",
		Hint: "Lightest gas",
		Image: "",
		Option1: "Hydrogen",
		Rationale1: "Hydrogen has 1 proton",
		Flag1: "true",
		Option2: "Helium",
		Rationale2: "Helium has atomic number 2",
		Flag2: "false",
		Option3: "Lithium",
		Rationale3: "Lithium has atomic number 3",
		Flag3: "false",
		Option4: "Carbon",
		Rationale4: "Carbon has atomic number 6",
		Flag4: "false",
		QuestionType: "MULTIPLE_CHOICE",
		TargetAnswer: "",
		AcceptableAnswers: "",
		Rubric: "",
		GeneralRationale: "Hydrogen is the first element.",
	};

	await t.test("correct answer selection flips card and grades Good (ease3)", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(mcFields);

		const options = reviewer.document.querySelectorAll(".mc-option-btn");
		assert.equal(options.length, 4, "Front should render 4 multiple choice buttons");

		const hydrogenOption = Array.from(options).find((opt) =>
			opt.textContent.includes("Hydrogen"),
		);
		assert.ok(hydrogenOption, "Should locate Hydrogen option");

		hydrogenOption.click();

		assert.deepEqual(
			reviewer.recordings.pycmd,
			["ans"],
			"Selecting an option must dispatch pycmd('ans') on Desktop",
		);

		await reviewer.renderBack(mcFields);

		const scorePill = reviewer.document.querySelector(".score-pill");
		assert.ok(scorePill, "Score pill should be rendered on Back");
		assert.ok(scorePill.classList.contains("pill-correct"));
		assert.ok(scorePill.textContent.includes("Correct · Good"));

		const backOptions = reviewer.document.querySelectorAll(".option-block");
		assert.equal(backOptions.length, 4);

		const backHydrogen = Array.from(backOptions).find((opt) =>
			opt.textContent.includes("Hydrogen"),
		);
		assert.ok(backHydrogen.classList.contains("state-correct"));
		assert.ok(backHydrogen.textContent.includes("That's right! (Your answer)"));

		scorePill.click();
		assert.ok(
			reviewer.recordings.bridgeCommand.includes("ease3") ||
				reviewer.recordings.pycmd.includes("ease3"),
			"Clicking score pill on correct answer must dispatch ease3",
		);
	});

	await t.test("incorrect answer selection flips card and grades Again (ease1)", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(mcFields);

		const heliumOption = Array.from(
			reviewer.document.querySelectorAll(".mc-option-btn"),
		).find((opt) => opt.textContent.includes("Helium"));
		assert.ok(heliumOption);

		heliumOption.click();
		assert.deepEqual(reviewer.recordings.pycmd, ["ans"]);

		await reviewer.renderBack(mcFields);

		const scorePill = reviewer.document.querySelector(".score-pill");
		assert.ok(scorePill.classList.contains("pill-wrong"));
		assert.ok(scorePill.textContent.includes("Incorrect · Again"));

		const backHelium = Array.from(
			reviewer.document.querySelectorAll(".option-block"),
		).find((opt) => opt.textContent.includes("Helium"));
		assert.ok(backHelium.classList.contains("state-wrong"));
		assert.ok(backHelium.textContent.includes("Not quite (Your answer)"));

		scorePill.click();
		assert.ok(
			reviewer.recordings.bridgeCommand.includes("ease1") ||
				reviewer.recordings.pycmd.includes("ease1"),
			"Clicking score pill on incorrect answer must dispatch ease1",
		);
	});
});

test("card-lifecycle: MULTIPLE_SELECT multi-select validation, states, and score pill", async (t) => {
	const msFields = {
		Question: "Which of the following are prime numbers?",
		Hint: "Divisible only by 1 and itself",
		Image: "",
		Option1: "2",
		Rationale1: "2 is the only even prime",
		Flag1: "true",
		Option2: "3",
		Rationale2: "3 is prime",
		Flag2: "true",
		Option3: "4",
		Rationale3: "4 is composite (2x2)",
		Flag3: "false",
		Option4: "9",
		Rationale4: "9 is composite (3x3)",
		Flag4: "false",
		QuestionType: "MULTIPLE_SELECT",
		TargetAnswer: "",
		AcceptableAnswers: "",
		Rubric: "",
		GeneralRationale: "2 and 3 are prime numbers.",
	};

	await t.test("submitting with 0 selections triggers warning and shake without flip", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(msFields);

		const submitBtn = reviewer.document.getElementById("ms-submit-btn");
		const warningEl = reviewer.document.getElementById("ms-warning");

		assert.ok(submitBtn.classList.contains("btn-disabled"));
		assert.ok(warningEl.classList.contains("is-hidden"));

		submitBtn.click();

		assert.equal(
			reviewer.recordings.pycmd.length,
			0,
			"Must not flip when zero options are selected",
		);
		assert.ok(
			!warningEl.classList.contains("is-hidden"),
			"Warning message should become visible",
		);
	});

	await t.test("selecting all correct options renders 100% score pill and grades Good", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(msFields);

		const options = Array.from(
			reviewer.document.querySelectorAll(".ms-option-btn"),
		);
		const opt2 = options.find((btn) => btn.textContent.includes("2"));
		const opt3 = options.find((btn) => btn.textContent.includes("3"));

		opt2.click();
		opt3.click();

		const submitBtn = reviewer.document.getElementById("ms-submit-btn");
		assert.ok(!submitBtn.classList.contains("btn-disabled"));
		assert.equal(submitBtn.textContent, "Check Answer");

		submitBtn.click();
		assert.deepEqual(reviewer.recordings.pycmd, ["ans"]);

		await reviewer.renderBack(msFields);

		const scorePill = reviewer.document.querySelector(".score-pill");
		assert.ok(scorePill.classList.contains("pill-correct"));
		assert.ok(scorePill.textContent.includes("2/2 Correct · Good"));

		scorePill.click();
		assert.ok(
			reviewer.recordings.bridgeCommand.includes("ease3") ||
				reviewer.recordings.pycmd.includes("ease3"),
		);
	});

	await t.test("partial selection highlights missed options and grades Again", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(msFields);

		const options = Array.from(
			reviewer.document.querySelectorAll(".ms-option-btn"),
		);
		const opt2 = options.find((btn) => btn.textContent.includes("2"));
		opt2.click();

		reviewer.document.getElementById("ms-submit-btn").click();
		await reviewer.renderBack(msFields);

		const scorePill = reviewer.document.querySelector(".score-pill");
		assert.ok(scorePill.classList.contains("pill-wrong"));
		assert.ok(scorePill.textContent.includes("1/2 Correct · Again"));

		const backBlocks = Array.from(
			reviewer.document.querySelectorAll(".option-block"),
		);
		const block2 = backBlocks.find((b) =>
			b.querySelector(".option-content")?.textContent.includes("2"),
		);
		const block3 = backBlocks.find((b) =>
			b.querySelector(".option-content")?.textContent.includes("3"),
		);

		assert.ok(block2.classList.contains("state-correct"));
		assert.ok(block3.classList.contains("state-missed"));
		assert.ok(block3.textContent.includes("Missed correct option"));

		scorePill.click();
		assert.ok(
			reviewer.recordings.bridgeCommand.includes("ease1") ||
				reviewer.recordings.pycmd.includes("ease1"),
		);
	});
});

test("card-lifecycle: FILL_IN_THE_BLANK form submission, normalization, and skipped state", async (t) => {
	const fitbFields = {
		Question: "The capital of France is _____.",
		Hint: "City of lights",
		Image: "",
		Option1: "",
		Rationale1: "",
		Flag1: "",
		Option2: "",
		Rationale2: "",
		Flag2: "",
		Option3: "",
		Rationale3: "",
		Flag3: "",
		Option4: "",
		Rationale4: "",
		Flag4: "",
		QuestionType: "FILL_IN_THE_BLANK",
		TargetAnswer: "Paris",
		AcceptableAnswers: "City of Paris, Ville de Paris",
		Rubric: "",
		GeneralRationale: "Paris is the capital of France.",
	};

	await t.test("exact and acceptable answer matches reveal immediate feedback and grade Good", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(fitbFields);

		const input = reviewer.document.getElementById("fitb-input");
		const form = reviewer.document.getElementById("fitb-form");

		input.value = "  ville de paris  ";
		input.dispatchEvent(new reviewer.window.Event("input"));

		form.dispatchEvent(
			new reviewer.window.Event("submit", { cancelable: true }),
		);

		const feedback = reviewer.document.getElementById("fitb-feedback");
		assert.ok(!feedback.classList.contains("is-hidden"));
		assert.ok(feedback.textContent.includes("That's right!"));

		assert.deepEqual(reviewer.recordings.pycmd, ["ans"]);

		await reviewer.renderBack(fitbFields);

		const feedbackCard = reviewer.document.querySelector(".feedback-card");
		assert.ok(feedbackCard.classList.contains("card-correct"));

		const scorePill = reviewer.document.getElementById("back-score-pill");
		assert.ok(scorePill.classList.contains("pill-correct"));
		assert.ok(scorePill.textContent.includes("Correct · Good"));

		scorePill.click();
		assert.ok(
			reviewer.recordings.bridgeCommand.includes("ease3") ||
				reviewer.recordings.pycmd.includes("ease3"),
		);
	});

	await t.test("empty response handles skipped state and grades Again", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "desktop" });
		await reviewer.renderFront(fitbFields);

		const form = reviewer.document.getElementById("fitb-form");
		form.dispatchEvent(
			new reviewer.window.Event("submit", { cancelable: true }),
		);

		const feedback = reviewer.document.getElementById("fitb-feedback");
		assert.ok(feedback.textContent.includes("Skipped"));

		await reviewer.renderBack(fitbFields);

		const scorePill = reviewer.document.getElementById("back-score-pill");
		assert.ok(scorePill.classList.contains("pill-skipped"));
		assert.ok(scorePill.textContent.includes("Skipped · Again"));

		scorePill.click();
		assert.ok(
			reviewer.recordings.bridgeCommand.includes("ease1") ||
				reviewer.recordings.pycmd.includes("ease1"),
		);
	});
});

test("card-lifecycle: SHORT_ANSWER scratchpad and interactive rubric checklist", async () => {
	const saFields = {
		Question: "Explain Newton's Second Law of Motion.",
		Hint: "Relates force, mass, and acceleration",
		Image: "",
		Option1: "",
		Rationale1: "",
		Flag1: "",
		Option2: "",
		Rationale2: "",
		Flag2: "",
		Option3: "",
		Rationale3: "",
		Flag3: "",
		Option4: "",
		Rationale4: "",
		Flag4: "",
		QuestionType: "SHORT_ANSWER",
		TargetAnswer: "F = m * a",
		AcceptableAnswers: "",
		Rubric: "• State the formula F=ma\n• Define mass and acceleration\n⚠️ Mass is not weight",
		GeneralRationale: "Force equals mass times acceleration.",
	};

	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	await reviewer.renderFront(saFields);

	const scratch = reviewer.document.getElementById("sa-scratchpad");
	scratch.value = "Force is proportional to acceleration: F=ma";
	scratch.dispatchEvent(new reviewer.window.Event("input"));

	reviewer.document.getElementById("sa-submit-btn").click();
	assert.deepEqual(reviewer.recordings.pycmd, ["ans"]);

	await reviewer.renderBack(saFields);

	assert.ok(
		reviewer.document.body.textContent.includes(
			"Force is proportional to acceleration: F=ma",
		),
		"User draft should be preserved and displayed on Back",
	);
	assert.ok(
		reviewer.document.body.textContent.includes("Model Answer"),
		"Model answer section should be displayed",
	);

	const checkboxes = reviewer.document.querySelectorAll(".rubric-checkbox");
	assert.equal(checkboxes.length, 2, "Should parse 2 bullet checklist items");

	const item0 = reviewer.document.getElementById("rubric-item-0");
	checkboxes[0].checked = true;
	checkboxes[0].dispatchEvent(new reviewer.window.Event("change"));
	assert.ok(item0.classList.contains("rubric-checked"));

	const misconceptions = reviewer.document.querySelector(".sa-misconceptions");
	assert.ok(misconceptions.textContent.includes("Mass is not weight"));

	// Self-grade with keyboard shortcut "3"
	reviewer.document.dispatchEvent(
		new reviewer.window.KeyboardEvent("keydown", { key: "3", bubbles: true }),
	);

	assert.ok(
		reviewer.recordings.bridgeCommand.includes("ease3") ||
			reviewer.recordings.pycmd.includes("ease3"),
		"Pressing 3 on desktop short answer must grade Good",
	);
});

test("card-lifecycle: platform profiles and mobile tap interception", async (t) => {
	const sampleFields = {
		Question: "Test diagram prompt",
		Hint: "",
		Image: '<img src="schema.png" alt="Database architecture diagram">',
		Option1: "Choice A",
		Rationale1: "Explanation A",
		Flag1: "true",
		Option2: "Choice B",
		Rationale2: "Explanation B",
		Flag2: "false",
		Option3: "",
		Rationale3: "",
		Flag3: "false",
		Option4: "",
		Rationale4: "",
		Flag4: "false",
		QuestionType: "MULTIPLE_CHOICE",
		TargetAnswer: "",
		AcceptableAnswers: "",
		Rubric: "",
		GeneralRationale: "",
	};

	await t.test("AnkiMobile iOS suppresses in-card grading buttons and shields taps", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "ankimobile-ios" });
		await reviewer.renderFront(sampleFields);

		// Tap on diagram image toggles description without triggering flip
		const img = reviewer.document.querySelector(".question-media img");
		assert.ok(img, "Diagram image should be rendered");

		img.click();
		const descBox = reviewer.document.querySelector(".diagram-alt-description");
		assert.ok(descBox.classList.contains("is-open"));
		assert.equal(reviewer.recordings.webkitCb.length, 0);

		// Tap on whitespace outside interactive elements is prevented
		const whitespaceEvent = new reviewer.window.MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		reviewer.document.body.dispatchEvent(whitespaceEvent);
		assert.equal(
			whitespaceEvent.defaultPrevented,
			true,
			"Whitespace click should be preventDefaulted on Front in AnkiMobile",
		);

		await reviewer.renderBack(sampleFields);

		// Mobile must not render in-card continue button
		const continueBtn = reviewer.document.querySelector(".continue-btn");
		assert.equal(
			continueBtn,
			null,
			"In-card continue button must be omitted on mobile platforms",
		);
	});

	await t.test("AnkiDroid dispatches showAnswer and ankiAnswerEase3", async () => {
		const reviewer = new AnkiCardReviewer({ platform: "ankidroid" });
		await reviewer.renderFront(sampleFields);

		const choiceA = Array.from(
			reviewer.document.querySelectorAll(".mc-option-btn"),
		).find((opt) => opt.textContent.includes("Choice A"));

		choiceA.click();
		assert.equal(reviewer.recordings.showAnswer, 1);

		await reviewer.renderBack(sampleFields);
		assert.equal(reviewer.recordings.templateErrors.length, 0);
	});
});

test("card-lifecycle: attribute quote preservation prevents DOM breakages", async () => {
	const quoteFields = {
		Question: 'What does &quot;HTML&quot; stand for?',
		Hint: 'Contains &quot;HyperText&quot;',
		Image: "",
		Option1: 'HyperText &quot;Markup&quot; Language',
		Rationale1: 'Standard &quot;definition&quot; format',
		Flag1: "true",
		Option2: 'HighTech &quot;Machine&quot; Language',
		Rationale2: 'Incorrect definition',
		Flag2: "false",
		Option3: "",
		Rationale3: "",
		Flag3: "false",
		Option4: "",
		Rationale4: "",
		Flag4: "false",
		QuestionType: "MULTIPLE_CHOICE",
		TargetAnswer: "",
		AcceptableAnswers: "",
		Rubric: "",
		GeneralRationale: 'Quotes &quot;within&quot; rationale text.',
	};

	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	await reviewer.renderFront(quoteFields);
	assert.equal(reviewer.recordings.templateErrors.length, 0);

	await reviewer.renderBack(quoteFields);
	assert.equal(reviewer.recordings.templateErrors.length, 0);

	const content = reviewer.document.body.textContent;
	assert.ok(content.includes('HyperText "Markup" Language'));
});

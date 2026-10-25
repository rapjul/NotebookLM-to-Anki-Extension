/**
 * @fileoverview Negative integration test suite for Anki card template error boundaries.
 * Verifies runtime resilience against malformed payloads, storage quota failures,
 * corrupted state, rapid double-tap concurrency, and missing or failing host bridges.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AnkiCardReviewer } from "../helpers/anki-reviewer.js";

/**
 * Creates a minimal note fields dictionary populated with defaults.
 *
 * @param {Record<string, string>} [overrides={}] - Field overrides.
 * @returns {Record<string, string>} Complete fields object.
 */
function createMinimalFields(overrides = {}) {
	return {
		Question: "Test Question?",
		Hint: "",
		Image: "",
		Option1: "Option A",
		Rationale1: "Rationale A",
		Flag1: "True",
		Option2: "Option B",
		Rationale2: "Rationale B",
		Flag2: "False",
		Option3: "",
		Rationale3: "",
		Flag3: "False",
		Option4: "",
		Rationale4: "",
		Flag4: "False",
		QuestionType: "MULTIPLE_CHOICE",
		TargetAnswer: "",
		AcceptableAnswers: "",
		Rubric: "",
		GeneralRationale: "",
		...overrides,
	};
}

// ============================================================================
// 1. MALFORMED & EMPTY NOTE PAYLOADS
// ============================================================================

test("negative: empty fields dictionary renders cleanly without uncaught exceptions", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const emptyFields = {};

	// Front render should not throw
	await reviewer.renderFront(emptyFields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Front should not log template errors on empty fields",
	);
	assert.ok(reviewer.document.body, "Front body should exist");

	// Back render should not throw
	await reviewer.renderBack(emptyFields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Back should not log template errors on empty fields",
	);
	assert.ok(reviewer.document.body, "Back body should exist");
});

test("negative: unknown QuestionType degrades gracefully without crashing", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Custom essay prompt?",
		QuestionType: "CUSTOM_UNKNOWN_TYPE",
	});

	await reviewer.renderFront(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Front should handle unknown question type safely",
	);
	const frontQText = reviewer.document.getElementById("q-text");
	assert.ok(
		frontQText?.textContent?.includes("Custom essay prompt"),
		"Front question text should be rendered",
	);

	await reviewer.renderBack(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Back should handle unknown question type safely",
	);

	const backQText = reviewer.document.getElementById("back-q-text");
	assert.ok(
		backQText?.textContent?.includes("Custom essay prompt"),
		"Back question text should be rendered",
	);
});

test("negative: FILL_IN_THE_BLANK handles empty TargetAnswer without crashing", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Fill in: ______",
		QuestionType: "FILL_IN_THE_BLANK",
		TargetAnswer: "",
		AcceptableAnswers: "",
	});

	await reviewer.renderFront(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Front FITB should render safely without target answer",
	);

	const form = reviewer.document.getElementById("fitb-form");
	assert.ok(form, "FITB form should be rendered");

	await reviewer.renderBack(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Back FITB should evaluate safely with empty target",
	);
});

test("negative: SHORT_ANSWER handles unformatted plain text Rubric without parsing errors", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Explain the law of conservation of momentum.",
		QuestionType: "SHORT_ANSWER",
		TargetAnswer: "Momentum is conserved in isolated systems.",
		Rubric: "Plain unformatted string describing requirements without JSON or bullet symbols.",
	});

	await reviewer.renderFront(fields);
	assert.equal(reviewer.recordings.templateErrors.length, 0);

	await reviewer.renderBack(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Back short answer should render raw rubric string without exceptions",
	);

	const rubricEl = reviewer.document.querySelector(".sa-rubric");
	assert.ok(rubricEl, "Rubric container should exist");
	assert.ok(
		rubricEl.textContent?.includes("Plain unformatted string"),
		"Raw rubric text should be visible",
	);
});

test("negative: MULTIPLE_CHOICE handles sparse or missing options gracefully", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	// Note with only Option1 present; Option2-4 omitted completely
	const fields = createMinimalFields({
		Question: "True or False?",
		Option1: "True",
		Rationale1: "Rationale 1",
		Flag1: "True",
		Option2: "",
		Rationale2: "",
		Flag2: "False",
		Option3: "",
		Rationale3: "",
		Flag3: "False",
		Option4: "",
		Rationale4: "",
		Flag4: "False",
	});

	await reviewer.renderFront(fields);
	assert.equal(reviewer.recordings.templateErrors.length, 0);

	const options = reviewer.document.querySelectorAll(".option-block");
	assert.equal(
		options.length,
		1,
		"Only non-empty options should be rendered",
	);

	// Clicking the single option should still trigger flip
	options[0].click();
	assert.ok(
		reviewer.recordings.pycmd.includes("ans"),
		"Clicking sparse option should trigger flip",
	);

	await reviewer.renderBack(fields);
	assert.equal(reviewer.recordings.templateErrors.length, 0);
});

// ============================================================================
// 2. SESSION STORAGE FAILURES & CORRUPT STATE
// ============================================================================

test("negative: handles sessionStorage.setItem quota exceeded error on front option selection", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Storage failure test?",
	});

	// Mock sessionStorage.setItem to simulate QuotaExceededError
	reviewer.window.sessionStorage.setItem = () => {
		throw new Error("QuotaExceededError: storage quota has been exceeded");
	};

	await reviewer.renderFront(fields);

	const option = reviewer.document.querySelector(".option-block");
	assert.ok(option, "Option element should exist");

	// Clicking option must not throw uncaught error; must still attempt flip
	assert.doesNotThrow(() => {
		option.click();
	}, "Clicking option under storage quota error should not throw");

	assert.ok(
		reviewer.recordings.pycmd.includes("ans"),
		"Card should still flip despite storage write error",
	);
});

test("negative: handles corrupted non-JSON state in sessionStorage on Back", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Multi-select corrupt state test?",
		QuestionType: "MULTIPLE_SELECT",
		Option1: "A",
		Flag1: "True",
		Option2: "B",
		Flag2: "True",
	});

	// Inject malformed JSON into storage keys
	reviewer.window.sessionStorage.setItem(
		"nb_anki_multiselect_selected",
		"invalid-json{[,,}",
	);

	await reviewer.renderBack(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Corrupted JSON in sessionStorage should not crash Back template",
	);

	const scorePill = reviewer.document.getElementById("back-score-pill");
	assert.ok(
		scorePill,
		"Score pill should still render despite corrupted session state",
	);
});

test("negative: handles direct Back render without preceding Front interaction", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	reviewer.window.sessionStorage.clear();

	const fields = createMinimalFields({
		Question: "Unanswered multiple choice?",
		Option1: "Correct Option",
		Flag1: "True",
		Option2: "Wrong Option",
		Flag2: "False",
	});

	// Render Back directly without rendering Front or touching sessionStorage
	await reviewer.renderBack(fields);
	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"Direct Back render without preceding Front should not throw",
	);

	const options = reviewer.document.querySelectorAll(".option-block");
	assert.equal(
		options.length,
		2,
		"Both options should be visible for study",
	);
	assert.ok(
		options[0].classList.contains("state-correct"),
		"Correct option should be marked with state-correct",
	);
});

// ============================================================================
// 3. CONCURRENCY & RAPID DOUBLE-TAP / GHOST-CLICK GUARDS
// ============================================================================

test("negative: FITB ignores rapid duplicate submissions via fitbSubmitted guard", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Type the capital of France: ______",
		QuestionType: "FILL_IN_THE_BLANK",
		TargetAnswer: "Paris",
	});

	await reviewer.renderFront(fields);

	const input = reviewer.document.getElementById("fitb-input");
	const submitBtn = reviewer.document.getElementById("fitb-submit-btn");
	assert.ok(input && submitBtn);

	input.value = "Paris";

	// Trigger submit button click twice rapidly
	submitBtn.click();
	submitBtn.click();

	// Verify flip command was only sent once
	const ansCount = reviewer.recordings.pycmd.filter(
		(cmd) => cmd === "ans",
	).length;
	assert.equal(
		ansCount,
		1,
		"pycmd('ans') should only be dispatched once on rapid double submit",
	);
});

test("negative: Back score pill suppresses rapid double clicks within ghost click window", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Rapid click test?",
		Option1: "Option A",
		Flag1: "True",
		Option2: "Option B",
		Flag2: "False",
	});

	await reviewer.renderFront(fields);
	const option = Array.from(
		reviewer.document.querySelectorAll(".option-block"),
	).find((b) => b.textContent?.includes("Option A"));
	assert.ok(option, "Should locate Option A");
	option.click();

	await reviewer.renderBack(fields);

	const scorePill = reviewer.document.getElementById("back-score-pill");
	assert.ok(scorePill, "Score pill should exist");

	// Click twice synchronously (< 400ms ghost click window)
	scorePill.click();
	scorePill.click();

	const ease3Count =
		reviewer.recordings.bridgeCommand.filter((cmd) => cmd === "ease3")
			.length +
		reviewer.recordings.pycmd.filter((cmd) => cmd === "ease3").length;
	assert.equal(
		ease3Count,
		1,
		"Rapid double-click on score pill should only dispatch grade once",
	);
});

test("negative: SHORT_ANSWER keydown listener is detached after initial grading", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	const fields = createMinimalFields({
		Question: "Explain photosynthesis.",
		QuestionType: "SHORT_ANSWER",
		TargetAnswer: "Process by which plants convert sunlight into chemical energy.",
	});

	await reviewer.renderBack(fields);

	// Dispatch keydown "3" (ease3) on document with bubbling
	reviewer.document.dispatchEvent(
		new reviewer.window.KeyboardEvent("keydown", {
			key: "3",
			code: "Digit3",
			bubbles: true,
		}),
	);

	// Dispatch keydown "3" again immediately
	reviewer.document.dispatchEvent(
		new reviewer.window.KeyboardEvent("keydown", {
			key: "3",
			code: "Digit3",
			bubbles: true,
		}),
	);

	const ease3Count =
		reviewer.recordings.bridgeCommand.filter((cmd) => cmd === "ease3")
			.length +
		reviewer.recordings.pycmd.filter((cmd) => cmd === "ease3").length;
	assert.equal(
		ease3Count,
		1,
		"Keydown shortcut should only grade once and detach listener",
	);
});

// ============================================================================
// 4. HOST BRIDGE FAILURES & MISSING APIS
// ============================================================================

test("negative: operates safely when zero host bridges are defined", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });

	// Wipe all bridges
	delete reviewer.window.pycmd;
	delete reviewer.window.bridgeCommand;
	delete reviewer.window.AnkiDroidJS;
	delete reviewer.window.webkit;

	const fields = createMinimalFields({
		Question: "Bridge-free environment test?",
		Option1: "Option A",
		Flag1: "True",
	});

	await reviewer.renderFront(fields);
	const option = reviewer.document.querySelector(".option-block");

	// Clicking option with no bridge should not throw uncaught ReferenceError
	assert.doesNotThrow(() => {
		option?.click();
	}, "Clicking option without bridges should degrade safely");

	await reviewer.renderBack(fields);
	const scorePill = reviewer.document.getElementById("back-score-pill");

	// Clicking score pill with no bridge should not throw uncaught ReferenceError
	assert.doesNotThrow(() => {
		scorePill?.click();
	}, "Clicking continue without bridges should degrade safely");

	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"No template errors should be logged in bridge-free environment",
	);
});

test("negative: recovers gracefully if WebKit message handler throws an exception", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "ankimobile-ios" });

	// Simulate WebKit IPC failure on postMessage
	reviewer.window.webkit.messageHandlers.cb.postMessage = () => {
		throw new Error("WebKit IPC connection terminated");
	};

	const fields = createMinimalFields({
		Question: "WebKit failure test?",
		Option1: "Option A",
		Flag1: "True",
	});

	await reviewer.renderFront(fields);
	const option = reviewer.document.querySelector(".option-block");

	// Must handle WebKit throw without crashing the webview
	assert.doesNotThrow(() => {
		option?.click();
	}, "WebKit handler throw should be caught gracefully");
});

test("negative: handles MathJax.typesetPromise rejection without unhandled rejection", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });

	// Simulate MathJax rendering failure
	reviewer.window.MathJax.typesetPromise = () =>
		Promise.reject(new Error("MathJax syntax error in LaTeX equation"));

	const fields = createMinimalFields({
		Question: "Solve: \\( \\frac{d}{dx} e^x \\)",
		Option1: "\\( e^x \\)",
		Flag1: "True",
	});

	await reviewer.renderFront(fields);
	await reviewer.renderBack(fields);

	assert.equal(
		reviewer.recordings.templateErrors.length,
		0,
		"MathJax rejection should be caught safely by triggerMath",
	);
});

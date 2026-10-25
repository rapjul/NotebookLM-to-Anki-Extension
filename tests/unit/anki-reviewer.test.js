/**
 * @fileoverview Unit tests for Anki card reviewer simulator (tests/helpers/anki-reviewer.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AnkiCardReviewer } from "../helpers/anki-reviewer.js";

const minimalSampleFields = {
	Question: "Sample question?",
	Hint: "Sample hint",
	Image: "",
	Option1: "Choice A",
	Rationale1: "Rationale A",
	Flag1: "true",
	Option2: "Choice B",
	Rationale2: "Rationale B",
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
	GeneralRationale: "Explanation",
};

test("anki-reviewer: Desktop profile bridges and recording", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	assert.ok(reviewer.window.pycmd);
	assert.ok(reviewer.window.bridgeCommand);

	reviewer.window.pycmd("ans");
	reviewer.window.bridgeCommand("ease3");

	assert.deepEqual(reviewer.recordings.pycmd, ["ans"]);
	assert.deepEqual(reviewer.recordings.bridgeCommand, ["ease3"]);
	assert.equal(reviewer.recordings.templateErrors.length, 0);
});

test("anki-reviewer: AnkiMobile iOS profile message handlers and classes", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "ankimobile-ios" });
	const rootClasses = reviewer.document.documentElement.classList;

	assert.ok(rootClasses.contains("mobile"));
	assert.ok(rootClasses.contains("iphone"));
	assert.ok(rootClasses.contains("ios"));
	assert.equal(reviewer.window.anki, true);
	assert.ok(reviewer.window.webkit.messageHandlers.cb);
	assert.ok(reviewer.window.webkit.messageHandlers.bridgeCommand);

	reviewer.window.webkit.messageHandlers.cb.postMessage("test-cb");
	reviewer.window.webkit.messageHandlers.bridgeCommand.postMessage("ease1");
	reviewer.window.sendMessage2("ankitap", "midCenter");

	assert.deepEqual(reviewer.recordings.webkitCb, ["test-cb"]);
	assert.deepEqual(reviewer.recordings.webkitBridge, ["ease1"]);
	assert.deepEqual(reviewer.recordings.sendMessage2, [
		{ scheme: "ankitap", msg: "midCenter" },
	]);
});

test("anki-reviewer: iPadOS Magic Keyboard profile pointer and touch detection", async () => {
	const reviewer = new AnkiCardReviewer({
		platform: "ankimobile-ipados-keyboard",
	});
	const rootClasses = reviewer.document.documentElement.classList;

	assert.ok(rootClasses.contains("ipad"));
	assert.equal(reviewer.window.navigator.platform, "MacIntel");
	assert.equal(reviewer.window.navigator.maxTouchPoints, 5);
	assert.ok(reviewer.window.matchMedia("(pointer: fine)").matches);
});

test("anki-reviewer: AnkiDroid profile global ease functions and AnkiDroidJS", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "ankidroid" });
	const rootClasses = reviewer.document.documentElement.classList;

	assert.ok(rootClasses.contains("android"));
	assert.ok(reviewer.window.showAnswer);
	assert.ok(reviewer.window.AnkiDroidJS);

	reviewer.window.showAnswer();
	reviewer.window.ankiAnswerEase3();
	reviewer.window.ankiAnswerEase1();

	assert.equal(reviewer.recordings.showAnswer, 1);
	assert.deepEqual(reviewer.recordings.ankiAnswerEase, ["ease3", "ease1"]);
});

test("anki-reviewer: sessionStorage persists across renderFront and renderBack", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });

	await reviewer.renderFront(minimalSampleFields);
	reviewer.window.sessionStorage.setItem("test_key", "test_val");

	await reviewer.renderBack(minimalSampleFields);
	assert.equal(reviewer.window.sessionStorage.getItem("test_key"), "test_val");

	reviewer.clearSession();
	assert.equal(reviewer.window.sessionStorage.getItem("test_key"), null);
});

test("anki-reviewer: MathJax typesetPromise spy records element typesetting", async () => {
	const reviewer = new AnkiCardReviewer({ platform: "desktop" });
	await reviewer.renderFront(minimalSampleFields);

	const dummy = reviewer.document.createElement("div");
	await reviewer.window.MathJax.typesetPromise([dummy]);

	assert.equal(reviewer.recordings.mathJaxTypeset.length >= 1, true);
	assert.equal(reviewer.recordings.mathJaxTypeset[reviewer.recordings.mathJaxTypeset.length - 1][0], dummy);
});

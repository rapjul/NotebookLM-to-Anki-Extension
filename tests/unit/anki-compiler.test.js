/**
 * @fileoverview Unit tests for Anki card template compiler helper (tests/helpers/anki-compiler.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	VALID_SCHEMA_FIELDS,
	compileTemplate,
	compileCardSide,
	wrapInCardDocument,
} from "../helpers/anki-compiler.js";

test("anki-compiler: schema field count and completeness", () => {
	assert.equal(VALID_SCHEMA_FIELDS.size, 20);
	assert.ok(VALID_SCHEMA_FIELDS.has("Question"));
	assert.ok(VALID_SCHEMA_FIELDS.has("Image"));
	assert.ok(VALID_SCHEMA_FIELDS.has("Option1"));
	assert.ok(VALID_SCHEMA_FIELDS.has("Flag1"));
	assert.ok(VALID_SCHEMA_FIELDS.has("QuestionType"));
	assert.ok(VALID_SCHEMA_FIELDS.has("TargetAnswer"));
	assert.ok(VALID_SCHEMA_FIELDS.has("AcceptableAnswers"));
	assert.ok(VALID_SCHEMA_FIELDS.has("Rubric"));
	assert.ok(VALID_SCHEMA_FIELDS.has("GeneralRationale"));
});

test("anki-compiler: basic field substitution", () => {
	const template = "<h1>{{Question}}</h1><div>{{Hint}}</div>";
	const fields = {
		Question: "What is photosynthesis?",
		Hint: "Occurs in chloroplasts",
	};

	const compiled = compileTemplate(template, fields);
	assert.equal(
		compiled,
		"<h1>What is photosynthesis?</h1><div>Occurs in chloroplasts</div>",
	);
});

test("anki-compiler: positive conditionals {{#Field}}...{{/Field}}", () => {
	const template = "{{#Image}}<img src='{{Image}}'>{{/Image}}<p>{{Question}}</p>";

	const withImage = compileTemplate(template, {
		Image: "diagram.png",
		Question: "Examine diagram",
	});
	assert.equal(withImage, "<img src='diagram.png'><p>Examine diagram</p>");

	const withoutImage = compileTemplate(template, {
		Image: "",
		Question: "No image prompt",
	});
	assert.equal(withoutImage, "<p>No image prompt</p>");

	const whitespaceImage = compileTemplate(template, {
		Image: "   ",
		Question: "Whitespace image",
	});
	assert.equal(whitespaceImage, "<p>Whitespace image</p>");
});

test("anki-compiler: inverted conditionals {{^Field}}...{{/Field}}", () => {
	const template = "{{^Hint}}<span>No hint available</span>{{/Hint}}";

	const emptyHint = compileTemplate(template, { Hint: "" });
	assert.equal(emptyHint, "<span>No hint available</span>");

	const providedHint = compileTemplate(template, { Hint: "Think of gravity" });
	assert.equal(providedHint, "");
});

test("anki-compiler: rejects unknown field placeholder with descriptive error", () => {
	const template = "<div>{{UnknownField}}</div>";
	assert.throws(
		() => compileTemplate(template, { Question: "Test" }),
		/Unknown field placeholder in template: \{\{UnknownField\}\}/,
	);

	const conditionalTemplate = "{{#InvalidField}}Content{{/InvalidField}}";
	assert.throws(
		() => compileTemplate(conditionalTemplate, {}),
		/Unknown field in conditional block: \{\{#InvalidField\}\}/,
	);
});

test("anki-compiler: preserves raw quotes in attributes without double-escaping", () => {
	const template = '<div data-text="{{Option1}}"></div>';
	const fields = { Option1: 'Quote "test" and apostrophe \'sample\'' };

	const compiled = compileTemplate(template, fields);
	assert.equal(
		compiled,
		'<div data-text="Quote "test" and apostrophe \'sample\'"></div>',
	);
});

test("anki-compiler: compileCardSide loads and compiles real template files", () => {
	const sampleFields = {
		Question: "What is water?",
		Hint: "H2O",
		Image: '<img src="water.png" alt="Water molecule">',
		Option1: "Compound",
		Rationale1: "Two elements bonded",
		Flag1: "true",
		Option2: "Element",
		Rationale2: "Not a single atom",
		Flag2: "false",
		Option3: "Mixture",
		Rationale3: "Homogeneous chemical compound",
		Flag3: "false",
		Option4: "Plasma",
		Rationale4: "Liquid at room temp",
		Flag4: "false",
		QuestionType: "MULTIPLE_CHOICE",
		TargetAnswer: "",
		AcceptableAnswers: "",
		Rubric: "",
		GeneralRationale: "Water is composed of hydrogen and oxygen.",
	};

	const frontHtml = compileCardSide("front", sampleFields);
	assert.ok(frontHtml.includes("What is water?"));
	assert.ok(frontHtml.includes('src="water.png"'));
	assert.ok(!frontHtml.includes("{{Question}}"));

	const backHtml = compileCardSide("back", sampleFields);
	assert.ok(backHtml.includes("What is water?"));
	assert.ok(backHtml.includes("Two elements bonded"));
	assert.ok(!backHtml.includes("{{Question}}"));
});

test("anki-compiler: wrapInCardDocument creates valid HTML document with styles", () => {
	const wrapped = wrapInCardDocument("<div id='content'>Test Card</div>");
	assert.ok(wrapped.startsWith("<!DOCTYPE html>"));
	assert.ok(wrapped.includes('<body class="card">'));
	assert.ok(wrapped.includes("<style>"));
	assert.ok(wrapped.includes(".state-correct"));
	assert.ok(wrapped.includes("<div id='content'>Test Card</div>"));
});

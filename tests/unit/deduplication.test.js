// tests/unit/deduplication.test.js - Unit tests for question normalization and duplicate note filtering

import test from "node:test";
import assert from "node:assert/strict";
import {
	normalizeQuestionText,
	filterDuplicateNotes,
	mapCardsToAnkiNotes,
} from "../helpers/utils.js";

test("deduplication: normalizeQuestionText", async (t) => {
	await t.test("trims and converts question string to lowercase", () => {
		const raw = "   What is Kepler's Third Law?   ";
		const normalized = normalizeQuestionText(raw);
		assert.equal(normalized, "what is kepler's third law?");
	});

	await t.test(
		"handles punctuation and internal spacing consistently",
		() => {
			const raw = "Does Zn2+ have a [Ar] 3d10 shell?";
			assert.equal(
				normalizeQuestionText(raw),
				"does zn2+ have a [ar] 3d10 shell?",
			);
		},
	);

	await t.test(
		"handles null, undefined, and empty string without throwing",
		() => {
			assert.equal(normalizeQuestionText(""), "");
			assert.equal(normalizeQuestionText(null), "");
			assert.equal(normalizeQuestionText(undefined), "");
		},
	);
});

test("deduplication: filterDuplicateNotes", async (t) => {
	const sampleCards = [
		{
			question: "What is the pH of pure water at 25°C?",
			option1: "7",
			flag1: "True",
		},
		{
			question: "What is the speed of light in vacuum?",
			option1: "299,792,458 m/s",
			flag1: "True",
		},
		{
			question: "State the law of conservation of mass.",
			option1:
				"Mass is neither created nor destroyed in a chemical reaction.",
			flag1: "True",
		},
	];

	const notes = mapCardsToAnkiNotes(sampleCards, "Science::Test Deck");

	await t.test(
		"passes all notes when existing questions set is empty",
		() => {
			const emptySet = new Set();
			const result = filterDuplicateNotes(notes, emptySet);

			assert.equal(result.notesToSend.length, 3);
			assert.equal(result.skippedCount, 0);
		},
	);

	await t.test(
		"filters out exact duplicate questions and calculates skipped count",
		() => {
			const existingSet = new Set([
				normalizeQuestionText("What is the pH of pure water at 25°C?"),
			]);

			const result = filterDuplicateNotes(notes, existingSet);

			assert.equal(result.notesToSend.length, 2);
			assert.equal(result.skippedCount, 1);
			assert.equal(
				result.notesToSend[0].fields.Question,
				"What is the speed of light in vacuum?",
			);
			assert.equal(
				result.notesToSend[1].fields.Question,
				"State the law of conservation of mass.",
			);
		},
	);

	await t.test(
		"filters out duplicates regardless of case and surrounding whitespace",
		() => {
			const existingSet = new Set([
				"what is the speed of light in vacuum?",
			]);

			const result = filterDuplicateNotes(notes, existingSet);

			assert.equal(result.notesToSend.length, 2);
			assert.equal(result.skippedCount, 1);
			assert.equal(
				result.notesToSend[0].fields.Question,
				"What is the pH of pure water at 25°C?",
			);
		},
	);

	await t.test(
		"filters out all notes when all questions already exist in deck",
		() => {
			const existingSet = new Set([
				"what is the ph of pure water at 25°c?",
				"what is the speed of light in vacuum?",
				"state the law of conservation of mass.",
			]);

			const result = filterDuplicateNotes(notes, existingSet);

			assert.equal(result.notesToSend.length, 0);
			assert.equal(result.skippedCount, 3);
		},
	);

	await t.test("handles null or non-Set arguments safely", () => {
		const result1 = filterDuplicateNotes(notes, null);
		assert.equal(result1.notesToSend.length, 3);
		assert.equal(result1.skippedCount, 0);

		const result2 = filterDuplicateNotes(null, new Set());
		assert.equal(result2.notesToSend.length, 0);
		assert.equal(result2.skippedCount, 0);
	});
});

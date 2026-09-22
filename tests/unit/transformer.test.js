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
	findImageUrlsDeep,
	resolveCardsWithDomImages,
	findMatchingDomImage,
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

	await t.test(
		"resolves imageUrls from mostRecentQuery.imageUrls when top-level imageUrls is absent",
		() => {
			const payload = JSON.stringify({
				mostRecentQuery: {
					quiz: [
						{
							type: "multiple_choice",
							question: "What is KVL?",
							answerOptions: [{ text: "Law", isCorrect: true }],
						},
					],
					imageUrls: [
						"https://lh3.googleusercontent.com/notebooklm/nested_query_img.png",
					],
				},
			});
			const { quizData, imageUrls } = parseQuizJson(payload);

			assert.equal(quizData.length, 1);
			assert.deepEqual(imageUrls, [
				"https://lh3.googleusercontent.com/notebooklm/nested_query_img.png",
			]);
		},
	);

	await t.test(
		"resolves imageUrls from image_urls snake_case and deeply nested objects",
		() => {
			const payload = JSON.stringify({
				quiz: [
					{
						type: "multiple_choice",
						question: "What is Ohm's Law?",
						answerOptions: [{ text: "V=IR", isCorrect: true }],
					},
				],
				nestedSection: {
					deepTree: {
						image_urls: [
							"https://lh3.googleusercontent.com/deep/circuit.png",
						],
					},
				},
			});
			const { imageUrls } = parseQuizJson(payload);

			assert.equal(imageUrls.length, 1);
			assert.equal(
				imageUrls[0],
				"https://lh3.googleusercontent.com/deep/circuit.png",
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

	await t.test(
		"normalizes candidate images array containing object entries into string URLs",
		() => {
			const payloadWithObjectImages = JSON.stringify({
				quiz: [
					{
						question: "What is this component?",
						options: ["Diode", "Resistor"],
						answer: 0,
					},
				],
				images: [
					{
						url: "https://example.com/diode.png",
						alt: "Diode Diagram",
					},
					{
						src: "https://example.com/resistor.png",
						alt: "Resistor",
					},
					{ imageUrl: "https://example.com/capacitor.png" },
					"https://example.com/inductor.png",
				],
			});

			const { imageUrls } = parseQuizJson(payloadWithObjectImages);
			assert.deepEqual(imageUrls, [
				"https://example.com/diode.png",
				"https://example.com/resistor.png",
				"https://example.com/capacitor.png",
				"https://example.com/inductor.png",
			]);
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

	await t.test(
		"maps question-level q.imageUrls to diagramUrl and diagramAlt when q.question is plain text",
		() => {
			const quizQuestions = [
				{
					type: "multiple_choice",
					question:
						"Using the circuit shown, if V_2 = 4/3 V, what is the voltage across the 8 Ω resistor (v_1)?",
					imageUrls: [
						'![A circuit diagram for Example 4](image_reference_index:0 "Circuit_Analysis_Chapter_1.pdf")',
					],
					answerOptions: [
						{ text: "1.33 V", isCorrect: false },
						{ text: "-2.67 V", isCorrect: true },
					],
				},
			];
			const pageImageUrls = [
				"https://lh3.googleusercontent.com/notebooklm/AKYWMX_circuit_diagram.png",
			];

			const cards = mapQuizDataToCards(quizQuestions, pageImageUrls);

			assert.equal(cards.length, 1);
			const card = cards[0];
			assert.equal(
				card.question,
				"Using the circuit shown, if V_2 = 4/3 V, what is the voltage across the 8 Ω resistor (v_1)?",
			);
			assert.equal(
				card.diagramUrl,
				"https://lh3.googleusercontent.com/notebooklm/AKYWMX_circuit_diagram.png",
			);
			assert.equal(card.diagramAlt, "A circuit diagram for Example 4");
			assert.equal(card.diagramCaption, "Circuit_Analysis_Chapter_1.pdf");
			assert.equal(card.hasMediaReference, true);
		},
	);

	await t.test(
		"scopes prompt image reference index to question-local imageUrls array",
		() => {
			const multiQuestionData = [
				{
					question:
						"Question 1 prompt:\n\n![Diagram 1](image_reference_index:0)",
					options: ["A", "B"],
					answer: 0,
					imageUrls: ["https://example.com/local-image-q1.png"],
				},
				{
					question:
						"Question 2 prompt:\n\n![Diagram 2](image_reference_index:0)",
					options: ["C", "D"],
					answer: 1,
					imageUrls: ["https://example.com/local-image-q2.png"],
				},
			];

			const cards = mapQuizDataToCards(multiQuestionData, [
				"https://example.com/global-image.png",
			]);

			assert.equal(cards.length, 2);
			assert.equal(
				cards[0].diagramUrl,
				"https://example.com/local-image-q1.png",
				"Question 1 index 0 should resolve to question 1 local image",
			);
			assert.equal(
				cards[1].diagramUrl,
				"https://example.com/local-image-q2.png",
				"Question 2 index 0 should resolve to question 2 local image",
			);
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

test("transformer: findImageUrlsDeep", async (t) => {
	await t.test(
		"recursively traverses complex nested objects and extracts unique image URLs",
		() => {
			const nestedData = {
				level1: {
					level2: {
						imageUrls: [
							"https://lh3.googleusercontent.com/img1.png",
							"https://lh3.googleusercontent.com/img2.png",
						],
						other: "test",
					},
					directImage: "https://lh3.googleusercontent.com/img3.png",
				},
				unrelated: 42,
			};

			const urls = findImageUrlsDeep(nestedData);
			assert.equal(urls.length, 3);
			assert.ok(urls.includes("https://lh3.googleusercontent.com/img1.png"));
			assert.ok(urls.includes("https://lh3.googleusercontent.com/img2.png"));
			assert.ok(urls.includes("https://lh3.googleusercontent.com/img3.png"));
		},
	);

	await t.test("handles circular references gracefully without stack overflow", () => {
		const objA = { name: "A" };
		const objB = {
			name: "B",
			imageUrls: ["https://lh3.googleusercontent.com/circle.png"],
		};
		objA.b = objB;
		objB.a = objA;

		const urls = findImageUrlsDeep(objA);
		assert.equal(urls.length, 1);
		assert.equal(urls[0], "https://lh3.googleusercontent.com/circle.png");
	});

	await t.test("rejects non-image web URLs such as citations and documentation links", () => {
		const dataWithCitations = {
			sources: [
				"https://en.wikipedia.org/wiki/Kirchhoff_laws",
				"https://example.com/physics/lecture-notes.html",
				"https://google.com/search?q=circuits",
			],
			nested: {
				validMedia: "https://lh3.googleusercontent.com/circuit.png",
				googleUserContent: "https://notes.usercontent.goog/diagram.svg",
				blobMedia: "blob:https://notebooklm.google.com/12345-blob",
				citationLink: "https://academic.oup.com/article/12345",
			},
		};

		const urls = findImageUrlsDeep(dataWithCitations);
		assert.equal(urls.length, 3);
		assert.ok(urls.includes("https://lh3.googleusercontent.com/circuit.png"));
		assert.ok(urls.includes("https://notes.usercontent.goog/diagram.svg"));
		assert.ok(urls.includes("blob:https://notebooklm.google.com/12345-blob"));
		assert.ok(!urls.includes("https://en.wikipedia.org/wiki/Kirchhoff_laws"));
		assert.ok(!urls.includes("https://example.com/physics/lecture-notes.html"));
	});

	await t.test(
		"accepts modern web formats including avif and rejects legacy formats like bmp, ico, and tiff",
		() => {
			const mixedMediaData = {
				images: [
					"https://example.com/figure1.avif",
					"https://example.com/figure2.webp",
					"https://example.com/figure3.png",
					"https://example.com/legacy1.bmp",
					"https://example.com/favicon.ico",
					"https://example.com/scan.tif",
					"https://example.com/scan.tiff",
				],
			};

			const urls = findImageUrlsDeep(mixedMediaData);
			assert.equal(urls.length, 3);
			assert.ok(urls.includes("https://example.com/figure1.avif"));
			assert.ok(urls.includes("https://example.com/figure2.webp"));
			assert.ok(urls.includes("https://example.com/figure3.png"));
			assert.ok(!urls.includes("https://example.com/legacy1.bmp"));
			assert.ok(!urls.includes("https://example.com/favicon.ico"));
			assert.ok(!urls.includes("https://example.com/scan.tif"));
			assert.ok(!urls.includes("https://example.com/scan.tiff"));
		},
	);
});

test("transformer: resolveCardsWithDomImages", async (t) => {
	await t.test("matches cards with missing diagramUrl against DOM images by caption", () => {
		const cards = [
			{
				question: "What is KVL?",
				diagramUrl: "",
				diagramAlt: "Circuit Diagram",
				diagramCaption: "Circuit_Analysis_Chapter_1.pdf",
				hasMediaReference: true,
			},
		];

		// Mock DOM environment
		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/resolved_circuit.png",
							alt: "Circuit Diagram",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Circuit_Analysis_Chapter_1.pdf" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/resolved_circuit.png",
		);
		assert.equal(resolved[0].diagramCaption, "Circuit_Analysis_Chapter_1.pdf");
	});

	await t.test("leaves cards with existing diagramUrl unchanged", () => {
		const cards = [
			{
				question: "What is Ohm's Law?",
				diagramUrl: "https://example.com/existing.png",
				diagramAlt: "Alt",
				diagramCaption: "Caption",
				hasMediaReference: true,
			},
		];

		const resolved = resolveCardsWithDomImages(cards, null);
		assert.equal(resolved[0].diagramUrl, "https://example.com/existing.png");
	});

	await t.test("matches filenames containing spaces in both card caption and DOM", () => {
		const cards = [
			{
				question: "What is KVL?",
				diagramUrl: "",
				diagramAlt: "Circuit Diagram",
				diagramCaption: "Circuit Analysis Chapter 1.pdf",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/resolved_with_spaces.png",
							alt: "Circuit Diagram",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Circuit Analysis Chapter 1.pdf" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/resolved_with_spaces.png",
		);
		assert.equal(resolved[0].diagramCaption, "Circuit Analysis Chapter 1.pdf");
	});

	await t.test("matches card caption with underscores against DOM caption with spaces", () => {
		const cards = [
			{
				question: "What is KCL?",
				diagramUrl: "",
				diagramAlt: "Nodal Diagram",
				diagramCaption: "Circuit_Analysis_Chapter_1.pdf",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/spaces_caption.png",
							alt: "Nodal Diagram",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Circuit Analysis Chapter 1.pdf" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/spaces_caption.png",
		);
	});

	await t.test("matches card caption with spaces against DOM caption with underscores", () => {
		const cards = [
			{
				question: "What is Ohm's Law?",
				diagramUrl: "",
				diagramAlt: "Schematic",
				diagramCaption: "Basic Circuit Theory.pdf",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/underscores_caption.png",
							alt: "Schematic",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Basic_Circuit_Theory.pdf" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/underscores_caption.png",
		);
	});

	await t.test("matches card caption with URL-encoded spaces (%20)", () => {
		const cards = [
			{
				question: "What is the equivalent resistance?",
				diagramUrl: "",
				diagramAlt: "Resistor Network",
				diagramCaption: "Resistor%20Network%20Guide.pdf",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/percent20_resolved.png",
							alt: "Resistor Network",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Resistor Network Guide.pdf" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/percent20_resolved.png",
		);
	});

	await t.test("matches caption with casing differences and surrounding text in DOM", () => {
		const cards = [
			{
				question: "Find the Thevenin equivalent:",
				diagramUrl: "",
				diagramAlt: "Thevenin",
				diagramCaption: "thevenin theorem.pdf",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/thevenin.png",
							alt: "Thevenin",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Source: Thevenin Theorem.pdf (Page 45)" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/thevenin.png",
		);
	});

	await t.test("matches by alt text containing spaces when caption is omitted", () => {
		const cards = [
			{
				question: "What is shown in the image?",
				diagramUrl: "",
				diagramAlt: "Kirchhoff Voltage Law Loop Diagram",
				diagramCaption: "",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/alt_matched.png",
							alt: "Kirchhoff Voltage Law Loop Diagram",
							parentElement: {
								querySelector: () => null,
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 1);
		assert.equal(
			resolved[0].diagramUrl,
			"https://lh3.googleusercontent.com/alt_matched.png",
		);
	});

	await t.test("disambiguates multiple cards and images with filenames containing spaces", () => {
		const cards = [
			{
				question: "Question 1",
				diagramUrl: "",
				diagramAlt: "Diag 1",
				diagramCaption: "Chapter 1 Intro.pdf",
				hasMediaReference: true,
			},
			{
				question: "Question 2",
				diagramUrl: "",
				diagramAlt: "Diag 2",
				diagramCaption: "Chapter 2 Advanced.pdf",
				hasMediaReference: true,
			},
		];

		const mockDom = {
			querySelectorAll: (selector) => {
				if (selector.includes("img")) {
					return [
						{
							src: "https://lh3.googleusercontent.com/ch2.png",
							alt: "Diag 2",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Chapter 2 Advanced.pdf" };
									}
									return null;
								},
							},
						},
						{
							src: "https://lh3.googleusercontent.com/ch1.png",
							alt: "Diag 1",
							parentElement: {
								querySelector: (subSelector) => {
									if (subSelector.includes("caption")) {
										return { textContent: "Chapter 1 Intro.pdf" };
									}
									return null;
								},
							},
						},
					];
				}
				return [];
			},
		};

		const resolved = resolveCardsWithDomImages(cards, mockDom);
		assert.equal(resolved.length, 2);
		assert.equal(resolved[0].diagramUrl, "https://lh3.googleusercontent.com/ch1.png");
		assert.equal(resolved[1].diagramUrl, "https://lh3.googleusercontent.com/ch2.png");
	});

	await t.test(
		"prevents 1-to-many collision when multiple cards share identical captions and only 1 image exists in DOM",
		() => {
			const cards = [
				{
					question: "Question 1 about Circuit Node 1",
					diagramUrl: "",
					diagramCaption: "Source: Lecture_Notes.pdf (Page 5)",
					hasMediaReference: true,
				},
				{
					question: "Question 2 about Circuit Node 2",
					diagramUrl: "",
					diagramCaption: "Source: Lecture_Notes.pdf (Page 5)",
					hasMediaReference: true,
				},
			];

			// Only 1 image rendered in DOM due to NotebookLM lazy-loading
			const mockDom = {
				querySelectorAll: (selector) => {
					if (selector.includes("img")) {
						return [
							{
								src: "https://lh3.googleusercontent.com/node1_diagram.png",
								alt: "Node 1 Diagram",
								parentElement: {
									querySelector: (subSelector) => {
										if (subSelector.includes("caption")) {
											return {
												textContent:
													"Source: Lecture_Notes.pdf (Page 5)",
											};
										}
										return null;
									},
								},
							},
						];
					}
					return [];
				},
			};

			const resolved = resolveCardsWithDomImages(cards, mockDom);
			assert.equal(resolved.length, 2);
			assert.equal(
				resolved[0].diagramUrl,
				"https://lh3.googleusercontent.com/node1_diagram.png",
			);
			// Card 2 must NOT receive Card 1's image; it must remain unresolved
			assert.equal(
				resolved[1].diagramUrl,
				"",
				"Second card sharing caption should not claim already assigned DOM image",
			);
		},
	);

	await t.test(
		"does not match unrelated document captions when parent container lacks caption element",
		() => {
			const cards = [
				{
					question: "Question about uncaptioned diagram",
					diagramUrl: "",
					diagramCaption: "Unrelated Chapter 9.pdf",
					hasMediaReference: true,
				},
			];

			// Image whose parent has no caption, but searchRoot would have returned a caption
			const mockDom = {
				querySelectorAll: (selector) => {
					if (selector.includes("img")) {
						return [
							{
								src: "https://lh3.googleusercontent.com/uncaptioned.png",
								alt: "",
								parentElement: {
									querySelector: () => null, // No caption in parent
								},
							},
						];
					}
					return [];
				},
				querySelector: (selector) => {
					if (selector.includes("caption")) {
						return { textContent: "Unrelated Chapter 9.pdf" };
					}
					return null;
				},
			};

			const resolved = resolveCardsWithDomImages(cards, mockDom);
			assert.equal(resolved.length, 1);
			assert.equal(
				resolved[0].diagramUrl,
				"",
				"Should not match caption from document-wide searchRoot fallback",
			);
		},
	);

	await t.test(
		"resolves high-resolution data-src when img.src contains placeholder",
		() => {
			const cards = [
				{
					question: "Analyze the lazy-loaded diagram",
					diagramUrl: "",
					diagramCaption: "High-Res Schematic",
					hasMediaReference: true,
				},
			];

			const mockDom = {
				querySelectorAll: (selector) => {
					if (selector.includes("img")) {
						return [
							{
								src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
								getAttribute: (name) => {
									if (name === "data-src") {
										return "https://lh3.googleusercontent.com/high_res_diagram.png";
									}
									return null;
								},
								parentElement: {
									querySelector: (subSelector) => {
										if (subSelector.includes("caption")) {
											return { textContent: "High-Res Schematic" };
										}
										return null;
									},
								},
							},
						];
					}
					return [];
				},
			};

			const resolved = resolveCardsWithDomImages(cards, mockDom);
			assert.equal(resolved.length, 1);
			assert.equal(
				resolved[0].diagramUrl,
				"https://lh3.googleusercontent.com/high_res_diagram.png",
			);
		},
	);
});

test("transformer: findMatchingDomImage", async (t) => {
	await t.test(
		"preserves 1-to-1 matching and skips already assigned DOM images when cards share generic alt text",
		() => {
			const img1 = {
				src: "https://example.com/figure1.png",
				alt: "Diagram",
			};
			const img2 = {
				src: "https://example.com/figure2.png",
				alt: "Diagram",
			};
			const domImages = [img1, img2];
			const assignedImages = new Set();

			const card1 = {
				question: "Card 1 with generic alt",
				diagramAlt: "Diagram",
				hasMediaReference: true,
			};
			const match1 = findMatchingDomImage(card1, domImages, assignedImages);
			assert.equal(match1, img1);
			assignedImages.add(match1);

			const card2 = {
				question: "Card 2 with generic alt",
				diagramAlt: "Diagram",
				hasMediaReference: true,
			};
			const match2 = findMatchingDomImage(card2, domImages, assignedImages);
			assert.equal(match2, img2);
			assert.notEqual(match1, match2);
			assignedImages.add(match2);

			const card3 = {
				question: "Card 3 with generic alt",
				diagramAlt: "Diagram",
				hasMediaReference: true,
			};
			const match3 = findMatchingDomImage(card3, domImages, assignedImages);
			assert.equal(match3, null);
		},
	);

	await t.test(
		"prioritizes exact URL match over alt text match",
		() => {
			const imgByAlt = {
				src: "https://example.com/other.png",
				alt: "Circuit Schematic",
			};
			const imgByUrl = {
				src: "https://example.com/exact-circuit.png",
				alt: "Unrelated Alt",
			};
			const domImages = [imgByAlt, imgByUrl];

			const card = {
				question: "Analyze circuit",
				diagramUrl: "https://example.com/exact-circuit.png",
				diagramAlt: "Circuit Schematic",
				hasMediaReference: true,
			};

			const match = findMatchingDomImage(card, domImages);
			assert.equal(match, imgByUrl);
		},
	);

	await t.test(
		"returns null when inputs are invalid or missing",
		() => {
			assert.equal(findMatchingDomImage(null, []), null);
			assert.equal(findMatchingDomImage({}, null), null);
			assert.equal(
				findMatchingDomImage({ question: "No media references" }, [
					{ src: "https://example.com/img.png", alt: "Img" },
				]),
				null,
			);
		},
	);
});

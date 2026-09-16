// utils.js - Shared utilities for NotebookLM to Anki Extension

(function () {
	/**
	 * Unescapes standard HTML entities in a string.
	 *
	 * @param {string} str - The raw string containing HTML entities.
	 * @returns {string} The unescaped string.
	 */
	function unescapeHtml(str) {
		if (!str) return "";
		return str
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&#39;/g, "'");
	}

	/**
	 * Cleans and normalizes a notebook title for use in Anki deck hierarchies.
	 * Replaces Anki subdeck separator colons ('::') with dashes and applies fallback defaults.
	 *
	 * @param {string|null|undefined} title - The raw notebook title.
	 * @returns {string} The sanitized notebook title.
	 */
	function cleanNotebookTitle(title) {
		let nbTitle = title;
		if (!nbTitle || nbTitle === "NotebookLM") {
			nbTitle = "Unknown Notebook";
		}
		return nbTitle.replace(/::/g, " - ").trim();
	}

	/**
	 * Cleans and normalizes a quiz title by stripping redundant prefixes and suffixes,
	 * replacing Anki subdeck separator colons ('::'), and applying fallback defaults.
	 *
	 * @param {string|null|undefined} title - The raw quiz title.
	 * @returns {string} The sanitized quiz title.
	 */
	function cleanQuizTitle(title) {
		let quizTitle = title || "Quiz";
		quizTitle = quizTitle.replace(/::/g, " - ").trim();
		// Remove "Quiz | ", "Quiz - ", "Quiz: " prefix if it exists (case-insensitive)
		quizTitle = quizTitle.replace(/^Quiz\s*[|\-:]\s*/i, "");
		// Remove " Quiz" suffix if it exists (case-insensitive)
		quizTitle = quizTitle.replace(/\s*Quiz$/i, "").trim();
		return quizTitle || "Quiz";
	}

	/**
	 * Formats a hierarchical Anki deck name from notebook and quiz titles using a template.
	 *
	 * @param {string|null|undefined} notebookName - The notebook title.
	 * @param {string|null|undefined} quizTitle - The quiz title.
	 * @param {string} [template="NotebookLM::{notebookName}::Quizzes::{quizName}"] - Template string with placeholders.
	 * @returns {string} The formatted destination deck title.
	 */
	function formatDeckTitle(
		notebookName,
		quizTitle,
		template = "NotebookLM::{notebookName}::Quizzes::{quizName}",
	) {
		const formattedNbTitle = cleanNotebookTitle(notebookName);
		const formattedQuizTitle = cleanQuizTitle(quizTitle);

		return template
			.replace("{notebookName}", formattedNbTitle)
			.replace("{quizName}", formattedQuizTitle);
	}

	/**
	 * Formats raw error messages (including Python-style stringified lists from AnkiConnect)
	 * by counting and summarizing duplicate error occurrences.
	 *
	 * @param {string|Array<string>|null|undefined} errorVal - The raw error payload from AnkiConnect.
	 * @returns {string} A human-readable summarized error string.
	 */
	function formatErrorMessage(errorVal) {
		if (!errorVal) return "Unknown Error";

		let errorStr = "";
		if (Array.isArray(errorVal)) {
			errorStr = JSON.stringify(errorVal);
		} else {
			errorStr = String(errorVal);
		}

		let messages = [];
		if (errorStr.trim().startsWith("[") && errorStr.trim().endsWith("]")) {
			try {
				const regex = /['"](.*?)['"]/g;
				const matches = errorStr.matchAll(regex);
				for (const match of matches) {
					messages.push(match[1]);
				}
			} catch {
				messages = [errorStr];
			}
		} else {
			messages = [errorStr];
		}

		if (messages.length === 0) {
			messages = [errorStr];
		}

		const counts = {};
		for (const msg of messages) {
			counts[msg] = (counts[msg] || 0) + 1;
		}

		const formattedLines = Object.entries(counts).map(([msg, count]) => {
			if (count > 1) {
				return `${msg} (x${count})`;
			}
			return msg;
		});

		return formattedLines.join("\n");
	}

	/**
	 * Parses and validates raw NotebookLM JSON string extracted from the DOM.
	 *
	 * @param {string} jsonString - The raw, potentially HTML-escaped JSON data.
	 * @returns {{ quizData: Array<object>, title: string|undefined }} The extracted quiz items and title.
	 * @throws {Error} When the payload is invalid, empty, or contains no quiz questions.
	 */
	function parseQuizJson(jsonString) {
		if (!jsonString) {
			throw new Error("Raw JSON string is empty.");
		}

		let data;
		try {
			data = JSON.parse(jsonString);
		} catch {
			const cleanJson = unescapeHtml(jsonString);
			data = JSON.parse(cleanJson);
		}

		const quizData = data.quiz || data.mostRecentQuery?.quiz;

		if (!quizData || !Array.isArray(quizData) || quizData.length === 0) {
			throw new Error("0 Questions Found.");
		}

		return {
			quizData,
			title: data.title,
		};
	}

	/**
	 * Maps raw quiz question objects to normalized 4-option flashcard objects.
	 * Preserves LaTeX formulas, option rationales, and correctness flags.
	 *
	 * @param {Array<object>} quizData - Array of question objects from NotebookLM.
	 * @returns {Array<object>} Normalized card objects.
	 */
	function mapQuizDataToCards(quizData) {
		if (!Array.isArray(quizData)) return [];

		return quizData.map((q) => {
			const options = q.answerOptions || [];
			return {
				question: q.question || "",
				hint: q.hint || "",

				// Option 1
				option1: options[0]?.text || "",
				flag1: options[0]?.isCorrect ? "True" : "False",
				rationale1: options[0]?.rationale || "",

				// Option 2
				option2: options[1]?.text || "",
				flag2: options[1]?.isCorrect ? "True" : "False",
				rationale2: options[1]?.rationale || "",

				// Option 3
				option3: options[2]?.text || "",
				flag3: options[2]?.isCorrect ? "True" : "False",
				rationale3: options[2]?.rationale || "",

				// Option 4
				option4: options[3]?.text || "",
				flag4: options[3]?.isCorrect ? "True" : "False",
				rationale4: options[3]?.rationale || "",
			};
		});
	}

	/**
	 * Maps normalized flashcard objects into AnkiConnect note payload objects
	 * adhering to the 15-field NotebookLM Quiz model specification.
	 *
	 * @param {Array<object>} cards - Array of normalized card objects.
	 * @param {string} targetDeck - Name of the target Anki deck.
	 * @param {string} [noteType="NotebookLM Quiz"] - Anki note type model name.
	 * @returns {Array<object>} Array of AnkiConnect note structures.
	 */
	function mapCardsToAnkiNotes(
		cards,
		targetDeck,
		noteType = "NotebookLM Quiz",
	) {
		if (!Array.isArray(cards)) return [];

		return cards.map((card) => {
			return {
				deckName: targetDeck,
				modelName: noteType,
				fields: {
					// Header fields
					Question: card.question || "",
					Hint: card.hint || "",
					ArchDiagram: "",

					// Option 1 (Rationale first)
					Option1: card.option1 || "",
					Rationale1: card.rationale1 || "",
					Flag1: card.flag1 || "False",

					// Option 2 (Flag first)
					Option2: card.option2 || "",
					Flag2: card.flag2 || "False",
					Rationale2: card.rationale2 || "",

					// Option 3 (Flag first)
					Option3: card.option3 || "",
					Flag3: card.flag3 || "False",
					Rationale3: card.rationale3 || "",

					// Option 4 (Flag first)
					Option4: card.option4 || "",
					Flag4: card.flag4 || "False",
					Rationale4: card.rationale4 || "",
				},
				options: {
					allowDuplicate: true,
				},
				tags: ["notebooklm_export"],
			};
		});
	}

	/**
	 * Normalizes a question string for consistent deduplication comparisons.
	 *
	 * @param {string|null|undefined} text - The question text.
	 * @returns {string} Trimmed and lowercased question text.
	 */
	function normalizeQuestionText(text) {
		return (text || "").trim().toLowerCase();
	}

	/**
	 * Filters incoming notes against an existing set of question texts.
	 *
	 * @param {Array<object>} notes - Array of Anki note objects with fields.Question.
	 * @param {Set<string>} existingQuestionsSet - Set of normalized question texts already in Anki.
	 * @returns {{ notesToSend: Array<object>, skippedCount: number }} Filtered notes and skipped duplicate count.
	 */
	function filterDuplicateNotes(notes, existingQuestionsSet) {
		if (!Array.isArray(notes)) return { notesToSend: [], skippedCount: 0 };
		if (!existingQuestionsSet || !(existingQuestionsSet instanceof Set)) {
			return { notesToSend: notes, skippedCount: 0 };
		}

		let skippedCount = 0;
		const notesToSend = notes.filter((n) => {
			const qText = normalizeQuestionText(n.fields?.Question);
			if (existingQuestionsSet.has(qText)) {
				skippedCount++;
				return false;
			}
			return true;
		});

		return {
			notesToSend,
			skippedCount,
		};
	}

	const utils = {
		unescapeHtml,
		cleanNotebookTitle,
		cleanQuizTitle,
		formatDeckTitle,
		formatErrorMessage,
		parseQuizJson,
		mapQuizDataToCards,
		mapCardsToAnkiNotes,
		normalizeQuestionText,
		filterDuplicateNotes,
	};

	// Expose globally for service worker, content script, and test environments
	if (typeof globalThis !== "undefined") {
		globalThis.NotebookLMToAnkiUtils = utils;
	}
})();

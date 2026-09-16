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
	 * Extracts inline markdown image references (e.g. `![alt](image_reference_index:0 "caption")`)
	 * from question text, cleans the prompt, and resolves the image URL from the provided array.
	 *
	 * @param {string|null|undefined} questionText - Raw question text possibly containing markdown image tags.
	 * @param {Array<string>} [imageUrls=[]] - Array of resolved image URLs extracted from the page.
	 * @returns {{ cleanQuestion: string, mediaUrl: string, alt: string, caption: string }} Extracted media metadata and sanitized prompt.
	 */
	function extractQuestionMedia(questionText, imageUrls = []) {
		if (!questionText) {
			return { cleanQuestion: "", mediaUrl: "", alt: "", caption: "" };
		}

		const indexedRegex =
			/!\[(.*?)\]\(image_reference_index:(\d+)(?:\s*"(.*?)")?\)/;
		const indexedMatch = questionText.match(indexedRegex);

		if (indexedMatch) {
			const alt = (indexedMatch[1] || "").trim();
			const index = parseInt(indexedMatch[2], 10);
			const caption = (indexedMatch[3] || "").trim();
			const mediaUrl =
				Array.isArray(imageUrls) && imageUrls[index]
					? imageUrls[index]
					: "";
			const cleanQuestion = questionText
				.replace(indexedMatch[0], "")
				.trim();

			return {
				cleanQuestion,
				mediaUrl,
				alt,
				caption,
			};
		}

		const directUrlRegex =
			/!\[(.*?)\]\(((?:https?:\/\/|\/)[^\s)]+)(?:\s*"(.*?)")?\)/;
		const directMatch = questionText.match(directUrlRegex);

		if (directMatch) {
			const alt = (directMatch[1] || "").trim();
			const mediaUrl = (directMatch[2] || "").trim();
			const caption = (directMatch[3] || "").trim();
			const cleanQuestion = questionText
				.replace(directMatch[0], "")
				.trim();

			return {
				cleanQuestion,
				mediaUrl,
				alt,
				caption,
			};
		}

		return {
			cleanQuestion: questionText.trim(),
			mediaUrl: "",
			alt: "",
			caption: "",
		};
	}

	/**
	 * Sanitizes topic strings from Google Notebook into valid, compliant Anki tags.
	 * Replaces spaces with underscores and removes invalid tag characters.
	 *
	 * @param {Array<string>|null|undefined} topics - Array of raw topic names.
	 * @returns {Array<string>} Array of sanitized Anki tag strings.
	 */
	function sanitizeTopicTags(topics) {
		if (!Array.isArray(topics)) return [];

		return topics
			.map((t) => {
				if (!t || typeof t !== "string") return "";
				return t
					.trim()
					.replace(/\s+/g, "_")
					.replace(/[^\w-]/g, "")
					.replace(/_+/g, "_")
					.replace(/^_|_$/g, "");
			})
			.filter((t) => t.length > 0);
	}

	/**
	 * Normalizes a fill-in-the-blank user response or accepted answer string
	 * by trimming whitespace, converting to lowercase, and stripping optional math delimiters.
	 *
	 * @param {string|null|undefined} text - Raw answer text.
	 * @returns {string} Normalized string suitable for direct comparison.
	 */
	function normalizeBlankAnswer(text) {
		if (!text) return "";
		return String(text)
			.trim()
			.toLowerCase()
			.replace(/^\$+|\$+$/g, "")
			.trim();
	}

	/**
	 * Parses and validates raw NotebookLM JSON string extracted from the DOM,
	 * optionally incorporating image URLs and covered topic metadata.
	 *
	 * @param {string} jsonString - The raw, potentially HTML-escaped JSON data.
	 * @param {string|Array<string>|null|undefined} [imageUrlsPayload=null] - Image URLs attribute or array.
	 * @returns {{ quizData: Array<object>, title: string|undefined, topicsCovered: Array<string>, imageUrls: Array<string> }} Extracted quiz items, metadata, and assets.
	 * @throws {Error} When the payload is invalid, empty, or contains no quiz questions.
	 */
	function parseQuizJson(jsonString, imageUrlsPayload = null) {
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

		let imageUrls = [];
		if (Array.isArray(imageUrlsPayload)) {
			imageUrls = imageUrlsPayload;
		} else if (
			typeof imageUrlsPayload === "string" &&
			imageUrlsPayload.trim()
		) {
			try {
				const parsed = JSON.parse(imageUrlsPayload);
				if (Array.isArray(parsed)) imageUrls = parsed;
			} catch {
				const clean = unescapeHtml(imageUrlsPayload);
				try {
					const parsed = JSON.parse(clean);
					if (Array.isArray(parsed)) imageUrls = parsed;
				} catch {}
			}
		}

		if (imageUrls.length === 0 && Array.isArray(data.imageUrls)) {
			imageUrls = data.imageUrls;
		}

		const rawTopics =
			data.topics?.covered || data.mostRecentQuery?.topics?.covered || [];

		return {
			quizData,
			title: data.title,
			topicsCovered: Array.isArray(rawTopics) ? rawTopics : [],
			imageUrls,
		};
	}

	/**
	 * Maps raw quiz question objects to normalized flashcard objects across all four
	 * supported question types (multiple_choice, multiple_select, fill_in_the_blank, short_answer).
	 * Preserves LaTeX formulas, option rationales, correctness flags, and media references.
	 *
	 * @param {Array<object>} quizData - Array of question objects from NotebookLM.
	 * @param {Array<string>} [imageUrls=[]] - Array of resolved image URLs extracted from the page.
	 * @returns {Array<object>} Normalized card objects.
	 */
	function mapQuizDataToCards(quizData, imageUrls = []) {
		if (!Array.isArray(quizData)) return [];

		return quizData.map((q) => {
			const media = extractQuestionMedia(q.question || "", imageUrls);
			const rawType = (q.type || "").toLowerCase();

			let questionType = "MULTIPLE_CHOICE";
			if (
				rawType === "multiple_select" ||
				(!rawType &&
					q.answerOptions?.filter((o) => o.isCorrect).length > 1)
			) {
				questionType = "MULTIPLE_SELECT";
			} else if (
				rawType === "fill_in_the_blank" ||
				(!rawType && q.bestAnswer !== undefined)
			) {
				questionType = "FILL_IN_THE_BLANK";
			} else if (
				rawType === "short_answer" ||
				(!rawType && q.grading !== undefined)
			) {
				questionType = "SHORT_ANSWER";
			}

			const options = q.answerOptions || [];

			let rubricText = "";
			if (
				q.grading?.requiredAttributes &&
				Array.isArray(q.grading.requiredAttributes)
			) {
				rubricText = q.grading.requiredAttributes
					.map((attr) => `• ${attr}`)
					.join("\n");
			}
			if (
				q.grading?.errors?.misconceptions &&
				Array.isArray(q.grading.errors.misconceptions) &&
				q.grading.errors.misconceptions.length > 0
			) {
				const misc = q.grading.errors.misconceptions
					.map((m) => `⚠️ ${m}`)
					.join("\n");
				rubricText = rubricText ? `${rubricText}\n\n${misc}` : misc;
			}

			const acceptableList = Array.isArray(q.acceptableAnswers)
				? q.acceptableAnswers.join(", ")
				: q.acceptableAnswers || "";

			return {
				question: media.cleanQuestion,
				hint: q.hint || "",
				questionType,

				// Media references
				diagramUrl: media.mediaUrl || "",
				diagramAlt: media.alt || "",
				diagramCaption: media.caption || "",
				image: "",

				// Multi-choice & Multi-select Options
				option1: options[0]?.text || "",
				flag1: options[0]?.isCorrect ? "True" : "False",
				rationale1: options[0]?.rationale || "",

				option2: options[1]?.text || "",
				flag2: options[1]?.isCorrect ? "True" : "False",
				rationale2: options[1]?.rationale || "",

				option3: options[2]?.text || "",
				flag3: options[2]?.isCorrect ? "True" : "False",
				rationale3: options[2]?.rationale || "",

				option4: options[3]?.text || "",
				flag4: options[3]?.isCorrect ? "True" : "False",
				rationale4: options[3]?.rationale || "",

				// Fill in the Blank & Short Answer target data
				targetAnswer: q.bestAnswer || q.grading?.modelAnswer || "",
				acceptableAnswers: acceptableList,
				rubric: rubricText,
				generalRationale: q.rationale || q.grading?.rationale || "",
			};
		});
	}

	/**
	 * Maps normalized flashcard objects into AnkiConnect note payload objects
	 * adhering to the enhanced NotebookLM Quiz model specification with 'Image' and adaptive fields.
	 *
	 * @param {Array<object>} cards - Array of normalized card objects.
	 * @param {string} targetDeck - Name of the target Anki deck.
	 * @param {string} [noteType="NotebookLM Quiz"] - Anki note type model name.
	 * @param {Array<string>} [topicTags=[]] - Optional array of sanitized topic tag strings.
	 * @returns {Array<object>} Array of AnkiConnect note structures.
	 */
	function mapCardsToAnkiNotes(
		cards,
		targetDeck,
		noteType = "NotebookLM Quiz",
		topicTags = [],
	) {
		if (!Array.isArray(cards)) return [];

		const allTags = ["notebooklm_export", "google_notebook_export"];
		if (Array.isArray(topicTags)) {
			topicTags.forEach((t) => {
				if (t && !allTags.includes(t)) allTags.push(t);
			});
		}

		return cards.map((card) => {
			return {
				deckName: targetDeck,
				modelName: noteType,
				fields: {
					// Header fields
					Question: card.question || "",
					Hint: card.hint || "",
					Image: card.image || "",

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

					// Adaptive multi-format fields
					QuestionType: card.questionType || "MULTIPLE_CHOICE",
					TargetAnswer: card.targetAnswer || "",
					AcceptableAnswers: card.acceptableAnswers || "",
					Rubric: card.rubric || "",
					GeneralRationale: card.generalRationale || "",
				},
				options: {
					allowDuplicate: true,
				},
				tags: allTags,
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

	/**
	 * Shared utility functions exported by the module.
	 * @type {{
	 *   unescapeHtml: function(string): string,
	 *   cleanNotebookTitle: function((string|null|undefined)): string,
	 *   cleanQuizTitle: function((string|null|undefined)): string,
	 *   formatDeckTitle: function((string|null|undefined), (string|null|undefined), string=): string,
	 *   formatErrorMessage: function((string|Array<string>|null|undefined)): string,
	 *   extractQuestionMedia: function((string|null|undefined), Array<string>=): { cleanQuestion: string, mediaUrl: string, alt: string, caption: string },
	 *   sanitizeTopicTags: function((Array<string>|null|undefined)): Array<string>,
	 *   normalizeBlankAnswer: function((string|null|undefined)): string,
	 *   parseQuizJson: function(string, (string|Array<string>|null|undefined)=): { quizData: Array<object>, title: (string|undefined), topicsCovered: Array<string>, imageUrls: Array<string> },
	 *   mapQuizDataToCards: function(Array<object>, Array<string>=): Array<object>,
	 *   mapCardsToAnkiNotes: function(Array<object>, string, string=, Array<string>=): Array<object>,
	 *   normalizeQuestionText: function((string|null|undefined)): string,
	 *   filterDuplicateNotes: function(Array<object>, Set<string>): { notesToSend: Array<object>, skippedCount: number }
	 * }}
	 */
	const utils = {
		unescapeHtml,
		cleanNotebookTitle,
		cleanQuizTitle,
		formatDeckTitle,
		formatErrorMessage,
		extractQuestionMedia,
		sanitizeTopicTags,
		normalizeBlankAnswer,
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

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
	 * Extracts inline markdown image references (e.g. `![alt](image_reference_index:0 "caption")`),
	 * direct URLs, or HTML image tags from question text or candidate media sources, cleans the prompt,
	 * and resolves the image URL from the provided array.
	 *
	 * @param {string|null|undefined} questionText - Raw question text possibly containing markdown image tags.
	 * @param {Array<string>} [imageUrls=[]] - Array of resolved image URLs extracted from the page.
	 * @param {Array<string|object>} [additionalSources=[]] - Optional array of question-level media fields (e.g. q.imageUrls).
	 * @returns {{ cleanQuestion: string, mediaUrl: string, alt: string, caption: string, hasMediaReference: boolean }} Extracted media metadata and sanitized prompt.
	 */
	function extractQuestionMedia(
		questionText,
		imageUrls = [],
		additionalSources = [],
	) {
		const safePrompt = questionText || "";
		const indexedRegex =
			/!\[(.*?)\]\(\s*image_reference_index\s*:\s*(\d+)(?:\s*["']?(.*?)["']?)?\s*\)/;
		const directUrlRegex =
			/!\[(.*?)\]\(\s*((?:https?:\/\/|\/|blob:|data:)[^\s)]+)(?:\s*["']?(.*?)["']?)?\s*\)/;
		const htmlImgRegex = /<img\s+([^>]+)>/i;

		// 1. Check if the question prompt text contains an indexed markdown image reference
		const promptIndexedMatch = safePrompt.match(indexedRegex);
		if (promptIndexedMatch) {
			const alt = (promptIndexedMatch[1] || "").trim();
			const index = parseInt(promptIndexedMatch[2], 10);
			const caption = (promptIndexedMatch[3] || "").trim();
			const mediaUrl =
				Array.isArray(imageUrls) && imageUrls[index]
					? imageUrls[index]
					: "";
			const cleanQuestion = safePrompt
				.replace(promptIndexedMatch[0], "")
				.trim();

			return {
				cleanQuestion,
				mediaUrl,
				alt,
				caption,
				hasMediaReference: true,
			};
		}

		// 2. Check if the question prompt text contains a direct URL in markdown syntax
		const promptDirectMatch = safePrompt.match(directUrlRegex);
		if (promptDirectMatch) {
			const alt = (promptDirectMatch[1] || "").trim();
			const mediaUrl = (promptDirectMatch[2] || "").trim();
			const caption = (promptDirectMatch[3] || "").trim();
			const cleanQuestion = safePrompt
				.replace(promptDirectMatch[0], "")
				.trim();

			return {
				cleanQuestion,
				mediaUrl,
				alt,
				caption,
				hasMediaReference: true,
			};
		}

		// 3. Check if the question prompt text contains an HTML <img> tag
		const promptHtmlMatch = safePrompt.match(htmlImgRegex);
		if (promptHtmlMatch) {
			const attrs = promptHtmlMatch[1];
			const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
			const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
			if (srcMatch) {
				const mediaUrl = srcMatch[1].trim();
				const alt = altMatch ? altMatch[1].trim() : "";
				const cleanQuestion = safePrompt
					.replace(promptHtmlMatch[0], "")
					.trim();

				return {
					cleanQuestion,
					mediaUrl,
					alt,
					caption: "",
					hasMediaReference: true,
				};
			}
		}

		// 4. Check candidate sources outside questionText (e.g. NotebookLM q.imageUrls array)
		if (Array.isArray(additionalSources) && additionalSources.length > 0) {
			for (const source of additionalSources) {
				if (!source) continue;

				if (typeof source === "string") {
					const srcIndexedMatch = source.match(indexedRegex);
					if (srcIndexedMatch) {
						const alt = (srcIndexedMatch[1] || "").trim();
						const index = parseInt(srcIndexedMatch[2], 10);
						const caption = (srcIndexedMatch[3] || "").trim();
						const mediaUrl =
							Array.isArray(imageUrls) && imageUrls[index]
								? imageUrls[index]
								: "";

						return {
							cleanQuestion: safePrompt.trim(),
							mediaUrl,
							alt,
							caption,
							hasMediaReference: true,
						};
					}

					const srcDirectMatch = source.match(directUrlRegex);
					if (srcDirectMatch) {
						const alt = (srcDirectMatch[1] || "").trim();
						const mediaUrl = (srcDirectMatch[2] || "").trim();
						const caption = (srcDirectMatch[3] || "").trim();

						return {
							cleanQuestion: safePrompt.trim(),
							mediaUrl,
							alt,
							caption,
							hasMediaReference: true,
						};
					}

					const srcHtmlMatch = source.match(htmlImgRegex);
					if (srcHtmlMatch) {
						const attrs = srcHtmlMatch[1];
						const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
						const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
						if (srcMatch) {
							return {
								cleanQuestion: safePrompt.trim(),
								mediaUrl: srcMatch[1].trim(),
								alt: altMatch ? altMatch[1].trim() : "",
								caption: "",
								hasMediaReference: true,
							};
						}
					}

					// Raw URL string fallback
					if (
						source.startsWith("http://") ||
						source.startsWith("https://") ||
						source.startsWith("blob:") ||
						source.startsWith("data:") ||
						source.startsWith("/")
					) {
						return {
							cleanQuestion: safePrompt.trim(),
							mediaUrl: source.trim(),
							alt: "",
							caption: "",
							hasMediaReference: true,
						};
					}
				} else if (typeof source === "object") {
					const objUrl = source.url || source.src || "";
					if (objUrl) {
						return {
							cleanQuestion: safePrompt.trim(),
							mediaUrl: String(objUrl).trim(),
							alt: (source.alt || "").trim(),
							caption: (source.caption || "").trim(),
							hasMediaReference: true,
						};
					}
				}
			}
		}

		return {
			cleanQuestion: safePrompt.trim(),
			mediaUrl: "",
			alt: "",
			caption: "",
			hasMediaReference: false,
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
	 * Recursively traverses an arbitrary JavaScript object or array to find candidate image URLs.
	 * Filters for strings that look like valid web, blob, or data image URLs.
	 *
	 * @param {*} target - The root object or array to traverse.
	 * @param {Set<object>} [seen=new Set()] - Set of visited objects to prevent circular reference recursion.
	 * @returns {Array<string>} Discovered image URLs.
	 */
	function findImageUrlsDeep(target, seen = new Set()) {
		if (!target || typeof target !== "object") return [];
		if (seen.has(target)) return [];
		seen.add(target);

		const results = [];

		/**
		 * Validates whether a candidate string is an image URL.
		 *
		 * Supports blob, data:image, Google CDN endpoints, and common image file extensions.
		 *
		 * @param {*} val - Candidate value to inspect.
		 * @returns {boolean} True if the value matches image URL patterns.
		 */
		const isImageUrl = (val) => {
			if (typeof val !== "string") return false;
			const trimmed = val.trim();
			if (
				trimmed.startsWith("blob:") ||
				trimmed.startsWith("data:image/") ||
				trimmed.includes("googleusercontent.com") ||
				trimmed.includes("usercontent.goog") ||
				trimmed.includes("lh3.google.com")
			) {
				return true;
			}
			return (
				/^https?:\/\//i.test(trimmed) &&
				/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)(\?|#|$)/i.test(
					trimmed,
				)
			);
		};

		if (Array.isArray(target)) {
			for (const item of target) {
				if (isImageUrl(item)) {
					results.push(item.trim());
				} else if (item && typeof item === "object") {
					results.push(...findImageUrlsDeep(item, seen));
				}
			}
		} else {
			// Check standard property keys first
			const imageProps = [
				"imageUrls",
				"image_urls",
				"images",
				"imageUrl",
				"image_url",
				"pictureUrls",
				"photoUrls",
			];
			for (const prop of imageProps) {
				if (Array.isArray(target[prop])) {
					for (const url of target[prop]) {
						if (isImageUrl(url)) results.push(url.trim());
					}
				} else if (isImageUrl(target[prop])) {
					results.push(target[prop].trim());
				}
			}

			// Traverse all properties
			for (const key of Object.keys(target)) {
				const val = target[key];
				if (typeof val === "string" && isImageUrl(val)) {
					results.push(val.trim());
				} else if (val && typeof val === "object") {
					results.push(...findImageUrlsDeep(val, seen));
				}
			}
		}

		return Array.from(new Set(results));
	}

	/**
	 * Matches cards that have media references but missing diagram URLs against rendered <img> elements in the DOM.
	 * Compares image alt text, surrounding captions (.question-image-caption), and question prompt text.
	 *
	 * @param {Array<object>} cards - Array of normalized card objects.
	 * @param {Document|Element|null} [rootNode=null] - DOM document or root element to search within.
	 * @returns {Array<object>} Cards with resolved diagram URLs where matching DOM elements were found.
	 */
	function resolveCardsWithDomImages(cards, rootNode = null) {
		if (!Array.isArray(cards)) return [];
		const searchRoot =
			rootNode || (typeof document !== "undefined" ? document : null);
		if (!searchRoot || typeof searchRoot.querySelectorAll !== "function") {
			return cards;
		}

		const domImages = Array.from(
			searchRoot.querySelectorAll("img, .question-image"),
		);
		if (domImages.length === 0) return cards;

		const assignedDomImages = new Set();

		return cards.map((card) => {
			if (card.diagramUrl || !card.hasMediaReference) {
				return card;
			}

			// Try to match against DOM images
			for (const img of domImages) {
				if (assignedDomImages.has(img)) continue;

				const src =
					img.src ||
					img.getAttribute?.("src") ||
					img.getAttribute?.("data-src") ||
					"";
				if (!src || src.startsWith("data:image/svg+xml")) continue;

				const alt = (
					img.alt ||
					img.getAttribute?.("alt") ||
					""
				).trim();
				const parent =
					(typeof img.closest === "function" &&
						img.closest(
							"figure, .question-image-container, .image-container",
						)) ||
					img.parentElement;
				const captionEl = parent?.querySelector(
					".question-image-caption, .caption, figcaption",
				);
				const caption = (captionEl?.textContent || "").trim();

				/**
				 * Normalizes a string for flexible matching across spaces, underscores, URI encoding, and casing.
				 *
				 * @param {string|null|undefined} str - String to normalize.
				 * @returns {string} Normalized string with collapsed whitespace and lowercased characters.
				 */
				const normalizeForMatch = (str) => {
					if (!str) return "";
					let decoded = str;
					try {
						decoded = decodeURIComponent(str);
					} catch {
						// Keep original string if URI decode throws
					}
					return decoded.toLowerCase().replace(/[_\s]+/g, " ").trim();
				};

				const normDomCaption = normalizeForMatch(caption);
				const normCardCaption = normalizeForMatch(card.diagramCaption);
				const normDomAlt = normalizeForMatch(alt);
				const normCardAlt = normalizeForMatch(card.diagramAlt);

				let matched = false;

				// 1. Match by caption (direct or normalized for spaces/underscores/casing/%20)
				if (
					card.diagramCaption &&
					caption &&
					(caption.includes(card.diagramCaption) ||
						card.diagramCaption.includes(caption) ||
						(normCardCaption &&
							normDomCaption &&
							(normDomCaption.includes(normCardCaption) ||
								normCardCaption.includes(normDomCaption))))
				) {
					matched = true;
				}

				// 2. Match by alt text (direct or normalized)
				if (
					!matched &&
					card.diagramAlt &&
					alt &&
					(alt.includes(card.diagramAlt) ||
						card.diagramAlt.includes(alt) ||
						(normCardAlt &&
							normDomAlt &&
							(normDomAlt.includes(normCardAlt) ||
								normCardAlt.includes(normDomAlt))))
				) {
					matched = true;
				}

				// 3. Fallback: if only 1 diagram card and 1 question-image in DOM
				if (
					!matched &&
					img.classList?.contains("question-image") &&
					cards.filter((c) => c.hasMediaReference).length === 1
				) {
					matched = true;
				}

				if (matched) {
					assignedDomImages.add(img);
					return {
						...card,
						diagramUrl: src,
						diagramAlt: card.diagramAlt || alt,
						diagramCaption: card.diagramCaption || caption,
					};
				}
			}

			return card;
		});
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

		if (imageUrls.length === 0) {
			if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
				imageUrls = data.imageUrls;
			} else if (
				Array.isArray(data.mostRecentQuery?.imageUrls) &&
				data.mostRecentQuery.imageUrls.length > 0
			) {
				imageUrls = data.mostRecentQuery.imageUrls;
			} else if (
				Array.isArray(data.image_urls) &&
				data.image_urls.length > 0
			) {
				imageUrls = data.image_urls;
			} else if (
				Array.isArray(data.mostRecentQuery?.image_urls) &&
				data.mostRecentQuery.image_urls.length > 0
			) {
				imageUrls = data.mostRecentQuery.image_urls;
			} else if (Array.isArray(data.images) && data.images.length > 0) {
				imageUrls = data.images;
			} else if (
				Array.isArray(data.mostRecentQuery?.images) &&
				data.mostRecentQuery.images.length > 0
			) {
				imageUrls = data.mostRecentQuery.images;
			} else {
				const deepFound = findImageUrlsDeep(data);
				if (deepFound.length > 0) {
					imageUrls = deepFound;
				}
			}
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
			const candidateSources = [
				...(Array.isArray(q.imageUrls) ? q.imageUrls : []),
				...(Array.isArray(q.image_urls) ? q.image_urls : []),
				...(Array.isArray(q.images) ? q.images : []),
				...(q.imageUrl ? [q.imageUrl] : []),
				...(q.image_url ? [q.image_url] : []),
				...(q.image ? [q.image] : []),
			];
			const media = extractQuestionMedia(
				q.question || "",
				imageUrls,
				candidateSources,
			);
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
				hasMediaReference: Boolean(
					media.hasMediaReference ||
						media.mediaUrl ||
						media.caption ||
						media.alt,
				),
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
	 *   extractQuestionMedia: function((string|null|undefined), Array<string>=, Array<string|object>=): { cleanQuestion: string, mediaUrl: string, alt: string, caption: string, hasMediaReference: boolean },
	 *   sanitizeTopicTags: function((Array<string>|null|undefined)): Array<string>,
	 *   normalizeBlankAnswer: function((string|null|undefined)): string,
	 *   findImageUrlsDeep: function(*, Set<object>=): Array<string>,
	 *   resolveCardsWithDomImages: function(Array<object>, (Document|Element|null)=): Array<object>,
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
		findImageUrlsDeep,
		resolveCardsWithDomImages,
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

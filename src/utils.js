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
	 *
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
	/**
	 * Parses an indexed markdown image reference (e.g. ![alt](image_reference_index:0 "caption")).
	 *
	 * @param {string} text - Text to inspect.
	 * @param {Array<string>} imageUrls - Array of candidate image URLs.
	 * @returns {{ matched: boolean, matchedString: string, mediaUrl: string, alt: string, caption: string }|null} Parsed reference or null.
	 */
	function parseIndexedReference(text, imageUrls) {
		// 1. Check if the question prompt text contains an indexed markdown image reference
		const indexedRegex =
			/!\[(.*?)\]\(\s*image_reference_index\s*:\s*(\d+)(?:\s*["']?(.*?)["']?)?\s*\)/;
		const match = text.match(indexedRegex);
		if (!match) return null;

		const index = parseInt(match[2], 10);
		const mediaUrl =
			Array.isArray(imageUrls) && imageUrls[index]
				? imageUrls[index]
				: "";
		return {
			matched: true,
			matchedString: match[0],
			mediaUrl,
			alt: (match[1] || "").trim(),
			caption: (match[3] || "").trim(),
		};
	}

	/**
	 * Parses a direct URL markdown image reference (e.g. ![alt](https://example.com/pic.png "caption")).
	 *
	 * @param {string} text - Text to inspect.
	 * @returns {{ matched: boolean, matchedString: string, mediaUrl: string, alt: string, caption: string }|null} Parsed reference or null.
	 */
	function parseDirectMarkdownReference(text) {
		// 2. Check if the question prompt text contains a direct URL in markdown syntax
		const directUrlRegex =
			/!\[(.*?)\]\(\s*((?:https?:\/\/|\/|blob:|data:)[^\s)]+)(?:\s*["']?(.*?)["']?)?\s*\)/;
		const match = text.match(directUrlRegex);
		if (!match) return null;

		return {
			matched: true,
			matchedString: match[0],
			mediaUrl: (match[2] || "").trim(),
			alt: (match[1] || "").trim(),
			caption: (match[3] || "").trim(),
		};
	}

	/**
	 * Parses an HTML <img> tag embedded in text.
	 *
	 * @param {string} text - Text to inspect.
	 * @returns {{ matched: boolean, matchedString: string, mediaUrl: string, alt: string, caption: string }|null} Parsed reference or null.
	 */
	function parseHtmlImgReference(text) {
		// 3. Check if the question prompt text contains an HTML <img> tag
		const htmlImgRegex = /<img\s+([^>]+)>/i;
		const match = text.match(htmlImgRegex);
		if (!match) return null;

		const attrs = match[1];
		const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
		const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
		if (!srcMatch) return null;

		return {
			matched: true,
			matchedString: match[0],
			mediaUrl: srcMatch[1].trim(),
			alt: altMatch ? altMatch[1].trim() : "",
			caption: "",
		};
	}

	/**
	 * Parses a string to extract image references in markdown index, direct URL, or HTML img format.
	 *
	 * @param {string} text - Candidate string containing potential media references.
	 * @param {Array<string>} [imageUrls=[]] - Resolved image URLs array for resolving index references.
	 * @returns {{ matched: boolean, matchedString: string, mediaUrl: string, alt: string, caption: string }} Extraction result.
	 */
	function parseMediaReference(text, imageUrls = []) {
		if (!text || typeof text !== "string") {
			return {
				matched: false,
				matchedString: "",
				mediaUrl: "",
				alt: "",
				caption: "",
			};
		}

		// 1. Check if text contains an indexed markdown image reference
		// 2. Check if text contains a direct URL in markdown syntax
		// 3. Check if text contains an HTML <img> tag
		return (
			parseIndexedReference(text, imageUrls) ||
			parseDirectMarkdownReference(text) ||
			parseHtmlImgReference(text) || {
				matched: false,
				matchedString: "",
				mediaUrl: "",
				alt: "",
				caption: "",
			}
		);
	}

	/**
	 * Checks whether a candidate string starts with a recognized URL protocol or path prefix.
	 *
	 * @param {string} str - Candidate URL string.
	 * @returns {boolean} True if string matches common URL prefixes.
	 */
	function isDirectUrlPrefix(str) {
		const prefixes = ["http://", "https://", "blob:", "data:", "/"];
		return prefixes.some((prefix) => str.startsWith(prefix));
	}

	/**
	 * Inspects candidate media sources outside questionText (e.g. q.imageUrls array or source objects).
	 *
	 * @param {Array<string|object>} additionalSources - Array of source strings or objects.
	 * @param {Array<string>} imageUrls - Resolved image URLs array.
	 * @returns {{ mediaUrl: string, alt: string, caption: string, hasMediaReference: boolean }|null} Discovered media or null.
	 */
	function extractFromAdditionalSources(additionalSources, imageUrls) {
		if (
			!Array.isArray(additionalSources) ||
			additionalSources.length === 0
		) {
			return null;
		}

		// 4. Check candidate sources outside questionText (e.g. NotebookLM q.imageUrls array)
		for (const source of additionalSources) {
			if (!source) continue;

			if (typeof source === "string") {
				const parsed = parseMediaReference(source, imageUrls);
				if (parsed.matched) {
					return {
						mediaUrl: parsed.mediaUrl,
						alt: parsed.alt,
						caption: parsed.caption,
						hasMediaReference: true,
					};
				}

				// Raw URL string fallback
				if (isDirectUrlPrefix(source)) {
					return {
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
						mediaUrl: String(objUrl).trim(),
						alt: (source.alt || "").trim(),
						caption: (source.caption || "").trim(),
						hasMediaReference: true,
					};
				}
			}
		}

		return null;
	}

	/**
	 * Extracts media references (diagrams, images) embedded in question prompts via markdown syntax or HTML.
	 *
	 * Resolves image_reference_index:N against the extracted imageUrls array, or extracts direct URLs.
	 *
	 * @param {string|null|undefined} questionText - Raw prompt text from NotebookLM.
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

		// 1. Check if the question prompt text contains an embedded media reference
		const parsedPrompt = parseMediaReference(safePrompt, imageUrls);

		if (parsedPrompt.matched) {
			const cleanQuestion = safePrompt
				.replace(parsedPrompt.matchedString, "")
				.trim();
			return {
				cleanQuestion,
				mediaUrl: parsedPrompt.mediaUrl,
				alt: parsedPrompt.alt,
				caption: parsedPrompt.caption,
				hasMediaReference: true,
			};
		}

		// 2. Check candidate sources outside questionText (e.g. NotebookLM q.imageUrls array)
		const extraMedia = extractFromAdditionalSources(
			additionalSources,
			imageUrls,
		);
		if (extraMedia) {
			return {
				cleanQuestion: safePrompt.trim(),
				...extraMedia,
			};
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
	 *
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
	 * Validates whether a candidate string is an image URL.
	 *
	 * Supports blob, data:image, Google CDN endpoints, and common image file extensions.
	 *
	 * @param {*} val - Candidate value to inspect.
	 * @returns {boolean} True if the value matches image URL patterns.
	 */
	function isImageUrl(val) {
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
	}

	/**
	 * Traverses object properties to collect discovered image URLs.
	 *
	 * Inspects known image property keys followed by recursive property traversal.
	 *
	 * @param {object} target - Target object to extract image URLs from.
	 * @param {Set<object>} seen - Set of visited objects to prevent circular recursion.
	 * @returns {Array<string>} Discovered image URLs.
	 */
	function collectObjectImageUrls(target, seen) {
		const results = [];
		const imageProps = [
			"imageUrls",
			"image_urls",
			"images",
			"imageUrl",
			"image_url",
			"pictureUrls",
			"photoUrls",
		];

		// Check standard property keys first
		for (const prop of imageProps) {
			const val = target[prop];
			if (Array.isArray(val)) {
				for (const url of val) {
					if (isImageUrl(url)) results.push(url.trim());
				}
			} else if (isImageUrl(val)) {
				results.push(val.trim());
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

		return results;
	}

	/**
	 * Recursively traverses an arbitrary JavaScript object or array to find candidate image URLs.
	 *
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
		if (Array.isArray(target)) {
			for (const item of target) {
				if (isImageUrl(item)) {
					results.push(item.trim());
				} else if (item && typeof item === "object") {
					results.push(...findImageUrlsDeep(item, seen));
				}
			}
		} else {
			results.push(...collectObjectImageUrls(target, seen));
		}

		return Array.from(new Set(results));
	}

	/**
	 * Normalizes a string for flexible matching across spaces, underscores, URI encoding, and casing.
	 *
	 * @param {string|null|undefined} str - String to normalize.
	 * @returns {string} Normalized string with collapsed whitespace and lowercased characters.
	 */
	function normalizeForMatch(str) {
		if (!str) return "";
		let decoded = str;
		try {
			decoded = decodeURIComponent(str);
		} catch {
			// Keep original string if URI decode throws
		}
		return decoded.toLowerCase().replace(/[_\s]+/g, " ").trim();
	}

	/**
	 * Extracts normalized image attributes (src, alt, caption) from a DOM image element or its container.
	 *
	 * @param {Element} img - DOM image element.
	 * @returns {{ src: string, alt: string, caption: string }|null} Metadata object, or null if invalid or SVG placeholder.
	 */
	function extractDomImageMetadata(img) {
		const src =
			img.src ||
			img.getAttribute?.("src") ||
			img.getAttribute?.("data-src") ||
			"";
		if (!src || src.startsWith("data:image/svg+xml")) return null;

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

		return { src, alt, caption };
	}

	/**
	 * Checks whether card metadata text matches DOM metadata text (directly or normalized).
	 *
	 * @param {string|null|undefined} cardText - Text from card metadata (e.g. caption or alt).
	 * @param {string|null|undefined} domText - Text from DOM element (e.g. caption or alt).
	 * @returns {boolean} True if strings match directly or normalized.
	 */
	function matchesNormalizedText(cardText, domText) {
		if (!cardText || !domText) return false;
		if (domText.includes(cardText) || cardText.includes(domText)) {
			return true;
		}

		const normCard = normalizeForMatch(cardText);
		const normDom = normalizeForMatch(domText);
		if (!normCard || !normDom) return false;

		return normDom.includes(normCard) || normCard.includes(normDom);
	}

	/**
	 * Evaluates whether a candidate DOM image matches a card based on caption, alt text, or single-diagram fallback.
	 *
	 * @param {object} card - Flashcard object.
	 * @param {{ src: string, alt: string, caption: string }} domMeta - Candidate image metadata.
	 * @param {boolean} isSingleDiagramCandidate - Whether the quiz contains exactly 1 card with media references.
	 * @param {Element} img - Raw DOM image element for class checks.
	 * @returns {boolean} True if the image corresponds to the card.
	 */
	function doesDomImageMatchCard(
		card,
		domMeta,
		isSingleDiagramCandidate,
		img,
	) {
		// 1. Match by caption (direct or normalized for spaces/underscores/casing/%20)
		if (matchesNormalizedText(card.diagramCaption, domMeta.caption)) {
			return true;
		}

		// 2. Match by alt text (direct or normalized)
		if (matchesNormalizedText(card.diagramAlt, domMeta.alt)) {
			return true;
		}

		// 3. Fallback: if only 1 diagram card and 1 question-image in DOM
		return Boolean(
			isSingleDiagramCandidate &&
				img.classList?.contains("question-image"),
		);
	}

	/**
	 * Matches cards that have media references but missing diagram URLs against rendered <img> elements in the DOM.
	 *
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
		const isSingleDiagramCandidate =
			cards.filter((c) => c.hasMediaReference).length === 1;

		return cards.map((card) => {
			if (card.diagramUrl || !card.hasMediaReference) {
				return card;
			}

			// Try to match against DOM images
			for (const img of domImages) {
				if (assignedDomImages.has(img)) continue;

				const domMeta = extractDomImageMetadata(img);
				if (!domMeta) continue;

				if (
					doesDomImageMatchCard(
						card,
						domMeta,
						isSingleDiagramCandidate,
						img,
					)
				) {
					assignedDomImages.add(img);
					return {
						...card,
						diagramUrl: domMeta.src,
						diagramAlt: card.diagramAlt || domMeta.alt,
						diagramCaption: card.diagramCaption || domMeta.caption,
					};
				}
			}

			return card;
		});
	}

	/**
	 * Parses image URLs from an argument payload, handling arrays and JSON/HTML-encoded strings.
	 *
	 * @param {string|Array<string>|null|undefined} payload - Payload to parse.
	 * @returns {Array<string>} Parsed array of image URLs.
	 */
	function parseImageUrlsPayload(payload) {
		if (Array.isArray(payload)) return payload;
		if (typeof payload !== "string" || !payload.trim()) return [];

		try {
			const parsed = JSON.parse(payload);
			if (Array.isArray(parsed)) return parsed;
		} catch {
			const clean = unescapeHtml(payload);
			try {
				const parsed = JSON.parse(clean);
				if (Array.isArray(parsed)) return parsed;
			} catch {
				// Invalid JSON string payload
			}
		}
		return [];
	}

	/**
	 * Resolves image URLs for a quiz from explicit payload, query metadata, or deep object traversal.
	 *
	 * @param {object} data - Parsed quiz root data object.
	 * @param {Array<string>} parsedPayload - Image URLs already parsed from arguments.
	 * @returns {Array<string>} Resolved image URLs.
	 */
	function resolveQuizImageUrls(data, parsedPayload) {
		if (parsedPayload.length > 0) return parsedPayload;

		const candidateLists = [
			data.imageUrls,
			data.mostRecentQuery?.imageUrls,
			data.image_urls,
			data.mostRecentQuery?.image_urls,
			data.images,
			data.mostRecentQuery?.images,
		];

		for (const candidate of candidateLists) {
			if (Array.isArray(candidate) && candidate.length > 0) {
				return candidate;
			}
		}

		return findImageUrlsDeep(data);
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

		const parsedPayload = parseImageUrlsPayload(imageUrlsPayload);
		const imageUrls = resolveQuizImageUrls(data, parsedPayload);

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
	 * Determines the normalized question type from raw question properties.
	 *
	 * @param {object} q - Raw quiz question object.
	 * @returns {string} One of 'MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'FILL_IN_THE_BLANK', or 'SHORT_ANSWER'.
	 */
	function determineQuestionType(q) {
		const rawType = (q.type || "").toLowerCase();
		if (
			rawType === "multiple_select" ||
			(!rawType &&
				q.answerOptions?.filter((o) => o.isCorrect).length > 1)
		) {
			return "MULTIPLE_SELECT";
		}
		if (
			rawType === "fill_in_the_blank" ||
			(!rawType && q.bestAnswer !== undefined)
		) {
			return "FILL_IN_THE_BLANK";
		}
		if (
			rawType === "short_answer" ||
			(!rawType && q.grading !== undefined)
		) {
			return "SHORT_ANSWER";
		}
		return "MULTIPLE_CHOICE";
	}

	/**
	 * Compiles grading attributes and misconceptions into a formatted rubric string for short answer questions.
	 *
	 * @param {object|undefined} grading - Grading rubric metadata object.
	 * @returns {string} Formatted rubric text.
	 */
	function buildRubricText(grading) {
		if (!grading) return "";

		let rubricText = "";
		if (
			grading.requiredAttributes &&
			Array.isArray(grading.requiredAttributes)
		) {
			rubricText = grading.requiredAttributes
				.map((attr) => `• ${attr}`)
				.join("\n");
		}

		if (
			grading.errors?.misconceptions &&
			Array.isArray(grading.errors.misconceptions) &&
			grading.errors.misconceptions.length > 0
		) {
			const misc = grading.errors.misconceptions
				.map((m) => `⚠️ ${m}`)
				.join("\n");
			rubricText = rubricText ? `${rubricText}\n\n${misc}` : misc;
		}

		return rubricText;
	}

	/**
	 * Formats an array of answer options into numbered card option, flag, and rationale fields.
	 *
	 * @param {Array<object>} [options=[]] - Raw answer options array.
	 * @returns {object} Formatted option fields (option1..4, flag1..4, rationale1..4).
	 */
	function formatOptionFields(options = []) {
		const fields = {};
		for (let i = 0; i < 4; i++) {
			const opt = options[i];
			fields[`option${i + 1}`] = opt?.text || "";
			fields[`flag${i + 1}`] = opt?.isCorrect ? "True" : "False";
			fields[`rationale${i + 1}`] = opt?.rationale || "";
		}
		return fields;
	}

	/**
	 * Gathers candidate media sources from question-level properties.
	 *
	 * @param {object} q - Raw question object.
	 * @returns {Array<string|object>} Candidate media sources.
	 */
	function collectQuestionMediaCandidates(q) {
		return [
			...(Array.isArray(q.imageUrls) ? q.imageUrls : []),
			...(Array.isArray(q.image_urls) ? q.image_urls : []),
			...(Array.isArray(q.images) ? q.images : []),
			...(q.imageUrl ? [q.imageUrl] : []),
			...(q.image_url ? [q.image_url] : []),
			...(q.image ? [q.image] : []),
		];
	}

	/**
	 * Resolves the target model answer for fill-in-the-blank and short-answer questions.
	 *
	 * @param {object} q - Raw question object.
	 * @returns {string} Target answer string.
	 */
	function resolveTargetAnswer(q) {
		return q.bestAnswer || q.grading?.modelAnswer || "";
	}

	/**
	 * Resolves general rationale text from question or grading fields.
	 *
	 * @param {object} q - Raw question object.
	 * @returns {string} General rationale text.
	 */
	function resolveGeneralRationale(q) {
		return q.rationale || q.grading?.rationale || "";
	}

	/**
	 * Formats acceptable alternative answers into a comma-separated string.
	 *
	 * @param {Array<string>|string|null|undefined} acceptableAnswers - Raw acceptable answers.
	 * @returns {string} Comma-separated acceptable answers.
	 */
	function formatAcceptableAnswers(acceptableAnswers) {
		if (Array.isArray(acceptableAnswers)) {
			return acceptableAnswers.join(", ");
		}
		return acceptableAnswers || "";
	}

	/**
	 * Checks whether extracted media metadata contains any media references.
	 *
	 * @param {{ hasMediaReference?: boolean, mediaUrl?: string, caption?: string, alt?: string }} media - Media metadata object.
	 * @returns {boolean} True if any media property is present.
	 */
	function hasCardMediaReference(media) {
		return Boolean(
			media.hasMediaReference ||
				media.mediaUrl ||
				media.caption ||
				media.alt,
		);
	}

	/**
	 * Maps raw quiz question objects to normalized flashcard objects across all four
	 * supported question types (multiple_choice, multiple_select, fill_in_the_blank, short_answer).
	 *
	 * Preserves LaTeX formulas, option rationales, correctness flags, and media references.
	 *
	 * @param {Array<object>} quizData - Array of question objects from NotebookLM.
	 * @param {Array<string>} [imageUrls=[]] - Array of resolved image URLs extracted from the page.
	 * @returns {Array<object>} Normalized card objects.
	 */
	function mapQuizDataToCards(quizData, imageUrls = []) {
		if (!Array.isArray(quizData)) return [];

		return quizData.map((q) => {
			const candidateSources = collectQuestionMediaCandidates(q);
			const media = extractQuestionMedia(
				q.question || "",
				imageUrls,
				candidateSources,
			);
			const questionType = determineQuestionType(q);
			const options = q.answerOptions || [];
			const optionFields = formatOptionFields(options);
			const rubricText = buildRubricText(q.grading);

			return {
				question: media.cleanQuestion,
				hint: q.hint || "",
				questionType,

				// Media references
				diagramUrl: media.mediaUrl || "",
				diagramAlt: media.alt || "",
				diagramCaption: media.caption || "",
				hasMediaReference: hasCardMediaReference(media),
				image: "",

				// Multi-choice & Multi-select Options
				...optionFields,

				// Fill in the Blank & Short Answer target data
				targetAnswer: resolveTargetAnswer(q),
				acceptableAnswers: formatAcceptableAnswers(q.acceptableAnswers),
				rubric: rubricText,
				generalRationale: resolveGeneralRationale(q),
			};
		});
	}

	/**
	 * Field key mapping schema: [Anki field name, Card object property name, default fallback value].
	 * @type {Array<[string, string, string]>}
	 */
	const FIELD_KEY_MAPPINGS = [
		// Header fields
		["Question", "question", ""],
		["Hint", "hint", ""],
		["Image", "image", ""],

		// Option 1 (Rationale first)
		["Option1", "option1", ""],
		["Rationale1", "rationale1", ""],
		["Flag1", "flag1", "False"],

		// Option 2 (Flag first)
		["Option2", "option2", ""],
		["Flag2", "flag2", "False"],
		["Rationale2", "rationale2", ""],

		// Option 3 (Flag first)
		["Option3", "option3", ""],
		["Flag3", "flag3", "False"],
		["Rationale3", "rationale3", ""],

		// Option 4 (Flag first)
		["Option4", "option4", ""],
		["Flag4", "flag4", "False"],
		["Rationale4", "rationale4", ""],

		// Adaptive multi-format fields
		["QuestionType", "questionType", "MULTIPLE_CHOICE"],
		["TargetAnswer", "targetAnswer", ""],
		["AcceptableAnswers", "acceptableAnswers", ""],
		["Rubric", "rubric", ""],
		["GeneralRationale", "generalRationale", ""],
	];

	/**
	 * Constructs the 20-field note payload for a single card.
	 *
	 * @param {object} card - Flashcard object.
	 * @returns {object} 20-field dictionary for Anki note creation.
	 */
	function buildNoteFields(card) {
		const fields = {};
		for (const [ankiKey, cardKey, fallback] of FIELD_KEY_MAPPINGS) {
			fields[ankiKey] = card[cardKey] || fallback;
		}
		return fields;
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

		return cards.map((card) => ({
			deckName: targetDeck,
			modelName: noteType,
			fields: buildNoteFields(card),
			options: {
				allowDuplicate: true,
			},
			tags: allTags,
		}));
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

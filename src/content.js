// content.js - v8.2 (Clean Data Pass-through & Modal UI)

(() => {
	/**
	 * Extension version identifier dynamically read from extension manifest at runtime.
	 * @type {string}
	 */
	const EXTENSION_VERSION =
		(typeof chrome !== "undefined" &&
			(chrome.runtime?.getManifest?.()?.version_name ||
				chrome.runtime?.getManifest?.()?.version)) ||
		"";

	window.console.log(
		EXTENSION_VERSION
			? `[Anki Bridge] 🚀 NotebookLM to Anki Extension v${EXTENSION_VERSION} loaded.`
			: `[Anki Bridge] 🚀 NotebookLM to Anki Extension loaded.`,
	);

	/**
	 * Toggle for debug logging state, updated asynchronously from local storage.
	 * @type {boolean}
	 */
	let enableDebug = true;
	/**
	 * Configured template string for formatting Anki deck names.
	 * @type {string}
	 */
	let quizDeckNameTemplate =
		"NotebookLM::{notebookName}::Quizzes::{quizName}";

	// Load configuration setting from storage.
	chrome.storage.local
		.get({
			enableDebugLogging: true,
			quizDeckNameTemplate:
				"NotebookLM::{notebookName}::Quizzes::{quizName}",
		})
		.then((res) => {
			if (res) {
				if (typeof res.enableDebugLogging === "boolean") {
					enableDebug = res.enableDebugLogging;
				}
				if (res.quizDeckNameTemplate) {
					quizDeckNameTemplate = res.quizDeckNameTemplate;
				}
			}
		})
		.catch(() => {});

	// Listen for settings changes to update status dynamically.
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === "local") {
			if (changes.enableDebugLogging) {
				enableDebug = changes.enableDebugLogging.newValue;
			}
			if (changes.quizDeckNameTemplate) {
				quizDeckNameTemplate = changes.quizDeckNameTemplate.newValue;
			}
		}
	});

	/**
	 * Local shadow console to conditionally forward logs to window.console.
	 * @type {{
	 *   log: function(...*): void,
	 *   warn: function(...*): void,
	 *   error: function(...*): void
	 * }}
	 */
	const console = {
		log: (...args) => {
			if (enableDebug) window.console.log(...args);
		},
		warn: (...args) => {
			if (enableDebug) window.console.warn(...args);
		},
		error: (...args) => {
			if (enableDebug) window.console.error(...args);
		},
	};

	/**
	 * Configuration constants for the UI injector.
	 * @type {{ BUTTON_ID: string, ANCHOR_SELECTORS: Array<string> }}
	 */
	const CONFIG = {
		BUTTON_ID: "notebooklm-to-anki-btn",
		ANCHOR_SELECTORS: [
			'button[aria-label="Good content rating"]',
			'button[aria-label="Copy"]',
			'button[aria-label="Download"]',
		],
	};

	/**
	 * Extracts Base64 image payload and image format from a loaded HTMLImageElement using an off-screen canvas.
	 *
	 * Constrains canvas dimensions to maxDimension (default 2048px) and prioritizes WebP compression
	/**
	 * Calculates aspect-ratio-preserving dimensions bounded by a maximum dimension.
	 *
	 * @param {number} width - Original natural width.
	 * @param {number} height - Original natural height.
	 * @param {number} maxDimension - Maximum allowed width or height.
	 * @returns {{ width: number, height: number }} Scaled dimensions.
	 */
	function calculateBoundedDimensions(width, height, maxDimension) {
		if (width <= maxDimension && height <= maxDimension) {
			return { width, height };
		}
		if (width >= height) {
			return {
				width: maxDimension,
				height: Math.round((height * maxDimension) / width),
			};
		}
		return {
			width: Math.round((width * maxDimension) / height),
			height: maxDimension,
		};
	}

	/**
	 * Serializes a canvas element to a data URL, preferring WebP with PNG fallback.
	 *
	 * @param {HTMLCanvasElement} canvas - The canvas element to serialize.
	 * @returns {string|null} Valid data URL or null if failed or payload exceeds 5MB.
	 */
	function serializeCanvasToDataUrl(canvas) {
		let dataUrl = canvas.toDataURL("image/webp", 0.85);
		if (!dataUrl || !dataUrl.startsWith("data:image/webp")) {
			dataUrl = canvas.toDataURL("image/png");
		}
		if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
		if (dataUrl.length > 5 * 1024 * 1024) return null;
		return dataUrl;
	}

	/**
	 * Extracts Base64-encoded image data from a rendered DOM image element using an in-memory canvas.
	 *
	 * Bounds image dimensions to maxDimension (default 2048px) and prioritizes lightweight WebP encoding (0.85 quality)
	 * with automatic PNG fallback to minimize memory footprint and avoid IPC message bottlenecks.
	 *
	 * @param {HTMLImageElement} img - The image element to extract data from.
	 * @param {number} [maxDimension=2048] - Maximum dimension (width or height) to bound the image to.
	 * @returns {{ base64: string, format: string }|null} Extracted Base64 string and file format extension, or null if unreadable.
	 */
	function extractDomImageBase64(img, maxDimension = 2048) {
		try {
			if (!img || typeof document === "undefined") return null;
			if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
				return null;
			}

			const { width, height } = calculateBoundedDimensions(
				img.naturalWidth,
				img.naturalHeight,
				maxDimension,
			);

			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;

			ctx.drawImage(img, 0, 0, width, height);

			const dataUrl = serializeCanvasToDataUrl(canvas);
			if (!dataUrl) return null;

			const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
			if (!match) return null;

			return {
				format: match[1] || "webp",
				base64: match[2],
			};
		} catch {
			// Canvas may be tainted if cross-origin without CORS
			return null;
		}
	}

	/**
	 * Dispatches a message to direct child iframes without recursive descendant traversal.
	 *
	 * @param {Document|HTMLElement} root - The document or container element to search for direct iframes.
	 * @param {object} message - The message object to post.
	 * @returns {void}
	 */
	function broadcastToFrames(root, message) {
		try {
			const container = root.document ? root.document : root;
			if (!container || typeof container.querySelectorAll !== "function") {
				return;
			}
			const iframes = container.querySelectorAll("iframe");
			iframes.forEach((iframe) => {
				try {
					if (iframe.contentWindow) {
						iframe.contentWindow.postMessage(message, "*");
					}
				} catch {
					try {
						iframe.contentWindow?.postMessage(message, "*");
					} catch {}
				}
			});
		} catch {
			// Cross-origin restriction fallback
		}
	}

	/**
	 * Set of processed trigger IDs to prevent duplicate batch extractions.
	 * @type {Set<string>}
	 */
	const handledTriggerIds = new Set();

	/**
	 * Initializes the data miner that listens for the app root element
	 * with data-app-data and processes message triggers from the top window.
	 *
	 * If the container element is not immediately present, registers a MutationObserver
	 * to listen for its dynamic insertion.
	 * @returns {void}
	 */
	function initDataMiner() {
		console.log("[Anki Bridge] 🔍 initDataMiner started.");

		// In nested iframe setups (e.g. shim wrapping blob), forward trigger messages downward
		window.addEventListener("message", (event) => {
			if (event.data?.action === "ANKI_TRIGGER_EXTRACT") {
				const triggerId = event.data.triggerId;
				if (triggerId && handledTriggerIds.has(triggerId)) {
					return;
				}
				const appRoot = document.querySelector("[data-app-data]");
				if (!appRoot) {
					broadcastToFrames(document, event.data);
				}
			}
		});

		/**
		 * Helper to check for the [data-app-data] element and initialize setup if present.
		 * @returns {boolean} True if the element was found and initialized.
		 */
		const checkForAppRoot = () => {
			const appRoot = document.querySelector("[data-app-data]");
			if (appRoot) {
				console.log(
					"[Anki Bridge] ⛏️ Miner Ready: Found [data-app-data] container.",
				);
				window.top.postMessage({ action: "ANKI_MINER_READY" }, "*");
				window.addEventListener("message", (event) => {
					if (event.data?.action === "ANKI_TRIGGER_EXTRACT") {
						const triggerId = event.data.triggerId;
						if (triggerId) {
							if (handledTriggerIds.has(triggerId)) {
								return;
							}
							handledTriggerIds.add(triggerId);
							if (handledTriggerIds.size > 50) {
								const first = handledTriggerIds.values().next().value;
								handledTriggerIds.delete(first);
							}
						}
						console.log(
							"[Anki Bridge] 📥 Data Miner received ANKI_TRIGGER_EXTRACT trigger message:",
							event.data,
						);
						const jsonString =
							appRoot.getAttribute("data-app-data");
						const rawImageUrls =
							appRoot.getAttribute("data-image-urls");
						const customTitle = event.data.notebookTitle;
						console.log(
							"[Anki Bridge] 📑 Raw JSON string retrieved length:",
							jsonString ? jsonString.length : 0,
							"Image URLs attribute:",
							rawImageUrls ? "Found" : "None",
						);
						processBatch(jsonString, customTitle, rawImageUrls);
					}
				});
				return true;
			}
			return false;
		};

		if (!checkForAppRoot()) {
			console.log(
				"[Anki Bridge] ⏳ [data-app-data] not found immediately. Observing DOM for changes...",
			);
			const observer = new MutationObserver((_mutations, obs) => {
				if (checkForAppRoot()) {
					console.log(
						"[Anki Bridge] ✅ [data-app-data] detected via MutationObserver. Disconnecting observer.",
					);
					obs.disconnect();
				}
			});
			observer.observe(document.documentElement || document.body, {
				childList: true,
				subtree: true,
			});
		}
	}

	/**
	 * Unescapes HTML entities in a string (e.g., &quot;, &amp;, &lt;, &gt;, &#39;).
	 * @param {string} str - The string to unescape.
	 * @returns {string} The unescaped string.
	 */
	function unescapeHtml(str) {
		return NotebookLMToAnkiUtils.unescapeHtml(str);
	}

	/**
	 * Parses and processes the raw JSON string extracted from the page,
	 * formats the deck title, maps quiz questions to flashcard structures,
	 * and posts the extracted data to the top window for Anki export.
	 * @param {string} jsonString - The raw, potentially HTML-escaped JSON data.
	 * @param {string} customNotebookTitle - The notebook title to use for naming the deck.
	 * @param {string|null} [rawImageUrls=null] - Optional raw data-image-urls attribute string.
	 * @returns {Promise<void>}
	 */
	async function processBatch(
		jsonString,
		customNotebookTitle,
		rawImageUrls = null,
	) {
		console.log(
			`[Anki Bridge] 🔨 processBatch started (v${EXTENSION_VERSION}). Custom notebook title:`,
			customNotebookTitle,
		);
		try {
			if (!jsonString) {
				console.error(
					"[Anki Bridge] ❌ processBatch: Raw JSON string is empty or null.",
				);
				window.top.postMessage(
					{
						action: "ANKI_REAL_FAIL",
						error: "Raw JSON string is empty.",
					},
					"*",
				);
				return;
			}

			const { quizData, title, topicsCovered, imageUrls } =
				NotebookLMToAnkiUtils.parseQuizJson(jsonString, rawImageUrls);
			console.log(
				"[Anki Bridge] 🔍 Found quiz data:",
				quizData ? `Array length ${quizData.length}` : "Not Found",
			);

			if (imageUrls && imageUrls.length > 0) {
				console.log(
					`[Anki Bridge] 🖼️ Extracted image URLs (${imageUrls.length}):`,
					imageUrls,
				);
			}

			const quizTitle = getQuizTitle() || title || "Quiz";
			const finalTitle = NotebookLMToAnkiUtils.formatDeckTitle(
				customNotebookTitle,
				quizTitle,
				quizDeckNameTemplate,
			);
			console.log(
				"[Anki Bridge] 🏷️ Formatted deck final title:",
				finalTitle,
			);

			// 1. Initial card mapping from parsed quiz JSON
			let cards = NotebookLMToAnkiUtils.mapQuizDataToCards(
				quizData,
				imageUrls,
			);

			// 2. Resolve cards with images in DOM if diagram URL is missing
			cards = NotebookLMToAnkiUtils.resolveCardsWithDomImages(
				cards,
				document,
			);

			// 3. For any card with a resolved diagram URL or matching DOM image, attempt Base64 extraction
			if (typeof document !== "undefined") {
				const domImages = Array.from(document.querySelectorAll("img"));
				const assignedBase64Images = new Set();
				cards = cards.map((card) => {
					if (card.imageBase64) return card;

					const matchingImg =
						NotebookLMToAnkiUtils.findMatchingDomImage(
							card,
							domImages,
							assignedBase64Images,
						);

					if (matchingImg) {
						assignedBase64Images.add(matchingImg);
						const extracted = extractDomImageBase64(matchingImg);
						if (extracted) {
							return {
								...card,
								diagramUrl: card.diagramUrl || matchingImg.src,
								imageBase64: extracted.base64,
								imageFormat: extracted.format,
							};
						}
					}
					return card;
				});
			}

			// 4. Detailed Image Analysis and Debug Logging
			const imagesFound = cards.filter(
				(c) =>
					c.hasMediaReference ||
					c.diagramUrl ||
					c.diagramCaption ||
					c.diagramAlt,
			).length;
			const imagesResolved = cards.filter((c) => Boolean(c.diagramUrl)).length;
			const imagesMissing = imagesFound - imagesResolved;

			console.log(
				`[Anki Bridge] 🖼️ Media analysis: ${imagesFound} image(s) found in quiz (${imagesResolved} resolved, ${imagesMissing} missing).`,
			);

			cards.forEach((card, idx) => {
				if (
					card.hasMediaReference ||
					card.diagramUrl ||
					card.diagramCaption ||
					card.diagramAlt
				) {
					if (card.diagramUrl) {
						console.log(
							`[Anki Bridge] 🖼️ Card #${idx + 1}: Found image reference. Resolved URL: ${card.diagramUrl} (Alt: "${card.diagramAlt || ""}", Caption: "${card.diagramCaption || ""}")`,
						);
					} else {
						console.warn(
							`[Anki Bridge] ⚠️ Card #${idx + 1}: Image reference found but URL could not be resolved from data-app-data or DOM. (Alt: "${card.diagramAlt || ""}", Caption: "${card.diagramCaption || ""}"). Tip: Navigate to this question in NotebookLM and re-export.`,
						);
					}
				}
			});

			console.log(
				"[Anki Bridge] 🗃️ Mapped cards count:",
				cards.length,
				"Example card:",
				cards[0],
			);

			const sanitizedTopics =
				NotebookLMToAnkiUtils.sanitizeTopicTags(topicsCovered);

			console.log(
				"[Anki Bridge] 📤 Posting ANKI_EXTRACTED_DATA to top window...",
			);
			window.top.postMessage(
				{
					action: "ANKI_EXTRACTED_DATA",
					cards: cards,
					deckTitle: finalTitle,
					nbTitle:
						NotebookLMToAnkiUtils.cleanNotebookTitle(
							customNotebookTitle,
						),
					quizTitle: NotebookLMToAnkiUtils.cleanQuizTitle(quizTitle),
					topicsCovered: sanitizedTopics,
					imagesFound: imagesFound,
					imagesResolved: imagesResolved,
				},
				"*",
			);
		} catch (e) {
			console.error("[Anki Bridge] ❌ Error in processBatch:", e);
			window.top.postMessage(
				{
					action: "ANKI_REAL_FAIL",
					error: `JSON Parse Error: ${e.message}`,
				},
				"*",
			);
		}
	}

	// UI INJECTOR (Standard)
	/**
	 * Flag to indicate if the Data Miner (scraper) is connected and ready.
	 * @type {boolean}
	 */
	let isMinerConnected = false;
	/**
	 * Flag to prevent duplicate extraction processing if already extracting/exporting.
	 * @type {boolean}
	 */
	let isExporting = false;
	/**
	 * The cached HTML template for the export button.
	 * @type {string|null}
	 */
	let buttonTemplate = null;

	/**
	 * Initializes the UI injector by pre-fetching templates (button and modal HTML),
	 * setting up message event listeners for communication, and observing the DOM
	 * to insert the export button near anchor elements.
	 * @returns {Promise<void>}
	 */
	async function initUiInjector() {
		console.log("[Anki Bridge] 🛠️ initUiInjector started in Top Window.");
		// Pre-fetch templates
		try {
			console.log("[Anki Bridge] 📥 Fetching button.html...");
			const btnRes = await fetch(chrome.runtime.getURL("button.html"));
			buttonTemplate = await btnRes.text();
			console.log("[Anki Bridge] ✅ button.html loaded.");

			console.log("[Anki Bridge] 📥 Fetching modal.html...");
			const modalRes = await fetch(chrome.runtime.getURL("modal.html"));
			const modalHtml = await modalRes.text();
			console.log("[Anki Bridge] ✅ modal.html loaded.");

			/** @type {Document} */
			const modalDoc = new DOMParser().parseFromString(
				modalHtml,
				"text/html",
			);
			// Append all template nodes from the fetched HTML
			while (modalDoc.body.firstChild) {
				document.body.appendChild(modalDoc.body.firstChild);
			}
			console.log("[Anki Bridge] 🏗️ Modal templates appended to body.");
		} catch (e) {
			console.error("[Anki Bridge] ❌ Failed to load UI templates:", e);
		}

		window.addEventListener("message", (event) => {
			if (
				!event.data ||
				typeof event.data.action !== "string" ||
				!event.data.action.startsWith("ANKI_")
			) {
				return;
			}
			console.log(
				"[Anki Bridge] 📥 Top Window received message action:",
				event.data.action,
			);
			if (event.data.action === "ANKI_MINER_READY") {
				isMinerConnected = true;
				console.log(
					"[Anki Bridge] ✅ Data Miner is connected and ready.",
				);
				updateButtonState("ready");
			} else if (event.data.action === "ANKI_REAL_SUCCESS") {
				console.log(
					`[Anki Bridge] 🎉 Export successful! (v${EXTENSION_VERSION}) Count:`,
					event.data.count,
					"Skipped:",
					event.data.skipped,
					"Images exported:",
					event.data.imagesExported !== undefined
						? event.data.imagesExported
						: "N/A",
					"Images found:",
					event.data.imagesFound !== undefined
						? event.data.imagesFound
						: "N/A",
				);
				isExporting = false;
				updateButtonState(
					"success",
					event.data.count,
					event.data.skipped,
				);
			} else if (event.data.action === "ANKI_REAL_FAIL") {
				console.error(
					"[Anki/AnkiConnect Error] Export Failed:",
					event.data.error,
				);
				isExporting = false;
				showErrorModal(event.data.error);
				updateButtonState("error");
			} else if (event.data.action === "ANKI_EXTRACTED_DATA") {
				console.log(
					"[Anki Bridge] 📦 Extracted cards received on top window:",
					event.data.cards?.length,
					"Images found:",
					event.data.imagesFound !== undefined ? event.data.imagesFound : 0,
				);
				handleExtractedData(
					event.data.cards,
					event.data.deckTitle,
					event.data.nbTitle,
					event.data.quizTitle,
					event.data.topicsCovered,
					event.data.imagesFound,
					event.data.imagesResolved,
				).catch((err) => {
					console.error(
						"[Anki Bridge] ❌ handleExtractedData error:",
						err,
					);
					isExporting = false;
					updateButtonState("error");
				});
			}
		});

		const observer = new MutationObserver(() => {
			if (!buttonTemplate || document.getElementById(CONFIG.BUTTON_ID))
				return;
			let anchorBtn = null;
			for (const selector of CONFIG.ANCHOR_SELECTORS) {
				const found = document.querySelector(selector);
				if (found) {
					anchorBtn = found;
					break;
				}
			}
			if (anchorBtn) {
				const container =
					anchorBtn.closest("div.flex") || anchorBtn.parentElement;
				if (container) {
					console.log(
						"[Anki Bridge] 🏷️ Injected export button to DOM container.",
					);
					container.insertBefore(
						createAngularCloneButton(),
						container.firstChild,
					);
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

	/**
	 * Handles the parsed flashcard data and deck title by checking if the deck already
	 * exists in Anki, prompting the user for resolution if it does, or exporting it directly.
	 * @param {Object[]} cards - Array of card objects to export.
	 * @param {string} deckTitle - The proposed name of the deck (legacy fallback).
	 * @param {string} nbTitle - The notebook title.
	 * @param {string} quizTitle - The quiz artifact title.
	 * @param {Array<string>} [topicsCovered=[]] - Sanitized topic tags to attach to Anki notes.
	 * @param {number} [imagesFound=0] - Number of cards with image references found in quiz.
	 * @param {number} [imagesResolved=0] - Number of cards with image URLs successfully resolved.
	 * @returns {Promise<void>}
	 */
	async function handleExtractedData(
		cards,
		deckTitle,
		nbTitle,
		quizTitle,
		topicsCovered = [],
		imagesFound = 0,
		imagesResolved = 0,
	) {
		const domQuizTitle = getQuizTitle();
		console.log(
			"[Anki Bridge] 🏷️ getQuizTitle() from top window DOM:",
			domQuizTitle,
		);
		const resolvedQuizTitle = domQuizTitle || quizTitle;
		const finalDeckTitle = NotebookLMToAnkiUtils.formatDeckTitle(
			nbTitle,
			resolvedQuizTitle,
			quizDeckNameTemplate,
		);

		console.log(
			"[Anki Bridge] 🏷️ Refined final deck title:",
			finalDeckTitle,
		);

		console.log(
			"[Anki Bridge] ⚙️ handleExtractedData: Title:",
			finalDeckTitle,
			"Cards Count:",
			cards.length,
		);
		console.log(
			`[Anki Bridge] 🖼️ Images found in quiz: ${imagesFound} (${imagesResolved} ready to export)`,
		);

		// Prevent duplicate extraction processing if already extracting/exporting
		if (isExporting) {
			console.warn(
				"[Anki Bridge] ⚠️ Export already in progress, ignoring duplicate extracted data event.",
			);
			return;
		}
		isExporting = true;
		updateButtonState("loading");

		console.log(
			"[Anki Bridge] 📞 Sending checkDeckExists message to background worker for deck:",
			finalDeckTitle,
		);
		let res;
		try {
			res = await chrome.runtime.sendMessage({
				action: "checkDeckExists",
				deckName: finalDeckTitle,
			});
		} catch (err) {
			console.error("[Anki Bridge] ❌ checkDeckExists query threw:", err);
			res = {
				success: false,
				error: err?.message || "Connection Failed",
			};
		}

		console.log("[Anki Bridge] 📞 checkDeckExists response:", res);
		if (!res?.success) {
			console.error(
				"[Anki Bridge] ❌ checkDeckExists query failed:",
				res ? res.error : "No response object",
			);
			window.top.postMessage(
				{
					action: "ANKI_REAL_FAIL",
					error: res ? res.error : "Unknown Error checking deck",
				},
				"*",
			);
			return;
		}

		if (res.exists) {
			console.log(
				"[Anki Bridge] ⚠️ Deck already exists. Showing duplicate resolution modal.",
			);
			showDuplicateModal(
				finalDeckTitle,
				(userAction, resolvedDeckTitle) => {
					console.log(
						"[Anki Bridge] 👤 User resolved duplicate modal with action:",
						userAction,
						"Deck:",
						resolvedDeckTitle,
					);
					if (userAction === "cancel") {
						isExporting = false;
						updateButtonState("ready");
						return;
					}
					sendBatchToAnkiBackground(
						cards,
						resolvedDeckTitle,
						userAction,
						topicsCovered,
						imagesFound,
					);
				},
			);
		} else {
			console.log(
				"[Anki Bridge] 🆕 Deck does not exist. Proceeding with export.",
			);
			// Default if not exists
			sendBatchToAnkiBackground(
				cards,
				finalDeckTitle,
				"merge",
				topicsCovered,
				imagesFound,
			);
		}
	}

	/**
	 * Sends the batch of cards to the background script to perform the actual
	 * import/creation of the deck in Anki.
	 *
	 * @param {Object[]} cards - Array of card objects.
	 * @param {string} deckTitle - The title of the deck.
	 * @param {string} duplicateAction - Resolution strategy ("merge", "increment", "overwrite").
	 * @param {Array<string>} [topicsCovered=[]] - Array of sanitized topic tags.
	 * @param {number} [imagesFound=0] - Number of cards with image references found in quiz.
	 * @returns {Promise<void>}
	 */
	async function sendBatchToAnkiBackground(
		cards,
		deckTitle,
		duplicateAction,
		topicsCovered = [],
		imagesFound = 0,
	) {
		let res;
		try {
			res = await chrome.runtime.sendMessage({
				action: "sendBatchToAnki",
				batchData: cards,
				deckTitle: deckTitle,
				duplicateAction: duplicateAction,
				topicsCovered: topicsCovered,
				imagesFound: imagesFound,
			});
		} catch (err) {
			console.error(
				"[Anki Bridge] ❌ sendBatchToAnki runtime message threw:",
				err,
			);
			res = {
				success: false,
				error: err?.message || "Connection Failed",
			};
		}

		if (res?.mediaLogs && Array.isArray(res.mediaLogs)) {
			for (const logLine of res.mediaLogs) {
				console.log(`[Anki Background Media] ${logLine}`);
			}
		}

		const exportedImgCount =
			typeof res?.imagesExported === "number" ? res.imagesExported : 0;
		const foundImgCount =
			typeof res?.imagesFound === "number" ? res.imagesFound : imagesFound;

		console.log(
			`[Anki Bridge] 🖼️ Media summary: ${exportedImgCount} of ${foundImgCount} image(s) successfully exported to Anki.`,
		);

		if (foundImgCount > exportedImgCount) {
			console.warn(
				`[Anki Bridge] ⚠️ ${foundImgCount - exportedImgCount} image(s) were not exported. If an image was lazy-loaded, please navigate to that question in NotebookLM and click Anki Export again.`,
			);
		}

		if (res?.success) {
			window.top.postMessage(
				{
					action: "ANKI_REAL_SUCCESS",
					count: res.count,
					deck: deckTitle,
					skipped: res.skipped,
					imagesFound: foundImgCount,
					imagesExported: exportedImgCount,
					mediaLogs: res.mediaLogs || [],
				},
				"*",
			);
		} else {
			window.top.postMessage(
				{
					action: "ANKI_REAL_FAIL",
					error: res ? res.error : "Unknown Error",
				},
				"*",
			);
		}
	}

	/**
	 * Shows the duplicate deck resolution modal to the user.
	 * @param {string} deckTitle - The name of the existing deck.
	 * @param {function(string, string=): void} callback - Callback function invoked with the resolved duplicate action and the final deck title.
	 * @returns {void}
	 */
	function showDuplicateModal(deckTitle, callback) {
		const overlay = document.getElementById("anki-duplicate-modal-overlay");
		if (!overlay) {
			console.error("Modal overlay not found");
			return;
		}

		const titleEl = document.getElementById("anki-modal-deck-title");
		const titleIncEl = document.getElementById("anki-modal-deck-title-inc");
		if (titleEl) titleEl.innerText = deckTitle;
		if (titleIncEl) titleIncEl.innerText = `${deckTitle} (1)`;

		overlay.classList.add("show");

		/**
		 * Helper function to dismiss the duplicate resolution modal overlay.
		 * @returns {void}
		 */
		const close = () => {
			overlay.classList.remove("show");
		};

		document.getElementById("anki-btn-merge").onclick = () => {
			close();
			callback("merge", deckTitle);
		};
		document.getElementById("anki-btn-increment").onclick = () => {
			close();
			callback("increment", `${deckTitle} (1)`);
		};
		document.getElementById("anki-btn-overwrite").onclick = () => {
			close();
			callback("overwrite", deckTitle);
		};
		document.getElementById("anki-btn-cancel").onclick = () => {
			close();
			callback("cancel");
		};
	}

	/**
	 * Formats raw error messages (including Python-style lists from AnkiConnect) by counting
	 * and summarizing duplicate error occurrences.
	 * @param {string|Array} errorVal - The raw error value.
	 * @returns {string} The formatted error summary text.
	 */
	function formatErrorMessage(errorVal) {
		return NotebookLMToAnkiUtils.formatErrorMessage(errorVal);
	}

	/**
	 * Shows the custom error modal with formatted error text.
	 * @param {string} errorText - The raw error text returned from the export.
	 * @returns {void}
	 */
	function showErrorModal(errorText) {
		const overlay = document.getElementById("anki-error-modal-overlay");
		if (!overlay) {
			console.error("[Anki Bridge] Error modal overlay not found");
			alert(`⚠️ Export Failed:\n${formatErrorMessage(errorText)}`);
			return;
		}

		const contentEl = document.getElementById("anki-error-modal-content");
		if (contentEl) {
			contentEl.innerText = formatErrorMessage(errorText);
		}

		overlay.classList.add("show");

		const closeBtn = document.getElementById("anki-error-btn-close");
		if (closeBtn) {
			closeBtn.onclick = () => {
				overlay.classList.remove("show");
			};
		}
	}

	/**
	 * Attempts to retrieve the current notebook title from standard page elements
	 * or the document title.
	 * @returns {string|null} The notebook title, or null if not found.
	 */
	function getNotebookTitle() {
		const input = document.querySelector(
			'input[placeholder="Notebook title"]',
		);
		if (input?.value) {
			return input.value.trim();
		}

		const label = document.querySelector(".title-label");
		if (label?.textContent) {
			return label.textContent.trim();
		}
		if (document.title?.includes("- NotebookLM")) {
			return document.title.replace("- NotebookLM", "").trim();
		}
		return null;
	}

	/**
	 * Attempts to retrieve the quiz title from the DOM.
	 *
	 * Checks the current document and the top document if within an iframe.
	 *
	 * @returns {string|null} The extracted quiz title, or null if not found.
	 */
	function getQuizTitle() {
		const selectors = [
			'input[formcontrolname="title"]',
			'input[aria-label="Artifact title"]',
			"input.artifact-title",
		];

		for (const selector of selectors) {
			const el = document.querySelector(selector);
			if (el) {
				const val = el.value || el.getAttribute("value");
				if (val && val !== "undefined" && String(val).trim() !== "") {
					return String(val).trim();
				}
			}
		}

		// Child frames should never attempt to access window.top.document across origins.
		// Top window executes getQuizTitle directly upon receiving extracted data.
		return null;
	}

	/**
	 * Creates and configures the "Anki Export" button, including its click handler
	 * that triggers status checking and initiates data extraction.
	 * @returns {HTMLElement} The created button element.
	 */
	function createAngularCloneButton() {
		/** @type {Document} */
		const btnDoc = new DOMParser().parseFromString(
			buttonTemplate,
			"text/html",
		);
		const btn = btnDoc.body.firstElementChild;

		btn.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!isMinerConnected) {
				alert("Wait for page to fully load...");
				return;
			}

			// Pre-flight check
			let res;
			try {
				res = await chrome.runtime.sendMessage({
					action: "checkAnkiStatus",
				});
			} catch (err) {
				console.error(
					"[Anki Bridge] ❌ checkAnkiStatus pre-flight check threw:",
					err,
				);
				res = { success: false };
			}

			if (!res?.success) {
				alert("⚠️ AnkiConnect not found! Is Anki running?");
				return;
			}

			btn.classList.remove(
				"notebooklm-to-anki-btn-ready",
				"notebooklm-to-anki-btn-success",
				"notebooklm-to-anki-btn-error",
			);
			btn.classList.add("notebooklm-to-anki-btn-extracting");
			const labelText = btn.querySelector(
				".notebooklm-to-anki-btn-label span:last-child",
			);
			if (labelText) labelText.innerText = "Extracting...";
			let deckName = getNotebookTitle();
			if (!deckName) {
				deckName = prompt("Enter Notebook Name:");
				if (!deckName) {
					updateButtonState("ready");
					return;
				}
			}
			const triggerId = `extract_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
			broadcastToFrames(document, {
				action: "ANKI_TRIGGER_EXTRACT",
				notebookTitle: deckName,
				triggerId: triggerId,
			});
		};
		return btn;
	}

	/**
	 * Updates the visual state, text label, and disabled state of the Anki Export button.
	 * @param {string} state - The target state ("ready", "extracting", "success", "error").
	 * @param {number} [count=0] - Number of cards saved (for success state).
	 * @param {number} [skipped=0] - Number of cards skipped as duplicates (for success state).
	 * @returns {void}
	 */
	function updateButtonState(state, count = 0, skipped = 0) {
		const btn = document.getElementById(CONFIG.BUTTON_ID);
		if (!btn) return;

		const labelText = btn.querySelector(
			".notebooklm-to-anki-btn-label span:last-child",
		);

		// Clear dynamic states
		btn.classList.remove(
			"notebooklm-to-anki-btn-ready",
			"notebooklm-to-anki-btn-success",
			"notebooklm-to-anki-btn-error",
			"notebooklm-to-anki-btn-extracting",
		);

		if (state === "ready") {
			if (labelText) {
				labelText.innerText = "Anki Export";
			}
			btn.classList.add("notebooklm-to-anki-btn-ready");
			btn.disabled = false;
		} else if (state === "success") {
			let msg = `Saved ${count}!`;
			if (skipped > 0) msg = `Saved ${count}, Skipped ${skipped}`;
			if (labelText) {
				labelText.innerText = msg;
			}
			btn.classList.add("notebooklm-to-anki-btn-success");
			setTimeout(() => updateButtonState("ready"), 4000);
		} else if (state === "error") {
			if (labelText) {
				labelText.innerText = "Error";
			}
			btn.classList.add("notebooklm-to-anki-btn-error");
			setTimeout(() => updateButtonState("ready"), 3000);
		}
	}

	initDataMiner();
	if (window === window.top) {
		initUiInjector();
	}
})();

// background.js - v10.0 (Generic Public Release)
importScripts("utils.js");

/**
 * Extension version identifier dynamically read from extension manifest at runtime.
 * @type {string}
 */
const EXTENSION_VERSION =
	(typeof chrome !== "undefined" &&
		(chrome.runtime?.getManifest?.()?.version_name ||
			chrome.runtime?.getManifest?.()?.version)) ||
	"";

self.console.log(
	EXTENSION_VERSION
		? `[Anki Background] 🚀 Service Worker v${EXTENSION_VERSION} initialized.`
		: `[Anki Background] 🚀 Service Worker initialized.`,
);

/**
 * Toggle for debug logging state, updated asynchronously from local storage.
 * @type {boolean}
 */
let enableDebug = true;

// Load configuration setting from storage.
chrome.storage.local
	.get({ enableDebugLogging: true })
	.then((res) => {
		if (res && typeof res.enableDebugLogging === "boolean") {
			enableDebug = res.enableDebugLogging;
		}
	})
	.catch(() => {});

// Listen for settings changes to update status dynamically.
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === "local" && changes.enableDebugLogging) {
		enableDebug = changes.enableDebugLogging.newValue;
	}
});

/**
 * Local shadow console to conditionally forward logs to self.console.
 * @type {{
 *   log: function(...*): void,
 *   warn: function(...*): void,
 *   error: function(...*): void
 * }}
 */
const console = {
	log: (...args) => {
		if (enableDebug) self.console.log(...args);
	},
	warn: (...args) => {
		if (enableDebug) self.console.warn(...args);
	},
	error: (...args) => {
		if (enableDebug) self.console.error(...args);
	},
};

/**
 * Listens for incoming messages from the content script or popup.
 *
 * NOTE: In Chromium MV3, an onMessage listener function must NOT be declared async
 * (e.g. `addListener(async (msg, sender, sendResponse) => ...)`). Returning a Promise
 * from the listener does not keep the message port open in Chrome and causes sendResponse
 * to fail silently. The listener will remain a synchronous function returning boolean true,
 * delegating the async operations to an internal immediately-invoked async function.
 *
 * @param {object} request - The message sender sent.
 * @param {chrome.runtime.MessageSender} sender - Details about the script context that sent the message.
 * @param {function} sendResponse - Function to call to send a response back.
 * @returns {boolean} True to indicate that the response will be sent asynchronously.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	console.log(
		"[Anki Background] 📥 Received runtime message action:",
		request.action,
		"from sender:",
		sender,
	);

	// Checks Anki status.
	if (request.action === "checkAnkiStatus") {
		(async () => {
			console.log(
				"[Anki Background] 🔍 Checking AnkiConnect status at http://127.0.0.1:8765...",
			);
			try {
				const response = await fetch("http://127.0.0.1:8765", {
					method: "POST",
					body: JSON.stringify({ action: "version", version: 6 }),
				});
				console.log(
					"[Anki Background] 📥 checkAnkiStatus HTTP response status:",
					response.status,
				);
				const data = await response.json();
				console.log(
					"[Anki Background] 📥 checkAnkiStatus data response:",
					data,
				);
				sendResponse({ success: true, version: data });
			} catch (err) {
				console.error(
					"[Anki Background] ❌ checkAnkiStatus error:",
					err,
				);
				sendResponse({
					success: false,
					error: "Connection Failed: Is Anki open?",
				});
			}
		})();
		return true;
	}

	// Checks if a deck exists in Anki.
	if (request.action === "checkDeckExists") {
		(async () => {
			console.log(
				"[Anki Background] 🔍 Checking if deck exists:",
				request.deckName,
			);
			try {
				const response = await fetch("http://127.0.0.1:8765", {
					method: "POST",
					body: JSON.stringify({ action: "deckNames", version: 6 }),
				});
				console.log(
					"[Anki Background] 📥 checkDeckExists HTTP response status:",
					response.status,
				);
				const data = await response.json();
				console.log(
					"[Anki Background] 📥 checkDeckExists deckNames retrieved:",
					data,
				);
				if (data.error) {
					console.error(
						"[Anki Background] ❌ checkDeckExists API Error:",
						data.error,
					);
					sendResponse({ success: false, error: data.error });
				} else {
					const exists = data.result.includes(request.deckName);
					console.log(
						"[Anki Background] 🔍 Deck exists status for '" +
							request.deckName +
							"':",
						exists,
					);
					sendResponse({ success: true, exists: exists });
				}
			} catch (err) {
				console.error(
					"[Anki Background] ❌ checkDeckExists failed:",
					err,
				);
				sendResponse({ success: false, error: "Connection Failed" });
			}
		})();
		return true;
	}

	// Handle the message to export a batch of flashcards to Anki
	if (request.action === "sendBatchToAnki") {
		handleSendBatchToAnki(request, sendResponse);
		return true;
	}
});

/**
 * Model field definitions for the 20-field NotebookLM Quiz note type.
 * @type {Array<string>}
 */
const NOTEBOOKLM_MODEL_FIELDS = [
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

/**
 * Converts an ArrayBuffer into a Base64-encoded string without memory overflows.
 *
 * Handles both Node.js (via Buffer) and browser Service Worker (via chunked btoa) environments.
 *
 * @param {ArrayBuffer} buffer - Binary data buffer to encode.
 * @returns {string} Base64-encoded string representation.
 */
function arrayBufferToBase64(buffer) {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(buffer).toString("base64");
	}
	const bytes = new Uint8Array(buffer);
	const chunkSize = 8192;
	let binary = "";
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk);
	}
	return btoa(binary);
}

/**
 * Checks if byte sequence matches PNG magic bytes (89 50 4E 47).
 *
 * @param {Uint8Array} bytes - Binary buffer bytes.
 * @returns {boolean} True if buffer matches PNG magic bytes.
 */
function isPngSignature(bytes) {
	return (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	);
}

/**
 * Checks if byte sequence matches JPEG magic bytes (FF D8 FF).
 *
 * @param {Uint8Array} bytes - Binary buffer bytes.
 * @returns {boolean} True if buffer matches JPEG magic bytes.
 */
function isJpegSignature(bytes) {
	return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Checks if byte sequence matches GIF magic bytes ('GIF8').
 *
 * @param {Uint8Array} bytes - Binary buffer bytes.
 * @returns {boolean} True if buffer matches GIF magic bytes.
 */
function isGifSignature(bytes) {
	return (
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38
	);
}

/**
 * Checks if byte sequence matches WEBP magic bytes ('RIFF' ... 'WEBP').
 *
 * @param {Uint8Array} bytes - Binary buffer bytes.
 * @returns {boolean} True if buffer matches WEBP magic bytes.
 */
function isWebpSignature(bytes) {
	return (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	);
}

/**
 * Inspects a binary sample to verify whether it represents a valid SVG element.
 *
 * Rejects HTML documents, doctype declarations, and non-SVG text payloads.
 *
 * @param {Uint8Array} bytes - Binary buffer bytes.
 * @returns {boolean} True if sample represents valid SVG markup.
 */
function isSvgSample(bytes) {
	const sampleLength = Math.min(bytes.length, 256);
	let textSample = "";
	for (let i = 0; i < sampleLength; i++) {
		textSample += String.fromCharCode(bytes[i]);
	}
	const lowerSample = textSample.toLowerCase().trim();

	// Reject HTML document declarations immediately
	if (
		lowerSample.startsWith("<!doctype") ||
		lowerSample.startsWith("<html") ||
		lowerSample.includes("<base href=")
	) {
		return false;
	}

	return lowerSample.startsWith("<svg") || lowerSample.includes("<svg ");
}

/**
 * Detects the image format from the binary magic bytes of an ArrayBuffer.
 *
 * Rejects HTML, XML, or non-image payloads to prevent storing corrupted assets.
 *
 * @param {ArrayBuffer} buffer - Raw binary buffer of the downloaded asset.
 * @returns {string|null} Image file extension ('png', 'jpg', 'gif', 'webp', 'svg') or null if invalid.
 */
function detectImageFormatFromBuffer(buffer) {
	if (!buffer || buffer.byteLength < 4) return null;
	const bytes = new Uint8Array(buffer);

	if (isPngSignature(bytes)) return "png";
	if (isJpegSignature(bytes)) return "jpg";
	if (isGifSignature(bytes)) return "gif";
	if (isWebpSignature(bytes)) return "webp";
	if (isSvgSample(bytes)) return "svg";

	return null;
}

/**
 * Stores a base64-encoded media file in Anki's collection.media folder via storeMediaFile.
 *
 * @param {string} filename - Target local filename.
 * @param {string} base64Data - Base64-encoded file content.
 * @param {number} idx - Card index for logging.
 * @param {Array<string>} mediaLogs - Diagnostic log collector.
 * @returns {Promise<boolean>} True if storage succeeded, false otherwise.
 */
async function storeMediaToAnki(filename, base64Data, idx, mediaLogs) {
	const storeRes = await fetch("http://127.0.0.1:8765", {
		method: "POST",
		body: JSON.stringify({
			action: "storeMediaFile",
			version: 6,
			params: {
				filename,
				data: base64Data,
			},
		}),
	});

	const storeData = await storeRes.json();
	if (storeData.error) {
		console.warn(
			"[Anki Background] storeMediaFile returned error:",
			storeData.error,
		);
		mediaLogs.push(
			`❌ [Card #${idx + 1}] storeMediaFile returned error: ${storeData.error}`,
		);
		return false;
	}

	mediaLogs.push(
		`✅ [Card #${idx + 1}] Successfully persisted '${filename}' into Anki collection.media.`,
	);
	return true;
}

/**
 * Persists pre-resolved base64 media attached by the content script to Anki.
 *
 * @param {object} card - Flashcard object containing imageBase64.
 * @param {number} idx - Card index.
 * @param {Array<string>} mediaLogs - Diagnostic log collector.
 * @returns {Promise<string>} Saved local filename or empty string on failure.
 */
async function persistPreResolvedMedia(card, idx, mediaLogs) {
	try {
		const detectedExt = card.imageFormat || "png";
		const localFilename = `notebooklm_${Date.now()}_${idx}.${detectedExt}`;
		mediaLogs.push(
			`💾 [Card #${idx + 1}] Found pre-resolved media '${localFilename}' (${card.imageBase64.length} Base64 chars). Persisting via storeMediaFile... Content preview: ${card.imageBase64.substring(0, 60)}...`,
		);
		console.log(
			`[Anki Background] 💾 Persisting pre-resolved media '${localFilename}' (${card.imageBase64.length} Base64 chars) via storeMediaFile... Content preview: ${card.imageBase64.substring(0, 60)}...`,
		);

		const success = await storeMediaToAnki(
			localFilename,
			card.imageBase64,
			idx,
			mediaLogs,
		);
		return success ? localFilename : "";
	} catch (err) {
		console.warn(
			`[Anki Background] ⚠️ Failed to persist pre-resolved media for question "${card.question?.substring(0, 40)}...":`,
			err,
		);
		mediaLogs.push(
			`❌ [Card #${idx + 1}] Exception persisting pre-resolved media: ${err.message}`,
		);
		return "";
	}
}

/**
 * Downloads a remote diagram image, validates its format, and persists it to Anki.
 *
 * @param {object} card - Flashcard object containing diagramUrl.
 * @param {number} idx - Card index.
 * @param {Array<string>} mediaLogs - Diagnostic log collector.
 * @returns {Promise<string>} Saved local filename or empty string on failure.
 */
async function fetchAndPersistRemoteMedia(card, idx, mediaLogs) {
	try {
		mediaLogs.push(
			`🖼️ [Card #${idx + 1}] Fetching diagram media: ${card.diagramUrl}`,
		);
		console.log(
			`[Anki Background] 🖼️ Fetching diagram media from: ${card.diagramUrl}`,
		);

		const imgRes = await fetch(card.diagramUrl, {
			credentials: "include",
		});

		const contentType = imgRes.headers?.get
			? imgRes.headers.get("content-type")
			: "unknown";
		mediaLogs.push(
			`📥 [Card #${idx + 1}] HTTP ${imgRes.status} ${imgRes.statusText} (Redirected: ${imgRes.redirected ? imgRes.url : "no"}, Content-Type: ${contentType})`,
		);

		if (
			imgRes.redirected &&
			(imgRes.url.includes("accounts.google.com") ||
				imgRes.url.includes("signin"))
		) {
			mediaLogs.push(
				`⚠️ [Card #${idx + 1}] Redirected to Google sign-in page: ${imgRes.url}. Authentication cookies missing or unaccepted.`,
			);
			throw new Error(
				"Redirected to Google sign-in page (authentication required).",
			);
		}

		if (!imgRes.ok) {
			mediaLogs.push(
				`❌ [Card #${idx + 1}] HTTP request failed with status ${imgRes.status}: ${imgRes.statusText}`,
			);
			throw new Error(`HTTP ${imgRes.status} ${imgRes.statusText}`);
		}

		const buffer = await imgRes.arrayBuffer();
		if (!buffer || buffer.byteLength === 0) {
			mediaLogs.push(
				`❌ [Card #${idx + 1}] Downloaded image buffer is empty (0 bytes).`,
			);
			throw new Error("Downloaded image buffer is empty (0 bytes).");
		}

		mediaLogs.push(
			`📦 [Card #${idx + 1}] Received ${buffer.byteLength} bytes binary payload.`,
		);

		const detectedExt = detectImageFormatFromBuffer(buffer);
		if (!detectedExt) {
			const snippet = buffer
				? Array.from(new Uint8Array(buffer.slice(0, 20)))
						.map((b) => b.toString(16).padStart(2, "0"))
						.join(" ")
				: "none";
			mediaLogs.push(
				`⚠️ [Card #${idx + 1}] Buffer is not a recognized image format. Hex: ${snippet}`,
			);
			throw new Error(
				"Downloaded content is not a valid image format (HTML or unrecognized binary signature).",
			);
		}

		const localFilename = `notebooklm_${Date.now()}_${idx}.${detectedExt}`;
		const base64Data = arrayBufferToBase64(buffer);

		mediaLogs.push(
			`✨ [Card #${idx + 1}] Valid image format: ${detectedExt.toUpperCase()}. Base64 preview: ${base64Data.substring(0, 60)}...`,
		);
		console.log(
			`[Anki Background] 💾 Persisting media file '${localFilename}' (${buffer.byteLength} bytes) via storeMediaFile... Content preview: ${base64Data.substring(0, 60)}...`,
		);

		const success = await storeMediaToAnki(
			localFilename,
			base64Data,
			idx,
			mediaLogs,
		);
		return success ? localFilename : "";
	} catch (err) {
		console.warn(
			`[Anki Background] ⚠️ Failed to download diagram for question "${card.question?.substring(0, 40)}...":`,
			err,
		);
		mediaLogs.push(
			`⚠️ [Card #${idx + 1}] Failed to download diagram: ${err.message}`,
		);
		return "";
	}
}

/**
 * Builds HTML markup for a card diagram image or fallback placeholder.
 *
 * @param {object} card - Flashcard object.
 * @param {string} localFilename - Local filename of the persisted media asset.
 * @returns {string} HTML markup string.
 */
function buildCardImageHtml(card, localFilename) {
	if (localFilename) {
		const altText = card.diagramAlt || "";
		const escapedAlt = altText.replace(/"/g, "&quot;");
		const altAttr = altText ? ` alt="${escapedAlt}"` : "";
		const titleAttr = altText ? ` title="${escapedAlt}"` : "";
		const captionHtml = card.diagramCaption
			? `<div class="diagram-caption">${card.diagramCaption}</div>`
			: "";
		return `<img src="${localFilename}"${altAttr}${titleAttr}>${captionHtml}`;
	}
	if (card.diagramCaption || card.diagramAlt) {
		const captionText = card.diagramCaption || card.diagramAlt;
		return `<div class="diagram-placeholder"><span class="diagram-error-badge">⚠️ Diagram unavailable</span><div class="diagram-caption">${captionText}</div></div>`;
	}
	return "";
}

/**
 * Processes media for a single card, persisting either pre-resolved base64 or remote diagram asset.
 *
 * @param {object} card - Flashcard object.
 * @param {number} idx - Index of card in batch.
 * @param {Array<string>} mediaLogs - Diagnostic log collector.
 * @returns {Promise<object>} Card populated with image HTML and mediaPersisted flag.
 */
async function processSingleCardMedia(card, idx, mediaLogs) {
	if (!card.diagramUrl) return card;

	// 1. Persist pre-resolved Base64 media or download remote diagram
	const localFilename = card.imageBase64
		? await persistPreResolvedMedia(card, idx, mediaLogs)
		: await fetchAndPersistRemoteMedia(card, idx, mediaLogs);

	// 2. Build image field HTML markup
	return {
		...card,
		image: buildCardImageHtml(card, localFilename),
		mediaPersisted: Boolean(localFilename),
	};
}

/**
 * Processes cards to persist diagram images into Anki's collection.media folder via storeMediaFile.
 *
 * Uses pre-resolved Base64 media attached by the top window, or falls back to direct authenticated fetch.
 *
 * Emits comprehensive mediaLogs for UI feedback.
 *
 * @param {Array<object>} cards - Array of card objects.
 * @param {Array<string>} [mediaLogs=[]] - Diagnostic log collector for reporting back to the UI.
 * @returns {Promise<Array<object>>} Cards with local or fallback image markup populated.
 */
async function processCardMedia(cards, mediaLogs = []) {
	if (!Array.isArray(cards)) return [];

	return Promise.all(
		cards.map((card, idx) => processSingleCardMedia(card, idx, mediaLogs)),
	);
}

/**
 * Prepares the target deck in Anki by deleting it if an overwrite was requested,
 * and creating or verifying that the target deck exists.
 *
 * @param {string} targetDeck - Name of the target deck.
 * @param {string} duplicateAction - Conflict resolution strategy ('overwrite', 'merge', 'increment').
 * @returns {Promise<void>} Resolves when deck preparation is complete.
 */
async function prepareTargetDeck(targetDeck, duplicateAction) {
	// 2. Handle overwrite if requested
	if (duplicateAction === "overwrite") {
		console.log(
			"[Anki Background] ⚠️ Overwrite requested. Deleting deck:",
			targetDeck,
		);
		const delRes = await fetch("http://127.0.0.1:8765", {
			method: "POST",
			body: JSON.stringify({
				action: "deleteDecks",
				version: 6,
				params: { decks: [targetDeck], cardsToo: true },
			}),
		});
		const delData = await delRes.json();
		console.log(
			"[Anki Background] 🗑️ Deck deletion response payload:",
			delData,
		);
	}

	// 3. Create or verify deck exists
	console.log(
		"[Anki Background] 📦 Creating deck (or verifying):",
		targetDeck,
	);
	const deckRes = await fetch("http://127.0.0.1:8765", {
		method: "POST",
		body: JSON.stringify({
			action: "createDeck",
			version: 6,
			params: { deck: targetDeck },
		}),
	});
	const deckData = await deckRes.json();
	if (deckData.error) {
		throw new Error(deckData.error);
	}
}

/**
 * Queries Anki for existing notes in the target deck and filters out duplicates.
 *
 * @param {string} targetDeck - Target deck name to inspect.
 * @param {Array<object>} notes - Proposed note payloads to insert.
 * @returns {Promise<{ finalNotesToSend: Array<object>, initialSkippedCount: number }>} Filtered notes and skipped duplicate count.
 */
async function deduplicateMergeNotes(targetDeck, notes) {
	console.log(
		"[Anki Background] 🔍 Fetching existing notes in target deck to perform local duplicate check...",
	);
	try {
		const findRes = await fetch("http://127.0.0.1:8765", {
			method: "POST",
			body: JSON.stringify({
				action: "findNotes",
				version: 6,
				params: {
					query: `deck:"${targetDeck}"`,
				},
			}),
		});
		const findResult = await findRes.json();
		const noteIds = findResult.result || [];

		if (noteIds.length > 0) {
			const infoRes = await fetch("http://127.0.0.1:8765", {
				method: "POST",
				body: JSON.stringify({
					action: "notesInfo",
					version: 6,
					params: {
						notes: noteIds,
					},
				}),
			});
			const infoResult = await infoRes.json();
			const existingQuestions = new Set();
			if (infoResult.result && Array.isArray(infoResult.result)) {
				infoResult.result.forEach((note) => {
					if (note?.fields?.Question?.value) {
						existingQuestions.add(
							NotebookLMToAnkiUtils.normalizeQuestionText(
								note.fields.Question.value,
							),
						);
					}
				});
			}

			const filterResult = NotebookLMToAnkiUtils.filterDuplicateNotes(
				notes,
				existingQuestions,
			);
			console.log(
				"[Anki Background] 🔍 Local duplicate check complete. Original:",
				notes.length,
				"To Send:",
				filterResult.notesToSend.length,
				"Skipped:",
				filterResult.skippedCount,
			);
			return {
				finalNotesToSend: filterResult.notesToSend,
				initialSkippedCount: filterResult.skippedCount,
			};
		}
	} catch (err) {
		console.warn(
			"[Anki Background] Local duplicate checking failed, proceeding with all notes:",
			err,
		);
	}

	return {
		finalNotesToSend: notes,
		initialSkippedCount: 0,
	};
}

/**
 * Handles the sendBatchToAnki action workflow: ensures model exists, handles deck conflict/overwrite,
 * caches media assets, checks for duplicate questions, and adds notes to Anki.
 *
 * @param {object} request - Message payload containing deckTitle, duplicateAction, batchData, topicsCovered.
 * @param {function(object): void} sendResponse - Callback function for returning result envelope to caller.
 * @returns {Promise<void>}
 */
async function handleSendBatchToAnki(request, sendResponse) {
	/**
	 * Diagnostic logs collected during media persistence.
	 * @type {Array<string>}
	 */
	const mediaLogs = [];

	/**
	 * Total count of cards containing media references in this batch.
	 * @type {number}
	 */
	const imagesFound =
		typeof request.imagesFound === "number"
			? request.imagesFound
			: (request.batchData || []).filter(
					(c) =>
						c.hasMediaReference ||
						c.diagramUrl ||
						c.diagramCaption ||
						c.diagramAlt,
				).length;

	/**
	 * Count of media assets successfully persisted to Anki collection.media.
	 * @type {number}
	 */
	let imagesExported = 0;

	try {
		console.log(
			"[Anki Background] 🚀 Starting export batch to Anki. Title:",
			request.deckTitle,
			"Action:",
			request.duplicateAction,
			"Batch size:",
			request.batchData ? request.batchData.length : 0,
		);

		/**
		 * The destination deck name in Anki where the cards will be stored.
		 * @type {string}
		 */
		const TARGET_DECK = request.deckTitle;
		/**
		 * The custom Anki Note Type containing the schema for NotebookLM Quiz cards.
		 *
		 * IMPORTANT: Make sure this NOTE_TYPE exists in Anki before running the extension.
		 * @type {string}
		 */
		const NOTE_TYPE = "NotebookLM Quiz";

		// 1. Ensure Model exists and schema is up-to-date
		console.log(
			"[Anki Background] 🛠️ Ensuring NotebookLM Quiz model exists...",
		);
		await ensureNotebookLMModelExists();

		// 2 & 3. Prepare target deck (overwrite if requested, verify deck exists)
		await prepareTargetDeck(TARGET_DECK, request.duplicateAction);

		// 4. Download media assets to Anki media collection
		const processedCards = await processCardMedia(
			request.batchData || [],
			mediaLogs,
		);
		imagesExported = processedCards.filter(
			(c) => c.mediaPersisted,
		).length;

		// 5. Map cards to Anki note objects with topic tags
		const notes = NotebookLMToAnkiUtils.mapCardsToAnkiNotes(
			processedCards,
			TARGET_DECK,
			NOTE_TYPE,
			request.topicsCovered || [],
		);

		let finalNotesToSend = notes;
		let initialSkippedCount = 0;

		// 6. Deduplicate notes if merge strategy
		if (request.duplicateAction === "merge") {
			const mergeRes = await deduplicateMergeNotes(TARGET_DECK, notes);
			finalNotesToSend = mergeRes.finalNotesToSend;
			initialSkippedCount = mergeRes.initialSkippedCount;
		}

		// 7. Insert notes into Anki
		console.log(
			`[Anki Background] 🖼️ Media report: ${imagesExported} of ${imagesFound} image(s) persisted to Anki collection.media.`,
		);

		if (finalNotesToSend.length === 0) {
			console.log(
				"[Anki Background] ℹ️ No new notes to insert after duplicate filtering.",
			);
			sendResponse({
				success: true,
				count: 0,
				skipped: initialSkippedCount,
				imagesFound: imagesFound,
				imagesExported: imagesExported,
				mediaLogs: mediaLogs,
			});
			return;
		}

		console.log(
			"[Anki Background] 📤 Adding notes to deck:",
			TARGET_DECK,
			"Count:",
			finalNotesToSend.length,
		);
		const addRes = await fetch("http://127.0.0.1:8765", {
			method: "POST",
			body: JSON.stringify({
				action: "addNotes",
				version: 6,
				params: { notes: finalNotesToSend },
			}),
		});
		const addData = await addRes.json();

		if (addData.error) {
			console.error(
				"[Anki Background] ❌ AnkiConnect addNotes Error",
				addData.error,
			);
			sendResponse({
				success: false,
				error: `Anki Error: ${addData.error}`,
				imagesFound: imagesFound,
				imagesExported: imagesExported,
				mediaLogs: mediaLogs,
			});
			return;
		}

		const successCount = addData.result.filter((id) => id !== null).length;
		const skippedCount =
			initialSkippedCount + (addData.result.length - successCount);

		console.log(
			"[Anki Background] 🎉 addNotes finished. Success count:",
			successCount,
			"Skipped duplicates count:",
			skippedCount,
		);
		sendResponse({
			success: true,
			count: successCount,
			skipped: skippedCount,
			imagesFound: imagesFound,
			imagesExported: imagesExported,
			mediaLogs: mediaLogs,
		});
	} catch (err) {
		console.error("[Anki Background] ❌ AnkiConnect Action Failed", err);
		sendResponse({
			success: false,
			error: `Anki Error: ${err.message}`,
			imagesFound: imagesFound,
			imagesExported: imagesExported,
			mediaLogs: mediaLogs,
		});
	}
}

/**
 * Ensures that the custom "NotebookLM Quiz" note type (model) exists in Anki and is up-to-date.
 *
 * If missing, creates the model with 20 fields, templates, and styling.
 *
 * If already present, checks existing fields, migrates legacy 'ArchDiagram' to 'Image',
 * adds missing adaptive fields via modelFieldAdd, and updates templates/styling.
 *
 * @returns {Promise<void>} Resolves when the note type is guaranteed to exist and match schema.
 */
async function ensureNotebookLMModelExists() {
	const NOTE_TYPE = "NotebookLM Quiz";
	console.log(
		"[Anki Background] 🔍 ensureNotebookLMModelExists: querying existing modelNames.",
	);

	// 1. Fetch available note types (models) from Anki
	const response = await fetch("http://127.0.0.1:8765", {
		method: "POST",
		body: JSON.stringify({ action: "modelNames", version: 6 }),
	});
	const data = await response.json();
	if (data.error) {
		console.error(
			"[Anki Background] ❌ modelNames fetch failed:",
			data.error,
		);
		throw new Error(data.error);
	}

	/**
	 * Loads card templates (front/back HTML) and CSS styles asynchronously from extension assets.
	 *
	 * @returns {Promise<[string, string, string]>} Promise resolving to [frontHtml, backHtml, stylingCss].
	 */
	const loadLocalTemplates = async () => {
		/**
		 * Fetches text content of a local extension asset asynchronously.
		 *
		 * @param {string} relativePath - Path to extension asset.
		 * @param {string} fileName - Asset file name for error reporting.
		 * @returns {Promise<string>} File text content.
		 */
		const fetchAsset = async (relativePath, fileName) => {
			const res = await fetch(chrome.runtime.getURL(relativePath));
			if (!res.ok) throw new Error(`Failed to fetch ${fileName}`);
			return res.text();
		};

		return Promise.all([
			fetchAsset("anki_templates/front.html", "front.html"),
			fetchAsset("anki_templates/back.html", "back.html"),
			fetchAsset("anki_templates/styling.css", "styling.css"),
		]);
	};

	// If model exists, check schema and perform non-destructive migrations
	if (data.result && data.result.includes(NOTE_TYPE)) {
		console.log(
			`[Anki Background] ✅ Model '${NOTE_TYPE}' exists in Anki. Checking schema...`,
		);

		try {
			const fieldRes = await fetch("http://127.0.0.1:8765", {
				method: "POST",
				body: JSON.stringify({
					action: "modelFieldNames",
					version: 6,
					params: { modelName: NOTE_TYPE },
				}),
			});
			const fieldData = await fieldRes.json();

			if (fieldData.result && Array.isArray(fieldData.result)) {
				let existingFields = [...fieldData.result];

				// Migrate legacy ArchDiagram -> Image
				if (
					existingFields.includes("ArchDiagram") &&
					!existingFields.includes("Image")
				) {
					console.log(
						"[Anki Background] 🔄 Renaming field 'ArchDiagram' to 'Image' in model...",
					);
					const renameRes = await fetch("http://127.0.0.1:8765", {
						method: "POST",
						body: JSON.stringify({
							action: "modelFieldRename",
							version: 6,
							params: {
								modelName: NOTE_TYPE,
								oldFieldName: "ArchDiagram",
								newFieldName: "Image",
							},
						}),
					});
					const renameData = await renameRes.json();
					if (!renameData.error) {
						existingFields = existingFields.map((f) =>
							f === "ArchDiagram" ? "Image" : f,
						);
					}
				}

				// Add any missing fields
				const missingFields = NOTEBOOKLM_MODEL_FIELDS.filter(
					(f) => !existingFields.includes(f),
				);

				for (const fieldName of missingFields) {
					console.log(
						`[Anki Background] ➕ Adding missing field '${fieldName}' to model...`,
					);
					await fetch("http://127.0.0.1:8765", {
						method: "POST",
						body: JSON.stringify({
							action: "modelFieldAdd",
							version: 6,
							params: {
								modelName: NOTE_TYPE,
								fieldName,
							},
						}),
					});
				}
			}

			// Update templates and styling
			const [frontHtml, backHtml, stylingCss] =
				await loadLocalTemplates();
			const tmplRes = await fetch("http://127.0.0.1:8765", {
				method: "POST",
				body: JSON.stringify({
					action: "updateModelTemplates",
					version: 6,
					params: {
						model: {
							name: NOTE_TYPE,
							templates: {
								"NotebookLM Quiz": {
									Front: frontHtml,
									Back: backHtml,
								},
							},
						},
					},
				}),
			});
			const tmplData = await tmplRes.json();
			if (tmplData.error) {
				console.warn(
					"[Anki Background] ⚠️ updateModelTemplates error:",
					tmplData.error,
				);
			}

			const styleRes = await fetch("http://127.0.0.1:8765", {
				method: "POST",
				body: JSON.stringify({
					action: "updateModelStyling",
					version: 6,
					params: {
						model: {
							name: NOTE_TYPE,
							css: stylingCss,
						},
					},
				}),
			});
			const styleData = await styleRes.json();
			if (styleData.error) {
				console.warn(
					"[Anki Background] ⚠️ updateModelStyling error:",
					styleData.error,
				);
			}
		} catch (err) {
			console.warn(
				"[Anki Background] Non-critical error during model schema check or template update:",
				err,
			);
		}

		return;
	}

	console.log(
		`[Anki Background] ℹ️ Model '${NOTE_TYPE}' not found. Creating model with 20 fields...`,
	);

	const [frontHtml, backHtml, stylingCss] = await loadLocalTemplates();

	const createResponse = await fetch("http://127.0.0.1:8765", {
		method: "POST",
		body: JSON.stringify({
			action: "createModel",
			version: 6,
			params: {
				modelName: NOTE_TYPE,
				inOrderFields: NOTEBOOKLM_MODEL_FIELDS,
				css: stylingCss,
				cardTemplates: [
					{
						Name: "NotebookLM Quiz",
						Front: frontHtml,
						Back: backHtml,
					},
				],
			},
		}),
	});
	const createData = await createResponse.json();
	console.log("[Anki Background] 📤 createModel response:", createData);
	if (createData.error) {
		throw new Error(`Failed to create note type: ${createData.error}`);
	}
	console.log(
		`[Anki Background] ✅ Model '${NOTE_TYPE}' successfully created in Anki.`,
	);
}

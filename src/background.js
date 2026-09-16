// background.js - v10.0 (Generic Public Release)
importScripts("utils.js");

/**
 * Toggle for debug logging state, updated asynchronously from local storage.
 * @type {boolean}
 */
let enableDebug = true;

// Load configuration setting from storage.
chrome.storage.local.get({ enableDebugLogging: true }, (res) => {
	enableDebug = res.enableDebugLogging;
});

// Listen for settings changes to update status dynamically.
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === "local" && changes.enableDebugLogging) {
		enableDebug = changes.enableDebugLogging.newValue;
	}
});

/**
 * Local shadow console to conditionally forward logs to self.console.
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
		console.log(
			"[Anki Background] 🔍 Checking AnkiConnect status at http://127.0.0.1:8765...",
		);
		fetch("http://127.0.0.1:8765", {
			method: "POST",
			body: JSON.stringify({ action: "version", version: 6 }),
		})
			.then((response) => {
				console.log(
					"[Anki Background] 📥 checkAnkiStatus HTTP response status:",
					response.status,
				);
				return response.json();
			})
			.then((data) => {
				console.log(
					"[Anki Background] 📥 checkAnkiStatus data response:",
					data,
				);
				sendResponse({ success: true, version: data });
			})
			.catch((err) => {
				console.error(
					"[Anki Background] ❌ checkAnkiStatus error:",
					err,
				);
				sendResponse({
					success: false,
					error: "Connection Failed: Is Anki open?",
				});
			});
		return true;
	}

	// Checks if a deck exists in Anki.
	if (request.action === "checkDeckExists") {
		console.log(
			"[Anki Background] 🔍 Checking if deck exists:",
			request.deckName,
		);
		fetch("http://127.0.0.1:8765", {
			method: "POST",
			body: JSON.stringify({ action: "deckNames", version: 6 }),
		})
			.then((response) => {
				console.log(
					"[Anki Background] 📥 checkDeckExists HTTP response status:",
					response.status,
				);
				return response.json();
			})
			.then((data) => {
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
			})
			.catch((err) => {
				console.error(
					"[Anki Background] ❌ checkDeckExists failed:",
					err,
				);
				sendResponse({ success: false, error: "Connection Failed" });
			});
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
 * Processes cards to download any remote media assets into Anki's media collection via storeMediaFile.
 * Returns an updated array of card objects with local img HTML in card.image.
 *
 * @param {Array<object>} cards - Array of card objects.
 * @returns {Promise<Array<object>>} Cards with local or remote image markup populated.
 */
async function processCardMedia(cards) {
	if (!Array.isArray(cards)) return [];

	return Promise.all(
		cards.map(async (card, idx) => {
			if (!card.diagramUrl) return card;

			let localFilename = "";
			try {
				const cleanUrl = card.diagramUrl.split("?")[0];
				const extMatch = cleanUrl.match(/\.(png|jpe?g|webp|gif|svg)$/i);
				const ext = extMatch ? extMatch[1] : "png";
				localFilename = `notebooklm_${Date.now()}_${idx}.${ext}`;

				console.log(
					`[Anki Background] 🖼️ Storing media file ${localFilename} from URL: ${card.diagramUrl}`,
				);
				const storeRes = await fetch("http://127.0.0.1:8765", {
					method: "POST",
					body: JSON.stringify({
						action: "storeMediaFile",
						version: 6,
						params: {
							filename: localFilename,
							url: card.diagramUrl,
						},
					}),
				});
				const storeData = await storeRes.json();
				if (storeData.error) {
					console.warn(
						"[Anki Background] storeMediaFile returned error, falling back to direct URL:",
						storeData.error,
					);
					localFilename = "";
				}
			} catch (err) {
				console.warn(
					"[Anki Background] Failed to download media via AnkiConnect:",
					err,
				);
				localFilename = "";
			}

			const imgSrc = localFilename || card.diagramUrl;
			const altAttr = card.diagramAlt ? ` alt="${card.diagramAlt}"` : "";
			const captionHtml = card.diagramCaption
				? `<div class="diagram-caption">${card.diagramCaption}</div>`
				: "";
			const imageFieldHtml = `<img src="${imgSrc}"${altAttr}>${captionHtml}`;

			return {
				...card,
				image: imageFieldHtml,
			};
		}),
	);
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
	try {
		console.log(
			"[Anki Background] 🚀 Starting export batch to Anki. Title:",
			request.deckTitle,
			"Action:",
			request.duplicateAction,
			"Batch size:",
			request.batchData ? request.batchData.length : 0,
		);

		const TARGET_DECK = request.deckTitle;
		const NOTE_TYPE = "NotebookLM Quiz";

		// 1. Ensure Model exists and schema is up-to-date
		console.log(
			"[Anki Background] 🛠️ Ensuring NotebookLM Quiz model exists...",
		);
		await ensureNotebookLMModelExists();

		// 2. Handle overwrite if requested
		if (request.duplicateAction === "overwrite") {
			console.log(
				"[Anki Background] ⚠️ Overwrite requested. Deleting deck:",
				TARGET_DECK,
			);
			const delRes = await fetch("http://127.0.0.1:8765", {
				method: "POST",
				body: JSON.stringify({
					action: "deleteDecks",
					version: 6,
					params: { decks: [TARGET_DECK], cardsToo: true },
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
			TARGET_DECK,
		);
		const deckRes = await fetch("http://127.0.0.1:8765", {
			method: "POST",
			body: JSON.stringify({
				action: "createDeck",
				version: 6,
				params: { deck: TARGET_DECK },
			}),
		});
		const deckData = await deckRes.json();
		if (deckData.error) {
			throw new Error(deckData.error);
		}

		// 4. Download media assets to Anki media collection
		const processedCards = await processCardMedia(request.batchData || []);

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
							query: `deck:"${TARGET_DECK}"`,
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

					const filterResult =
						NotebookLMToAnkiUtils.filterDuplicateNotes(
							notes,
							existingQuestions,
						);
					finalNotesToSend = filterResult.notesToSend;
					initialSkippedCount = filterResult.skippedCount;

					console.log(
						"[Anki Background] 🔍 Local duplicate check complete. Original:",
						notes.length,
						"To Send:",
						finalNotesToSend.length,
						"Skipped:",
						initialSkippedCount,
					);
				}
			} catch (err) {
				console.warn(
					"[Anki Background] Local duplicate checking failed, proceeding with all notes:",
					err,
				);
			}
		}

		// 7. Insert notes into Anki
		if (finalNotesToSend.length === 0) {
			console.log(
				"[Anki Background] ℹ️ No new notes to insert after duplicate filtering.",
			);
			sendResponse({
				success: true,
				count: 0,
				skipped: initialSkippedCount,
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
		});
	} catch (err) {
		console.error("[Anki Background] ❌ AnkiConnect Action Failed", err);
		sendResponse({
			success: false,
			error: `Anki Error: ${err.message}`,
		});
	}
}

/**
 * Ensures that the custom "NotebookLM Quiz" note type (model) exists in Anki and is up-to-date.
 * If missing, creates the model with 20 fields, templates, and styling.
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

	// Helper to load templates and CSS from extension package
	const loadLocalTemplates = async () => {
		const frontUrl = chrome.runtime.getURL("anki_templates/front.html");
		const backUrl = chrome.runtime.getURL("anki_templates/back.html");
		const cssUrl = chrome.runtime.getURL("anki_templates/styling.css");

		return Promise.all([
			fetch(frontUrl).then((r) => {
				if (!r.ok) throw new Error("Failed to fetch front.html");
				return r.text();
			}),
			fetch(backUrl).then((r) => {
				if (!r.ok) throw new Error("Failed to fetch back.html");
				return r.text();
			}),
			fetch(cssUrl).then((r) => {
				if (!r.ok) throw new Error("Failed to fetch styling.css");
				return r.text();
			}),
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
			await fetch("http://127.0.0.1:8765", {
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
			}).catch(() => {});

			await fetch("http://127.0.0.1:8765", {
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
			}).catch(() => {});
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

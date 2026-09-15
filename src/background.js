// background.js - v10.0 (Generic Public Release)

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
		 */
		const NOTE_TYPE = "NotebookLM Quiz";

		// 2. FIELD MAPPING (Your verified 15-field map)
		const notes = request.batchData.map((card) => {
			return {
				deckName: TARGET_DECK,
				modelName: NOTE_TYPE,
				fields: {
					// --- HEADER FIELDS ---
					Question: card.question,
					Hint: card.hint,
					ArchDiagram: "",

					// --- OPTION 1 (Rationale First) ---
					Option1: card.option1,
					Rationale1: card.rationale1,
					Flag1: card.flag1,

					// --- OPTION 2 (Flag First) ---
					Option2: card.option2,
					Flag2: card.flag2,
					Rationale2: card.rationale2,

					// --- OPTION 3 (Flag First) ---
					Option3: card.option3,
					Flag3: card.flag3,
					Rationale3: card.rationale3,

					// --- OPTION 4 (Flag First) ---
					Option4: card.option4,
					Flag4: card.flag4,
					Rationale4: card.rationale4,
				},
				options: {
					allowDuplicate: true,
				},
				tags: ["notebooklm_export"],
			};
		});

		console.log(
			"[Anki Background] 🛠️ Ensuring NotebookLM Quiz model exists...",
		);
		let preFlightPromise = ensureNotebookLMModelExists();
		if (request.duplicateAction === "overwrite") {
			console.log(
				"[Anki Background] ⚠️ Overwrite requested. Deleting deck:",
				TARGET_DECK,
			);
			preFlightPromise = preFlightPromise.then(() => {
				return fetch("http://127.0.0.1:8765", {
					method: "POST",
					body: JSON.stringify({
						action: "deleteDecks",
						version: 6,
						params: { decks: [TARGET_DECK], cardsToo: true },
					}),
				})
					.then((res) => {
						console.log(
							"[Anki Background] 🗑️ Deck deletion response status:",
							res.status,
						);
						return res.json();
					})
					.then((deleteData) => {
						console.log(
							"[Anki Background] 🗑️ Deck deletion response payload:",
							deleteData,
						);
						return deleteData;
					});
			});
		}

		// 3. SEND TO ANKI
		let finalNotesToSend = notes;
		let initialSkippedCount = 0;

		preFlightPromise
			.then(() => {
				console.log(
					"[Anki Background] 📦 Creating deck (or verifying):",
					TARGET_DECK,
				);
				return fetch("http://127.0.0.1:8765", {
					method: "POST",
					body: JSON.stringify({
						action: "createDeck",
						version: 6,
						params: { deck: TARGET_DECK },
					}),
				});
			})
			.then((res) => res.json())
			.then((createDeckData) => {
				if (createDeckData.error) {
					throw new Error(createDeckData.error);
				}

				if (request.duplicateAction === "merge") {
					console.log(
						"[Anki Background] 🔍 Fetching existing notes in target deck to perform local duplicate check...",
					);
					return fetch("http://127.0.0.1:8765", {
						method: "POST",
						body: JSON.stringify({
							action: "findNotes",
							version: 6,
							params: {
								query: `deck:"${TARGET_DECK}"`,
							},
						}),
					})
						.then((res) => res.json())
						.then((findResult) => {
							const noteIds = findResult.result || [];
							if (noteIds.length === 0) {
								return notes;
							}
							return fetch("http://127.0.0.1:8765", {
								method: "POST",
								body: JSON.stringify({
									action: "notesInfo",
									version: 6,
									params: {
										notes: noteIds,
									},
								}),
							})
								.then((res) => res.json())
								.then((infoResult) => {
									const existingQuestions = new Set();
									if (
										infoResult.result &&
										Array.isArray(infoResult.result)
									) {
										infoResult.result.forEach((note) => {
											if (note?.fields?.Question) {
												existingQuestions.add(
													note.fields.Question.value
														.trim()
														.toLowerCase(),
												);
											}
										});
									}

									finalNotesToSend = notes.filter((n) => {
										const qText =
											n.fields.Question.trim().toLowerCase();
										if (existingQuestions.has(qText)) {
											initialSkippedCount++;
											return false;
										}
										return true;
									});

									console.log(
										"[Anki Background] 🔍 Local duplicate check complete. Original:",
										notes.length,
										"To Send:",
										finalNotesToSend.length,
										"Skipped:",
										initialSkippedCount,
									);
									return finalNotesToSend;
								});
						})
						.catch((err) => {
							console.warn(
								"[Anki Background] Local duplicate checking failed, proceeding with all notes:",
								err,
							);
							return notes;
						});
				}
				return notes;
			})
			.then((notesToInsert) => {
				if (notesToInsert.length === 0) {
					console.log(
						"[Anki Background] ℹ️ No new notes to insert after duplicate filtering.",
					);
					return { result: [], error: null };
				}
				console.log(
					"[Anki Background] 📤 Adding notes to deck:",
					TARGET_DECK,
					"Count:",
					notesToInsert.length,
				);
				return fetch("http://127.0.0.1:8765", {
					method: "POST",
					body: JSON.stringify({
						action: "addNotes",
						version: 6,
						params: { notes: notesToInsert },
					}),
				}).then((response) => response.json());
			})
			.then((data) => {
				console.log(
					"[Anki Background] 📥 addNotes response data payload:",
					data,
				);
				if (data.error) {
					console.error(
						"[Anki Background] ❌ AnkiConnect addNotes Error",
						data.error,
					);
					sendResponse({
						success: false,
						error: `Anki Error: ${data.error}`,
					});
				} else {
					const successCount = data.result.filter(
						(id) => id !== null,
					).length;
					const skippedCount =
						initialSkippedCount +
						(data.result.length - successCount);
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
				}
			})
			.catch((err) => {
				console.error(
					"[Anki Background] ❌ AnkiConnect Action Failed",
					err,
				);
				sendResponse({
					success: false,
					error: `Anki Error: ${err.message}`,
				});
			});

		return true;
	}
});

/**
 * Ensures that the custom "NotebookLM Quiz" note type (model) exists in Anki.
 * If it does not exist, fetches the templates from the extension package
 * and creates the model via AnkiConnect.
 *
 * @returns {Promise<void>} Resolves when the note type is guaranteed to exist.
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

	// If the model already exists, no need to recreate it
	if (data.result.includes(NOTE_TYPE)) {
		console.log(
			"[Anki Background] ✅ Model '" +
				NOTE_TYPE +
				"' already exists in Anki. Skipping creation.",
		);
		return;
	}

	console.log(
		"[Anki Background] ℹ️ Model '" +
			NOTE_TYPE +
			"' not found. Recreating model from local templates...",
	);

	// 2. Fetch the template and style files from the extension
	const frontUrl = chrome.runtime.getURL("anki_templates/front.html");
	const backUrl = chrome.runtime.getURL("anki_templates/back.html");
	const cssUrl = chrome.runtime.getURL("anki_templates/styling.css");

	console.log("[Anki Background] 📥 Fetching local templates:", {
		frontUrl,
		backUrl,
		cssUrl,
	});
	const [frontHtml, backHtml, stylingCss] = await Promise.all([
		fetch(frontUrl).then((r) => {
			console.log(
				"[Anki Background] 📥 Fetch front.html status:",
				r.status,
			);
			if (!r.ok)
				throw new Error(
					"Failed to fetch front.html from extension package",
				);
			return r.text();
		}),
		fetch(backUrl).then((r) => {
			console.log(
				"[Anki Background] 📥 Fetch back.html status:",
				r.status,
			);
			if (!r.ok)
				throw new Error(
					"Failed to fetch back.html from extension package",
				);
			return r.text();
		}),
		fetch(cssUrl).then((r) => {
			console.log(
				"[Anki Background] 📥 Fetch styling.css status:",
				r.status,
			);
			if (!r.ok)
				throw new Error(
					"Failed to fetch styling.css from extension package",
				);
			return r.text();
		}),
	]);

	console.log(
		"[Anki Background] 📤 Creating Model '" + NOTE_TYPE + "' in Anki...",
	);
	// 3. Create the "NotebookLM Quiz" note type in Anki
	const createResponse = await fetch("http://127.0.0.1:8765", {
		method: "POST",
		body: JSON.stringify({
			action: "createModel",
			version: 6,
			params: {
				modelName: NOTE_TYPE,
				inOrderFields: [
					"Question",
					"Hint",
					"ArchDiagram",
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
				],
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
		"[Anki Background] ✅ Model '" +
			NOTE_TYPE +
			"' successfully created in Anki.",
	);
}

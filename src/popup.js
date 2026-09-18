/**
 * Initializes the popup UI, loads stored user settings, and attaches event listeners.
 */
document.addEventListener("DOMContentLoaded", async () => {
	/** @type {HTMLButtonElement|null} */
	const btn = document.getElementById("sendToAnki");
	/** @type {HTMLElement|null} */
	const statusEl = document.getElementById("status");
	/** @type {HTMLElement|null} */
	const debugStatusEl = document.getElementById("debug-status");
	/** @type {HTMLButtonElement|null} */
	const toggleDebugBtn = document.getElementById("toggleDebug");
	/** @type {HTMLInputElement|null} */
	const deckNameTemplateInput = document.getElementById(
		"quizDeckNameTemplate",
	);

	// Populate version identifier dynamically from manifest if available
	const buildEl = document.getElementById("build-version");
	if (
		buildEl &&
		typeof chrome !== "undefined" &&
		chrome.runtime?.getManifest
	) {
		const manifest = chrome.runtime.getManifest();
		const versionText = manifest?.version_name || manifest?.version;
		if (versionText) {
			buildEl.textContent = `v${versionText}`;
		}
	}

	// Load the stored state
	try {
		const res = await chrome.storage.local.get({
			enableDebugLogging: true,
			quizDeckNameTemplate:
				"NotebookLM::{notebookName}::Quizzes::{quizName}",
		});
		if (res) {
			updateDebugUi(res.enableDebugLogging);
			if (deckNameTemplateInput && res.quizDeckNameTemplate) {
				deckNameTemplateInput.value = res.quizDeckNameTemplate;
			}
		}
	} catch (e) {
		console.error("Failed to load settings from storage:", e);
	}

	/**
	 * Handles changes to the deck name template input field by persisting to storage.
	 *
	 * @param {Event} e - Input event containing updated value.
	 * @returns {Promise<void>}
	 */
	const handleTemplateInput = async (e) => {
		try {
			await chrome.storage.local.set({
				quizDeckNameTemplate: e.target.value,
			});
		} catch (err) {
			console.error("Failed to persist deck name template:", err);
		}
	};

	// Save template changes
	if (deckNameTemplateInput) {
		deckNameTemplateInput.addEventListener("input", handleTemplateInput);
	}

	/**
	 * Handles clicking the capture/export button by injecting content scripts into the active tab.
	 *
	 * @returns {Promise<void>}
	 */
	const handleCaptureClick = async () => {
		statusEl.textContent = "🤖 Robot initializing...";
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});

			await chrome.scripting.executeScript({
				target: { tabId: tab.id, allFrames: true },
				files: ["content.js"],
			});
		} catch (e) {
			statusEl.textContent = `Error: ${e.message}`;
		}
	};

	if (btn) {
		btn.addEventListener("click", handleCaptureClick);
	}

	/**
	 * Toggles debug logging on and off in chrome.storage.local and refreshes the popup UI.
	 *
	 * @returns {Promise<void>}
	 */
	const handleToggleDebugClick = async () => {
		try {
			const res = await chrome.storage.local.get({
				enableDebugLogging: true,
			});
			const newValue = !res.enableDebugLogging;
			await chrome.storage.local.set({ enableDebugLogging: newValue });
			updateDebugUi(newValue);
		} catch (err) {
			console.error("Failed to toggle debug logging:", err);
		}
	};

	if (toggleDebugBtn) {
		toggleDebugBtn.addEventListener("click", handleToggleDebugClick);
	}

	/**
	 * Updates the debug configuration UI display state.
	 *
	 * @param {boolean} isEnabled - True if debug logging is currently enabled.
	 * @returns {void}
	 */
	function updateDebugUi(isEnabled) {
		if (isEnabled) {
			debugStatusEl.textContent = "Enabled";
			debugStatusEl.className = "status-enabled";
			toggleDebugBtn.textContent = "Disable Debug Logging";
			toggleDebugBtn.className = "btn-dark";
		} else {
			debugStatusEl.textContent = "Disabled";
			debugStatusEl.className = "status-disabled";
			toggleDebugBtn.textContent = "Enable Debug Logging";
			toggleDebugBtn.className = "";
		}
	}
});

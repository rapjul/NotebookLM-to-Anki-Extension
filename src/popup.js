document.addEventListener("DOMContentLoaded", () => {
	const btn = document.getElementById("sendToAnki");
	const statusEl = document.getElementById("status");
	const debugStatusEl = document.getElementById("debug-status");
	const toggleDebugBtn = document.getElementById("toggleDebug");
	const deckNameTemplateInput = document.getElementById(
		"quizDeckNameTemplate",
	);

	// Load the stored state
	chrome.storage.local.get(
		{
			enableDebugLogging: true,
			quizDeckNameTemplate:
				"NotebookLM::{notebookName}::Quizzes::{quizName}",
		},
		(res) => {
			updateDebugUi(res.enableDebugLogging);
			if (deckNameTemplateInput) {
				deckNameTemplateInput.value = res.quizDeckNameTemplate;
			}
		},
	);

	// Save template changes
	if (deckNameTemplateInput) {
		deckNameTemplateInput.addEventListener("input", (e) => {
			chrome.storage.local.set({ quizDeckNameTemplate: e.target.value });
		});
	}

	btn.addEventListener("click", async () => {
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
	});

	toggleDebugBtn.addEventListener("click", () => {
		chrome.storage.local.get({ enableDebugLogging: true }, (res) => {
			const newValue = !res.enableDebugLogging;
			chrome.storage.local.set({ enableDebugLogging: newValue }, () => {
				updateDebugUi(newValue);
			});
		});
	});

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

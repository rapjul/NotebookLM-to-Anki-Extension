#!/usr/bin/env node
/**
 * @fileoverview Synchronizes local card templates (Front, Back, and Styles)
 * to the NotebookLM Quiz card type in Anki via the AnkiConnect API.
 *
 * Safely preserves external, non-addon code (such as AJT Japanese pitch accent/furigana
 * scripts or custom user CSS imports) using standardized boundary delimiter comments.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";

import "../src/utils.js";

const ankiUtils =
	typeof NotebookLMToAnkiUtils !== "undefined"
		? NotebookLMToAnkiUtils
		: globalThis.NotebookLMToAnkiUtils;

/**
 * Standard boundary delimiter constants and regular expressions for templates and stylesheets.
 *
 * Encapsulates canonical delimiters, legacy compatibility regular expressions, and
 * fallback boundary heuristics used to separate NotebookLM code from third-party add-ons.
 *
 * @type {{
 *   HTML: {
 *     START_PATTERN: RegExp,
 *     END_PATTERN: RegExp,
 *     CANONICAL_START: string,
 *     CANONICAL_END: string,
 *     FALLBACK_SCRIPT_PATTERN: RegExp
 *   },
 *   CSS: {
 *     START_PATTERN: RegExp,
 *     END_PATTERN: RegExp,
 *     CANONICAL_START: string,
 *     CANONICAL_END: string,
 *     FALLBACK_HEADER_PATTERN: RegExp
 *   }
 * }}
 */
export const TEMPLATE_DELIMITERS = {
	/**
	 * Delimiters and boundary patterns for Front and Back HTML card templates.
	 */
	HTML: {
		/**
		 * Matches canonical and legacy starting boundary comments in HTML templates.
		 * @type {RegExp}
		 */
		START_PATTERN:
			/<!--\s*(?:--------------------\s*)?NotebookLM Template: Start(?:\s*--------------------)?\s*-->|<!--\s*NOTEBOOKLM_TEMPLATE_START\s*-->/i,
		/**
		 * Matches canonical and legacy ending boundary comments in HTML templates.
		 * @type {RegExp}
		 */
		END_PATTERN:
			/<!--\s*(?:--------------------\s*)?NotebookLM Template: End(?:\s*--------------------)?\s*-->|<!--\s*NOTEBOOKLM_TEMPLATE_END\s*-->/i,
		/**
		 * Canonical starting HTML boundary delimiter injected around template content.
		 * @type {string}
		 */
		CANONICAL_START:
			"<!-- -------------------- NotebookLM Template: Start -------------------- -->",
		/**
		 * Canonical ending HTML boundary delimiter injected around template content.
		 * @type {string}
		 */
		CANONICAL_END:
			"<!-- -------------------- NotebookLM Template: End -------------------- -->",
		/**
		 * Fallback pattern for locating the end of addon HTML scripts in unmigrated templates.
		 * @type {RegExp}
		 */
		FALLBACK_SCRIPT_PATTERN: /\)\s*;\s*\n?\s*<\/script>/i,
	},
	/**
	 * Delimiters and boundary patterns for card styling stylesheets (CSS).
	 */
	CSS: {
		/**
		 * Matches canonical and legacy starting boundary comments in CSS stylesheets.
		 * @type {RegExp}
		 */
		START_PATTERN:
			/\/\*\s*(?:--------------------\s*)?NotebookLM Template: Start(?:\s*--------------------)?\s*\*\/|\/\*\s*NOTEBOOKLM_STYLING_START\s*\*\//i,
		/**
		 * Matches canonical and legacy ending boundary comments in CSS stylesheets.
		 * @type {RegExp}
		 */
		END_PATTERN:
			/\/\*\s*(?:--------------------\s*)?NotebookLM Template: End(?:\s*--------------------)?\s*\*\/|\/\*\s*NOTEBOOKLM_STYLING_END\s*\*\//i,
		/**
		 * Canonical starting CSS boundary delimiter injected around stylesheet content.
		 * @type {string}
		 */
		CANONICAL_START:
			"/* -------------------- NotebookLM Template: Start -------------------- */",
		/**
		 * Canonical ending CSS boundary delimiter injected around stylesheet content.
		 * @type {string}
		 */
		CANONICAL_END:
			"/* -------------------- NotebookLM Template: End -------------------- */",
		/**
		 * Fallback pattern for locating the start of the NotebookLM stylesheet in unmigrated CSS.
		 * @type {RegExp}
		 */
		FALLBACK_HEADER_PATTERN:
			/\/\*\s*NotebookLM to Anki\s*-\s*Card Styling/i,
	},
};

/**
 * Spawns the desktop Anki application process according to the current operating system.
 *
 * @param {string} currentPlatform - Node.js process platform identifier ('darwin', 'win32', etc.).
 * @returns {void}
 */
function spawnPlatformAnki(currentPlatform) {
	if (currentPlatform === "darwin") {
		const child = spawn("open", ["-a", "Anki"], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return;
	}
	if (currentPlatform === "win32") {
		const child = spawn("cmd.exe", ["/c", "start", "anki"], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return;
	}
	const child = spawn("anki", [], { detached: true, stdio: "ignore" });
	child.unref();
}

/**
 * Asynchronously pauses execution for a given duration.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>} Resolves after the specified duration.
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prompts the user interactively via readline interface.
 *
 * @param {string} promptText - Prompt question to display.
 * @returns {Promise<string>} The user input string.
 */
async function promptUser(promptText) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		return await rl.question(promptText);
	} finally {
		rl.close();
	}
}

/**
 * Reads the Front, Back, and Styling templates from the local repository directory.
 *
 * @param {string} repoRoot - Base path of the repository workspace.
 * @returns {{ frontHtml: string, backHtml: string, stylingCss: string }} The local template contents.
 * @throws {Error} If any of the required template files are missing.
 */
export function readLocalTemplates(repoRoot) {
	const tmplDir = path.join(repoRoot, "src", "anki_templates");
	const frontPath = path.join(tmplDir, "front.html");
	const backPath = path.join(tmplDir, "back.html");
	const cssPath = path.join(tmplDir, "styling.css");

	if (!fs.existsSync(frontPath)) {
		throw new Error(`Missing Front template at ${frontPath}`);
	}
	if (!fs.existsSync(backPath)) {
		throw new Error(`Missing Back template at ${backPath}`);
	}
	if (!fs.existsSync(cssPath)) {
		throw new Error(`Missing Styling template at ${cssPath}`);
	}

	return {
		frontHtml: fs.readFileSync(frontPath, "utf-8"),
		backHtml: fs.readFileSync(backPath, "utf-8"),
		stylingCss: fs.readFileSync(cssPath, "utf-8"),
	};
}

/**
 * Strips outer NotebookLM boundary comments from an HTML template string.
 *
 * @param {string} content - HTML template string.
 * @returns {string} Clean content without outer boundary comments.
 */
export function stripHtmlMarkers(content) {
	const startMatch = TEMPLATE_DELIMITERS.HTML.START_PATTERN.exec(content);
	const endMatch = TEMPLATE_DELIMITERS.HTML.END_PATTERN.exec(content);

	const startIdx = startMatch ? startMatch.index + startMatch[0].length : 0;
	const endIdx = endMatch ? endMatch.index : content.length;

	return content.slice(startIdx, endIdx).replace(/^[\r\n]+|[\r\n]+$/g, "");
}

/**
 * Strips outer NotebookLM boundary comments from a CSS stylesheet string.
 *
 * @param {string} content - CSS stylesheet string.
 * @returns {string} Clean content without outer boundary comments.
 */
export function stripCssMarkers(content) {
	const startMatch = TEMPLATE_DELIMITERS.CSS.START_PATTERN.exec(content);
	const endMatch = TEMPLATE_DELIMITERS.CSS.END_PATTERN.exec(content);

	const startIdx = startMatch ? startMatch.index + startMatch[0].length : 0;
	const endIdx = endMatch ? endMatch.index : content.length;

	return content.slice(startIdx, endIdx).replace(/^[\r\n]+|[\r\n]+$/g, "");
}

/**
 * Identifies prefix and suffix boundaries in existing HTML card templates.
 *
 * @param {string} liveContent - Existing HTML template content from Anki.
 * @returns {{ prefix: string, suffix: string }} Extracted prefix and suffix blocks.
 */
function extractHtmlBoundaries(liveContent) {
	const startMatch = TEMPLATE_DELIMITERS.HTML.START_PATTERN.exec(liveContent);
	const endMatch = TEMPLATE_DELIMITERS.HTML.END_PATTERN.exec(liveContent);

	if (startMatch && endMatch && startMatch.index < endMatch.index) {
		return {
			prefix: liveContent.slice(0, startMatch.index),
			suffix: liveContent.slice(endMatch.index + endMatch[0].length),
		};
	}

	const fallbackMatch =
		TEMPLATE_DELIMITERS.HTML.FALLBACK_SCRIPT_PATTERN.exec(liveContent);
	if (fallbackMatch) {
		const splitIdx = fallbackMatch.index + fallbackMatch[0].length;
		return {
			prefix: "",
			suffix: liveContent.slice(splitIdx),
		};
	}

	return { prefix: "", suffix: "" };
}

/**
 * Splices local HTML into live HTML, preserving any non-addon prefix or suffix code.
 *
 * @param {string} liveContent - Current live HTML template content from Anki.
 * @param {string} localContent - Updated local HTML template content from repository.
 * @returns {{ merged: string, prefix: string, suffix: string }} Spliced template and preserved code blocks.
 */
export function spliceHtmlTemplate(liveContent, localContent) {
	const { prefix, suffix } = extractHtmlBoundaries(liveContent);
	const cleanLocal = stripHtmlMarkers(localContent);

	const parts = [];
	if (prefix) {
		parts.push(prefix.replace(/[\r\n]+$/, ""));
		parts.push("");
	}
	parts.push(TEMPLATE_DELIMITERS.HTML.CANONICAL_START);
	parts.push(cleanLocal);
	parts.push(TEMPLATE_DELIMITERS.HTML.CANONICAL_END);
	if (suffix) {
		parts.push("");
		parts.push(suffix.replace(/^[\r\n]+/, ""));
	}

	return {
		merged: parts.join("\n"),
		prefix,
		suffix,
	};
}

/**
 * Identifies prefix and suffix boundaries in existing CSS stylesheets.
 *
 * @param {string} liveContent - Existing CSS stylesheet content from Anki.
 * @returns {{ prefix: string, suffix: string }} Extracted prefix and suffix blocks.
 */
function extractCssBoundaries(liveContent) {
	const startMatch = TEMPLATE_DELIMITERS.CSS.START_PATTERN.exec(liveContent);
	const endMatch = TEMPLATE_DELIMITERS.CSS.END_PATTERN.exec(liveContent);

	if (startMatch && endMatch && startMatch.index < endMatch.index) {
		return {
			prefix: liveContent.slice(0, startMatch.index),
			suffix: liveContent.slice(endMatch.index + endMatch[0].length),
		};
	}

	const headerMatch =
		TEMPLATE_DELIMITERS.CSS.FALLBACK_HEADER_PATTERN.exec(liveContent);
	if (headerMatch) {
		return {
			prefix: liveContent.slice(0, headerMatch.index),
			suffix: "",
		};
	}

	return { prefix: "", suffix: "" };
}

/**
 * Splices local CSS into live CSS, preserving any non-addon prefix or suffix rules.
 *
 * @param {string} liveContent - Current live CSS stylesheet content from Anki.
 * @param {string} localContent - Updated local CSS stylesheet content from repository.
 * @returns {{ merged: string, prefix: string, suffix: string }} Spliced stylesheet and preserved code blocks.
 */
export function spliceCssStylesheet(liveContent, localContent) {
	const { prefix, suffix } = extractCssBoundaries(liveContent);
	const cleanLocal = stripCssMarkers(localContent);

	const parts = [];
	if (prefix) {
		parts.push(prefix.replace(/[\r\n]+$/, ""));
		parts.push("");
	}
	parts.push(TEMPLATE_DELIMITERS.CSS.CANONICAL_START);
	parts.push(cleanLocal);
	parts.push(TEMPLATE_DELIMITERS.CSS.CANONICAL_END);
	if (suffix) {
		parts.push("");
		parts.push(suffix.replace(/^[\r\n]+/, ""));
	}

	return {
		merged: parts.join("\n"),
		prefix,
		suffix,
	};
}

/**
 * Formats a Date object into a YYYYMMDD_HHMMSS timestamp string.
 *
 * @param {Date} date - Date instance to format.
 * @returns {string} Timestamp string.
 */
function formatTimestamp(date) {
	const pad = (num) => String(num).padStart(2, "0");
	const yyyy = date.getFullYear();
	const mm = pad(date.getMonth() + 1);
	const dd = pad(date.getDate());
	const hh = pad(date.getHours());
	const min = pad(date.getMinutes());
	const ss = pad(date.getSeconds());
	return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

/**
 * Saves a timestamped backup of the current live Anki templates and stylesheet.
 *
 * @param {string} backupDir - Root directory for storing backups.
 * @param {string} modelName - Name of the Anki model being backed up.
 * @param {Record<string, any>} templates - Raw dictionary from modelTemplates API.
 * @param {Record<string, any>} styling - Raw dictionary from modelStyling API.
 * @param {function(): Date} [nowFn] - Optional date provider for testing.
 * @returns {string} Path to the created timestamped backup directory.
 */
export function createBackup(
	backupDir,
	modelName,
	templates,
	styling,
	nowFn = () => new Date(),
) {
	const timestamp = formatTimestamp(nowFn());
	const safeModel = modelName.replace(/[^\w-]/g, "_");
	const targetDir = path.join(backupDir, `${safeModel}_${timestamp}`);
	fs.mkdirSync(targetDir, { recursive: true });

	for (const [cardName, cardData] of Object.entries(templates)) {
		const safeCard = cardName.replace(/[^\w-]/g, "_");
		if (cardData && typeof cardData === "object") {
			if (typeof cardData.Front === "string") {
				fs.writeFileSync(
					path.join(targetDir, `${safeCard}_front.html`),
					cardData.Front,
					"utf-8",
				);
			}
			if (typeof cardData.Back === "string") {
				fs.writeFileSync(
					path.join(targetDir, `${safeCard}_back.html`),
					cardData.Back,
					"utf-8",
				);
			}
		}
	}

	if (styling && typeof styling.css === "string") {
		fs.writeFileSync(
			path.join(targetDir, "styling.css"),
			styling.css,
			"utf-8",
		);
	}

	const meta = {
		model_name: modelName,
		timestamp,
		templates,
		styling,
	};
	fs.writeFileSync(
		path.join(targetDir, "metadata.json"),
		JSON.stringify(meta, null, 2),
		"utf-8",
	);

	return targetDir;
}

/**
 * Builds an LCS matrix comparing two string arrays.
 *
 * @param {Array<string>} a - Old array of lines.
 * @param {Array<string>} b - New array of lines.
 * @returns {Array<Uint32Array>} Distance matrix.
 */
function buildLcsMatrix(a, b) {
	const m = a.length;
	const n = b.length;
	const matrix = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

	for (let i = 0; i < m; i++) {
		for (let j = 0; j < n; j++) {
			if (a[i] === b[j]) {
				matrix[i + 1][j + 1] = matrix[i][j] + 1;
			} else {
				matrix[i + 1][j + 1] = Math.max(
					matrix[i + 1][j],
					matrix[i][j + 1],
				);
			}
		}
	}
	return matrix;
}

/**
 * Backtracks through the LCS matrix to build an array of edit operations.
 *
 * @param {Array<Uint32Array>} matrix - Populated LCS matrix.
 * @param {Array<string>} a - Old lines array.
 * @param {Array<string>} b - New lines array.
 * @returns {Array<{ type: "common" | "add" | "del", line: string, oldIdx: number, newIdx: number }>} Edit operations.
 */
function backtrackLcs(matrix, a, b) {
	let i = a.length;
	let j = b.length;
	const edits = [];

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			edits.push({
				type: "common",
				line: a[i - 1],
				oldIdx: i,
				newIdx: j,
			});
			i--;
			j--;
		} else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
			edits.push({
				type: "add",
				line: b[j - 1],
				oldIdx: i,
				newIdx: j,
			});
			j--;
		} else {
			edits.push({
				type: "del",
				line: a[i - 1],
				oldIdx: i,
				newIdx: j,
			});
			i--;
		}
	}

	return edits.reverse();
}

/**
 * Computes unified diff lines comparing two text strings.
 *
 * @param {string} oldText - Original text content.
 * @param {string} newText - Modified text content.
 * @param {string} [oldFile="a"] - Display label for original file.
 * @param {string} [newFile="b"] - Display label for modified file.
 * @param {number} [context=3] - Number of surrounding context lines.
 * @returns {Array<string>} Array of unified diff lines.
 */
export function computeUnifiedDiff(
	oldText,
	newText,
	oldFile = "a",
	newFile = "b",
	context = 3,
) {
	if (oldText === newText) return [];

	const a = oldText.split(/\r?\n/);
	const b = newText.split(/\r?\n/);
	const edits = backtrackLcs(buildLcsMatrix(a, b), a, b);

	const diffLines = [`--- ${oldFile}`, `+++ ${newFile}`];
	let currentHunk = [];
	let lastDiffIdx = -1;

	for (let idx = 0; idx < edits.length; idx++) {
		const edit = edits[idx];
		const isDiff = edit.type !== "common";

		if (isDiff) {
			if (currentHunk.length === 0) {
				const start = Math.max(0, idx - context);
				for (let k = start; k < idx; k++) currentHunk.push(edits[k]);
			}
			currentHunk.push(edit);
			lastDiffIdx = idx;
		} else if (currentHunk.length > 0) {
			if (idx - lastDiffIdx <= context) {
				currentHunk.push(edit);
			} else {
				appendHunk(diffLines, currentHunk);
				currentHunk = [];
			}
		}
	}

	if (currentHunk.length > 0) {
		appendHunk(diffLines, currentHunk);
	}

	return diffLines;
}

/**
 * Appends a unified diff hunk block to output lines.
 *
 * @param {Array<string>} out - Target lines array.
 * @param {Array<{ type: string, line: string, oldIdx: number, newIdx: number }>} hunk - Hunk edits array.
 * @returns {void}
 */
function appendHunk(out, hunk) {
	const oldStart = hunk[0].oldIdx || 1;
	const newStart = hunk[0].newIdx || 1;
	const oldCount = hunk.filter((e) => e.type !== "add").length;
	const newCount = hunk.filter((e) => e.type !== "del").length;

	out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
	for (const e of hunk) {
		const prefix = e.type === "add" ? "+" : e.type === "del" ? "-" : " ";
		out.push(`${prefix}${e.line}`);
	}
}

/**
 * Wraps a unified diff line in ANSI color sequences according to its prefix.
 *
 * @param {string} line - Raw unified diff line.
 * @param {boolean} isTTY - Whether color formatting should be applied.
 * @returns {string} Formatted colored line.
 */
function colorizeDiffLine(line, isTTY) {
	if (!isTTY) return line;
	if (
		line.startsWith("+++") ||
		line.startsWith("---") ||
		line.startsWith("@@")
	) {
		return `\x1b[36m${line}\x1b[0m`;
	}
	if (line.startsWith("+")) {
		return `\x1b[32m${line}\x1b[0m`;
	}
	if (line.startsWith("-")) {
		return `\x1b[31m${line}\x1b[0m`;
	}
	return line;
}

/**
 * Formats unified diff lines with ANSI colors according to TTY capabilities.
 *
 * @param {string} label - Comparison descriptor.
 * @param {string} oldText - Original text.
 * @param {string} newText - Proposed text.
 * @param {boolean} [isTTY=process.stdout.isTTY] - Whether color output is enabled.
 * @returns {Array<string>} Formatted colored lines.
 */
export function formatColoredDiff(
	label,
	oldText,
	newText,
	isTTY = Boolean(process.stdout.isTTY),
) {
	const diffLines = computeUnifiedDiff(
		oldText,
		newText,
		`Live Anki (${label})`,
		`Proposed Update (${label})`,
	);

	if (diffLines.length === 0) {
		return [`  ✅ ${label}: In sync (no changes).`];
	}

	const divider = "─".repeat(50);
	const header = isTTY
		? `\x1b[1;36m📋 [Diff] ${label}\x1b[0m\n${divider}`
		: `📋 [Diff] ${label}\n${divider}`;

	return [
		`\n${header}`,
		...diffLines.map((line) => colorizeDiffLine(line, isTTY)),
		`${divider}\n`,
	];
}

/**
 * Computes and prints a unified diff between two text strings with terminal coloring.
 *
 * @param {string} label - Descriptive label for the comparison.
 * @param {string} oldText - Original text string.
 * @param {string} newText - Modified text string.
 * @returns {boolean} True if differences were found; False if identical.
 */
export function printColoredDiff(label, oldText, newText) {
	const lines = formatColoredDiff(label, oldText, newText);
	for (const line of lines) {
		console.log(line);
	}
	return oldText !== newText;
}

/**
 * Formats a detailed, actionable message explaining how to resolve Anki's editor conflict.
 *
 * @returns {string} Formatted multi-line advisory string.
 */
export function formatEditorConflictMessage() {
	return (
		"❌ Cannot update templates: Anki has an active editor window open.\n\n" +
		"⚠️  Anki blocks template updates whenever any secondary window with an editor is open.\n" +
		"👉 Please close all secondary windows (leave only the main Anki window open):\n" +
		'   • Browse window ("Browse" card search)\n' +
		'   • Add window ("Add" new notes)\n' +
		"   • Edit Current window (card editor)\n" +
		"   • Cards... / Card Types dialog (template editor)\n\n" +
		"💡 Rule of thumb: Close all Anki windows except the single main window (Decks or Study screen)."
	);
}

/**
 * Prompts the user to retry after closing Anki editor windows.
 *
 * @param {function(string): Promise<string>} askInput - Prompt input function.
 * @param {Error} exc - The active error causing retry.
 * @returns {Promise<void>}
 * @throws {Error} If user cancels or prompt fails.
 */
async function promptForEditorRetry(askInput, exc) {
	try {
		const choice = (
			await askInput(
				"\nPress Enter once closed to retry (or 'q' to cancel): ",
			)
		)
			.trim()
			.toLowerCase();
		if (choice === "q" || choice === "quit") {
			console.error("🛑 Operation cancelled by user.");
			throw exc;
		}
		console.log("🔄 Retrying update in Anki...");
	} catch (inputErr) {
		if (inputErr === exc) throw exc;
		console.error("\n🛑 Operation cancelled.");
		throw exc;
	}
}

/**
 * Executes an AnkiConnect operation, retrying interactively if an editor conflict occurs.
 *
 * @param {string} actionName - Name of the action being attempted.
 * @param {function(): Promise<any> | any} operationFn - Callable executing the AnkiConnect API calls.
 * @param {boolean} [interactive=true] - If True and in TTY, prompts user to retry after closing windows.
 * @param {function(string): Promise<string>} [inputFn] - Input function for prompting user.
 * @returns {Promise<any>} The result of operationFn().
 * @throws {Error} If operationFn fails for reasons other than editorConflict, or if user cancels.
 */
export async function executeWithEditorRetry(
	actionName,
	operationFn,
	interactive = true,
	inputFn = null,
) {
	const askInput = inputFn || promptUser;

	while (true) {
		try {
			return await operationFn();
		} catch (exc) {
			const errText = String(exc.message || exc);
			const isEditorConflict = errText.includes(
				"Close the affected editor before this API write",
			);
			if (!isEditorConflict || !interactive) {
				if (isEditorConflict) {
					console.error(`\n${formatEditorConflictMessage()}`);
				}
				throw exc;
			}

			console.error(`\n${formatEditorConflictMessage()}`);
			await promptForEditorRetry(askInput, exc);
		}
	}
}

/**
 * Logs a concise summary of a preserved external code block.
 *
 * @param {string} label - Block descriptor.
 * @param {string} code - Preserved code string.
 * @returns {void}
 */
function reportExternalBlock(label, code) {
	const trimmed = code.trim();
	if (trimmed) {
		const firstLine = trimmed.split(/\r?\n/)[0].slice(0, 60);
		console.log(`  • ${label} detected: ${code.length} chars (${firstLine}...)`);
	} else {
		console.log(`  • ${label}: None`);
	}
}

/**
 * Evaluates whether proposed spliced templates differ from live Anki templates.
 *
 * @param {{ front: string, back: string, css: string }} spliced - Proposed spliced templates.
 * @param {{ front: string, back: string, css: string }} live - Current live templates.
 * @returns {boolean} True if any template content differs.
 */
function areTemplatesModified(spliced, live) {
	return (
		spliced.front !== live.front ||
		spliced.back !== live.back ||
		spliced.css !== live.css
	);
}

/**
 * Orchestrates card template inspection, diffing, and synchronization to Anki via AnkiConnect.
 *
 * Encapsulates model and card configuration, AnkiConnect endpoint transport, automatic backups,
 * external add-on code preservation, and interactive retry handling for editor conflicts.
 */
export class AnkiTemplateSynchronizer {
	/**
	 * Initializes a new template synchronizer instance.
	 *
	 * @param {{
	 *   ankiUrl?: string,
	 *   modelName?: string,
	 *   cardName?: string,
	 *   repoRoot?: string,
	 *   backupDir?: string,
	 *   dryRun?: boolean,
	 *   autoLaunch?: boolean,
	 *   interactive?: boolean,
	 *   skipBackup?: boolean,
	 *   fetchFn?: typeof fetch,
	 *   spawnFn?: function(string): void,
	 *   sleepFn?: function(number): Promise<void>,
	 *   promptFn?: function(string): Promise<string>
	 * }} [options={}] - Configuration options and injectable dependencies.
	 */
	constructor(options = {}) {
		this.ankiUrl = options.ankiUrl || ankiUtils.DEFAULT_ANKI_CONNECT_URL;
		this.modelName = options.modelName || "NotebookLM Quiz";
		this.cardName = options.cardName || "NotebookLM Quiz";
		this.repoRoot =
			options.repoRoot ||
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
		this.backupDir = options.backupDir || "./backups/templates";
		this.dryRun = Boolean(options.dryRun);
		this.autoLaunch = Boolean(options.autoLaunch);
		this.interactive = options.interactive !== false;
		this.skipBackup = Boolean(options.skipBackup);
		this.fetchFn = options.fetchFn || globalThis.fetch;
		this.spawnFn = options.spawnFn || spawnPlatformAnki;
		this.sleepFn = options.sleepFn || sleep;
		this.promptFn = options.promptFn || promptUser;
	}

	/**
	 * Dispatches an AnkiConnect action using the configured endpoint and transport.
	 *
	 * @param {string} action - The AnkiConnect action name.
	 * @param {Record<string, any>} [params] - Optional parameters object.
	 * @param {number} [timeoutMs=5000] - Socket timeout in milliseconds.
	 * @returns {Promise<any>} The unwrapped result from AnkiConnect.
	 */
	async query(action, params, timeoutMs = 5000) {
		return ankiUtils.queryAnkiConnect(action, params, {
			ankiUrl: this.ankiUrl,
			timeoutMs,
			fetchFn: this.fetchFn,
		});
	}

	/**
	 * Verifies whether the AnkiConnect HTTP service is reachable and responsive.
	 *
	 * @param {number} [timeoutMs=1500] - Socket timeout in milliseconds.
	 * @returns {Promise<boolean>} True if AnkiConnect responded with version information; False otherwise.
	 */
	async checkOnline(timeoutMs = 1500) {
		try {
			const ver = await this.query("version", undefined, timeoutMs);
			return typeof ver === "number";
		} catch {
			return false;
		}
	}

	/**
	 * Spawns the desktop Anki application process and waits for AnkiConnect to respond.
	 *
	 * @param {number} [maxWaitSeconds=20] - Maximum time in seconds to wait.
	 * @param {string} [platform] - Target platform identifier ('darwin', 'win32', etc.).
	 * @returns {Promise<boolean>} True if AnkiConnect becomes available within timeout; False otherwise.
	 */
	async launchApp(maxWaitSeconds = 20, platform = process.platform) {
		console.log("🚀 Launching Anki desktop application...");
		try {
			this.spawnFn(platform);
		} catch (exc) {
			console.error(`❌ Failed to launch Anki automatically: ${exc.message}`);
			return false;
		}

		process.stdout.write("⏳ Waiting for AnkiConnect to initialize...");
		const startTime = Date.now();
		const maxWaitMs = maxWaitSeconds * 1000;

		while (Date.now() - startTime < maxWaitMs) {
			await this.sleepFn(1000);
			process.stdout.write(".");
			const online = await this.checkOnline(1000);
			if (online) {
				console.log(" Connected!");
				return true;
			}
		}

		console.error("\n❌ Timed out waiting for AnkiConnect to respond.");
		return false;
	}

	/**
	 * Ensures that AnkiConnect is accessible, prompting to launch Anki if running interactively.
	 *
	 * @returns {Promise<boolean>} True if connection is confirmed; False otherwise.
	 */
	async ensureConnection() {
		const isOnline = await this.checkOnline();
		if (isOnline) return true;

		console.log(`⚠️  AnkiConnect is unreachable at ${this.ankiUrl}.`);
		if (this.autoLaunch) {
			return this.launchApp();
		}

		if (process.stdin.isTTY && this.interactive) {
			try {
				const choice = (
					await this.promptFn(
						"Anki does not appear to be running. Would you like to launch Anki now? [y/N]: ",
					)
				)
					.trim()
					.toLowerCase();
				if (choice === "y" || choice === "yes") {
					return this.launchApp();
				}
			} catch {
				return false;
			}
		}
		return false;
	}

	/**
	 * Creates a timestamped raw backup snapshot of live card templates and styles.
	 *
	 * @param {Record<string, any>} templates - Live card templates dictionary.
	 * @param {Record<string, any>} styling - Live model styling object.
	 * @param {function(): Date} [nowFn] - Optional date provider for testing.
	 * @returns {string} The created backup directory path.
	 */
	createBackup(templates, styling, nowFn = () => new Date()) {
		return createBackup(
			this.backupDir,
			this.modelName,
			templates,
			styling,
			nowFn,
		);
	}

	/**
	 * Executes an AnkiConnect operation, retrying interactively if an editor conflict occurs.
	 *
	 * @param {string} actionName - Name of the action being attempted.
	 * @param {function(): Promise<any> | any} operationFn - Callable executing the AnkiConnect API calls.
	 * @returns {Promise<any>} The result of operationFn().
	 * @throws {Error} If operationFn fails for reasons other than editorConflict, or if user cancels.
	 */
	async executeWithEditorRetry(actionName, operationFn) {
		return executeWithEditorRetry(
			actionName,
			operationFn,
			this.interactive,
			this.promptFn,
		);
	}

	/**
	 * Displays connection status, model statistics, and detected external code blocks.
	 *
	 * @returns {Promise<void>}
	 */
	async status() {
		console.log(`🔍 Checking AnkiConnect at ${this.ankiUrl}...`);
		const models = await this.query("modelNames");
		if (!Array.isArray(models) || !models.includes(this.modelName)) {
			console.log(`❌ Model '${this.modelName}' was not found in Anki.`);
			return;
		}

		const cards = await this.query("findCards", {
			query: `note:"${this.modelName}"`,
		});
		console.log(
			`✅ Model '${this.modelName}' found. Total cards: ${cards.length}`,
		);

		const templates = await this.query("modelTemplates", {
			modelName: this.modelName,
		});
		const styling = await this.query("modelStyling", {
			modelName: this.modelName,
		});

		const cardTmpl = templates[this.cardName] || {};
		const liveFront = cardTmpl.Front || "";
		const liveBack = cardTmpl.Back || "";
		const liveCss = styling.css || "";

		console.log("\n📋 Delimiter Status:");
		console.log(
			`  • Front Template: ${TEMPLATE_DELIMITERS.HTML.START_PATTERN.test(liveFront) ? "✅ Present" : "⚠️ Missing (Will migrate on push)"}`,
		);
		console.log(
			`  • Back Template:  ${TEMPLATE_DELIMITERS.HTML.START_PATTERN.test(liveBack) ? "✅ Present" : "⚠️ Missing (Will migrate on push)"}`,
		);
		console.log(
			`  • Stylesheet:     ${TEMPLATE_DELIMITERS.CSS.START_PATTERN.test(liveCss) ? "✅ Present" : "⚠️ Missing (Will migrate on push)"}`,
		);

		const { frontHtml, backHtml, stylingCss } = readLocalTemplates(
			this.repoRoot,
		);
		const { suffix: fSuff } = spliceHtmlTemplate(liveFront, frontHtml);
		const { suffix: bSuff } = spliceHtmlTemplate(liveBack, backHtml);
		const { prefix: cPref } = spliceCssStylesheet(liveCss, stylingCss);

		console.log("\n🛡️ Preserved External Code:");
		reportExternalBlock("Front Suffix", fSuff);
		reportExternalBlock("Back Suffix", bSuff);
		reportExternalBlock("CSS Prefix", cPref);
	}

	/**
	 * Shows a unified diff between current Anki templates and proposed updates.
	 *
	 * @returns {Promise<boolean>} True if differences exist; False if already in sync.
	 */
	async diff() {
		const templates = await this.query("modelTemplates", {
			modelName: this.modelName,
		});
		const styling = await this.query("modelStyling", {
			modelName: this.modelName,
		});

		const cardTmpl = templates[this.cardName] || {};
		const liveFront = cardTmpl.Front || "";
		const liveBack = cardTmpl.Back || "";
		const liveCss = styling.css || "";

		const { frontHtml, backHtml, stylingCss } = readLocalTemplates(
			this.repoRoot,
		);

		const { merged: splicedFront } = spliceHtmlTemplate(liveFront, frontHtml);
		const { merged: splicedBack } = spliceHtmlTemplate(liveBack, backHtml);
		const { merged: splicedCss } = spliceCssStylesheet(liveCss, stylingCss);

		const diff1 = printColoredDiff(
			`${this.cardName} Front`,
			liveFront,
			splicedFront,
		);
		const diff2 = printColoredDiff(
			`${this.cardName} Back`,
			liveBack,
			splicedBack,
		);
		const diff3 = printColoredDiff(
			`${this.modelName} Styles`,
			liveCss,
			splicedCss,
		);

		return diff1 || diff2 || diff3;
	}

	/**
	 * Dispatches template and styling updates to AnkiConnect.
	 *
	 * @param {string} splicedFront - Spliced Front template HTML.
	 * @param {string} splicedBack - Spliced Back template HTML.
	 * @param {string} splicedCss - Spliced styling CSS.
	 * @returns {Promise<void>}
	 */
	async dispatchTemplatePush(splicedFront, splicedBack, splicedCss) {
		console.log(`🚀 Updating card templates for '${this.modelName}'...`);
		await this.query("updateModelTemplates", {
			model: {
				name: this.modelName,
				templates: {
					[this.cardName]: {
						Front: splicedFront,
						Back: splicedBack,
					},
				},
			},
		});

		console.log("🚀 Updating stylesheet...");
		await this.query("updateModelStyling", {
			model: {
				name: this.modelName,
				css: splicedCss,
			},
		});
	}

	/**
	 * Synchronizes repository templates to Anki with automated backup and boundary preservation.
	 *
	 * @returns {Promise<void>}
	 */
	async push() {
		const templates = await this.query("modelTemplates", {
			modelName: this.modelName,
		});
		const styling = await this.query("modelStyling", {
			modelName: this.modelName,
		});

		if (!templates[this.cardName]) {
			throw new Error(
				`Card template '${this.cardName}' not found in model '${this.modelName}'. Available: ${Object.keys(templates).join(", ")}`,
			);
		}

		const cardTmpl = templates[this.cardName];
		const live = {
			front: cardTmpl.Front || "",
			back: cardTmpl.Back || "",
			css: styling.css || "",
		};

		const local = readLocalTemplates(this.repoRoot);
		const spliced = {
			front: spliceHtmlTemplate(live.front, local.frontHtml).merged,
			back: spliceHtmlTemplate(live.back, local.backHtml).merged,
			css: spliceCssStylesheet(live.css, local.stylingCss).merged,
		};

		if (!areTemplatesModified(spliced, live)) {
			console.log(
				"✅ Anki templates and styling are already up-to-date. No changes necessary.",
			);
			return;
		}

		if (this.dryRun) {
			console.log("🔍 Dry-run enabled. Inspecting proposed updates:");
			await this.diff();
			console.log("\n✨ Dry-run completed. No updates were sent to Anki.");
			return;
		}

		if (!this.skipBackup) {
			const savedPath = this.createBackup(templates, styling);
			console.log(`📦 Created live backup at: ${savedPath}`);
		}

		await this.executeWithEditorRetry("push", () =>
			this.dispatchTemplatePush(
				spliced.front,
				spliced.back,
				spliced.css,
			),
		);

		console.log(
			"🎉 Successfully updated NotebookLM card templates and styles in Anki!",
		);
	}

	/**
	 * Pulls the addon portion of card templates from Anki back into the repository.
	 *
	 * @returns {Promise<void>}
	 */
	async pull() {
		const templates = await this.query("modelTemplates", {
			modelName: this.modelName,
		});
		const styling = await this.query("modelStyling", {
			modelName: this.modelName,
		});

		const cardTmpl = templates[this.cardName] || {};
		const liveFront = cardTmpl.Front || "";
		const liveBack = cardTmpl.Back || "";
		const liveCss = styling.css || "";

		const cleanFront = stripHtmlMarkers(liveFront);
		const cleanBack = stripHtmlMarkers(liveBack);
		const cleanCss = stripCssMarkers(liveCss);

		const tmplDir = path.join(this.repoRoot, "src", "anki_templates");
		fs.writeFileSync(
			path.join(tmplDir, "front.html"),
			`${TEMPLATE_DELIMITERS.HTML.CANONICAL_START}\n${cleanFront}\n${TEMPLATE_DELIMITERS.HTML.CANONICAL_END}\n`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(tmplDir, "back.html"),
			`${TEMPLATE_DELIMITERS.HTML.CANONICAL_START}\n${cleanBack}\n${TEMPLATE_DELIMITERS.HTML.CANONICAL_END}\n`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(tmplDir, "styling.css"),
			`${TEMPLATE_DELIMITERS.CSS.CANONICAL_START}\n${cleanCss}\n${TEMPLATE_DELIMITERS.CSS.CANONICAL_END}\n`,
			"utf-8",
		);

		console.log(
			"📥 Successfully pulled and synchronized templates from Anki to repository.",
		);
	}
}

/**
 * Formats the CLI usage reference and options list.
 *
 * @returns {string} Formatted CLI help text.
 */
export function formatHelp() {
	return (
		"Usage: node ./scripts/update-card-templates.js <action> [options]\n\n" +
		"Synchronize NotebookLM card templates to Anki with external code preservation.\n\n" +
		"Actions:\n" +
		"  status     Inspect AnkiConnect connection, card counts, and delimiter presence\n" +
		"  diff       Show colored unified diff between Anki collection and local templates\n" +
		"  push       Synchronize local templates to Anki with automatic live backup\n" +
		"  pull       Extract template code from Anki back into local files\n\n" +
		"Options:\n" +
		'  -n, --dry-run      Preview proposed changes without updating Anki (default: false)\n' +
		'      --auto-launch  Automatically start Anki Desktop if unreachable (default: false)\n' +
		'      --no-prompt    Disable interactive confirmation and retry prompts (default: false)\n' +
		'      --no-backup    Skip automatic backup snapshot creation before push (default: false)\n' +
		'      --model-name   Target Anki model name (default: "NotebookLM Quiz")\n' +
		'      --card-name    Target card template name (default: "NotebookLM Quiz")\n' +
		'      --anki-url     AnkiConnect endpoint (default: "http://127.0.0.1:8765")\n' +
		'      --backup-dir   Backup directory path (default: "./backups/templates")\n' +
		"  -h, --help         Show this help message\n"
	);
}

/**
 * Parses command-line arguments into structured options.
 *
 * @param {Array<string>} [argv] - Argument vector (defaults to process.argv.slice(2)).
 * @returns {{ action: string | null, modelName: string, cardName: string, ankiUrl: string, backupDir: string, noBackup: boolean, dryRun: boolean, autoLaunch: boolean, noPrompt: boolean, help: boolean }} Parsed CLI options.
 */
export function parseArgs(argv = process.argv.slice(2)) {
	const { values, positionals } = nodeParseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			"model-name": { type: "string", default: "NotebookLM Quiz" },
			"card-name": { type: "string", default: "NotebookLM Quiz" },
			"anki-url": {
				type: "string",
				default: ankiUtils.DEFAULT_ANKI_CONNECT_URL,
			},
			"backup-dir": { type: "string", default: "./backups/templates" },
			"no-backup": { type: "boolean", default: false },
			"dry-run": { type: "boolean", short: "n", default: false },
			"auto-launch": { type: "boolean", default: false },
			"no-prompt": { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
	});

	const validActions = new Set(["push", "diff", "status", "pull"]);
	const actionArg = positionals[0] || null;
	const action = actionArg && validActions.has(actionArg) ? actionArg : null;

	return {
		action,
		modelName: values["model-name"],
		cardName: values["card-name"],
		ankiUrl: values["anki-url"],
		backupDir: values["backup-dir"],
		noBackup: Boolean(values["no-backup"]),
		dryRun: Boolean(values["dry-run"]),
		autoLaunch: Boolean(values["auto-launch"]),
		noPrompt: Boolean(values["no-prompt"]),
		help: Boolean(values.help),
	};
}

/**
 * Main command execution entry point.
 *
 * @param {Array<string>} [argv] - Command line arguments.
 * @returns {Promise<number>} Process exit code (0 for success, 1 for failure).
 */
export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help || !args.action) {
		console.log(formatHelp());
		return 0;
	}

	const repoRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);

	const isInteractive = process.stdin.isTTY && !args.noPrompt;

	const synchronizer = new AnkiTemplateSynchronizer({
		...args,
		repoRoot,
		interactive: isInteractive,
		skipBackup: args.noBackup,
	});

	const connected = await synchronizer.ensureConnection();
	if (!connected) {
		console.error("❌ Cannot proceed without active AnkiConnect connection.");
		return 1;
	}

	try {
		await synchronizer[args.action]();
		return 0;
	} catch (exc) {
		const errText = String(exc.message || exc);
		if (!errText.includes("Close the affected editor before this API write")) {
			console.error(`❌ Error executing '${args.action}': ${errText}`);
		}
		return 1;
	}
}

// Auto-run if executed directly as a script
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().then((code) => {
		if (code !== 0) process.exit(code);
	});
}

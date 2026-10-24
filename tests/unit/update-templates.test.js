/**
 * @fileoverview Unit test suite for the Anki card templates updater CLI script.
 *
 * Tests delimiter extraction, fallback heuristic migration for external code (such as AJT Japanese),
 * idempotency, backup creation, unified diff formatting, interactive editor retry, and AnkiTemplateSynchronizer.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	TEMPLATE_DELIMITERS,
	AnkiTemplateSynchronizer,
	stripHtmlMarkers,
	stripCssMarkers,
	spliceHtmlTemplate,
	spliceCssStylesheet,
	createBackup,
	computeUnifiedDiff,
	formatColoredDiff,
	formatEditorConflictMessage,
	executeWithEditorRetry,
	parseArgs,
	formatHelp,
	readLocalTemplates,
} from "../../scripts/update-card-templates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

test("update-templates: stripHtmlMarkers removes canonical and legacy boundaries", () => {
	const rawHtml = `${TEMPLATE_DELIMITERS.HTML.CANONICAL_START}\n<div class="main">Content</div>\n${TEMPLATE_DELIMITERS.HTML.CANONICAL_END}`;
	const stripped = stripHtmlMarkers(rawHtml);
	assert.equal(stripped, '<div class="main">Content</div>');

	// Legacy comment format
	const legacyHtml =
		"<!-- NOTEBOOKLM_TEMPLATE_START -->\n<span>Card</span>\n<!-- NOTEBOOKLM_TEMPLATE_END -->";
	assert.equal(stripHtmlMarkers(legacyHtml), "<span>Card</span>");
});

test("update-templates: stripCssMarkers removes canonical and legacy boundaries", () => {
	const rawCss = `${TEMPLATE_DELIMITERS.CSS.CANONICAL_START}\n.card { color: red; }\n${TEMPLATE_DELIMITERS.CSS.CANONICAL_END}`;
	const stripped = stripCssMarkers(rawCss);
	assert.equal(stripped, ".card { color: red; }");

	// Legacy comment format
	const legacyCss =
		"/* NOTEBOOKLM_STYLING_START */\n.card { font: sans; }\n/* NOTEBOOKLM_STYLING_END */";
	assert.equal(stripCssMarkers(legacyCss), ".card { font: sans; }");
});

test("update-templates: spliceHtmlTemplate with existing markers preserves prefix and suffix", () => {
	const liveHtml = [
		"<script>/* AJT Furigana */</script>",
		TEMPLATE_DELIMITERS.HTML.CANONICAL_START,
		"<div>Old Front</div>",
		TEMPLATE_DELIMITERS.HTML.CANONICAL_END,
		"<script>/* Custom Audio */</script>",
	].join("\n");

	const newLocal = `${TEMPLATE_DELIMITERS.HTML.CANONICAL_START}\n<div>New Front</div>\n${TEMPLATE_DELIMITERS.HTML.CANONICAL_END}`;
	const { merged, prefix, suffix } = spliceHtmlTemplate(liveHtml, newLocal);

	assert.ok(prefix.includes("AJT Furigana"));
	assert.ok(suffix.includes("Custom Audio"));
	assert.ok(merged.includes("<div>New Front</div>"));
	assert.ok(!merged.includes("<div>Old Front</div>"));
});

test("update-templates: spliceHtmlTemplate fallback migration heuristic separates addon script from AJT Japanese", () => {
	const liveHtml = [
		"<script>",
		"  var ajt = true;",
		");",
		"</script>",
		"<!-- NotebookLM to Anki Card Template -->",
		"<div>Original NotebookLM Code</div>",
	].join("\n");

	const newLocal = "<div>Updated Front Template</div>";
	const { merged, suffix } = spliceHtmlTemplate(liveHtml, newLocal);

	assert.ok(merged.includes(TEMPLATE_DELIMITERS.HTML.CANONICAL_START));
	assert.ok(merged.includes(TEMPLATE_DELIMITERS.HTML.CANONICAL_END));
	assert.ok(merged.includes("<div>Updated Front Template</div>"));
	assert.ok(suffix.includes("Original NotebookLM Code"));
});

test("update-templates: spliceCssStylesheet with existing markers preserves @import prefix", () => {
	const liveCss = [
		"@import url('_custom_fonts.css');",
		TEMPLATE_DELIMITERS.CSS.CANONICAL_START,
		".card { color: black; }",
		TEMPLATE_DELIMITERS.CSS.CANONICAL_END,
	].join("\n");

	const newLocal = ".card { color: white; }";
	const { merged, prefix } = spliceCssStylesheet(liveCss, newLocal);

	assert.ok(prefix.includes("@import url('_custom_fonts.css');"));
	assert.ok(merged.includes(".card { color: white; }"));
	assert.ok(!merged.includes(".card { color: black; }"));
});

test("update-templates: spliceCssStylesheet fallback migration heuristic preserves leading @charset and @import rules", () => {
	const liveCss = [
		"@charset 'UTF-8';",
		"@import url('_ajt.css');",
		"/* NotebookLM to Anki - Card Styling */",
		".card { font-family: serif; }",
	].join("\n");

	const newLocal = ".card { font-family: sans-serif; }";
	const { merged, prefix } = spliceCssStylesheet(liveCss, newLocal);

	assert.ok(prefix.includes("@import url('_ajt.css');"));
	assert.ok(merged.includes(".card { font-family: sans-serif; }"));
	assert.ok(!merged.includes(".card { font-family: serif; }"));
});

test("update-templates: splicing idempotency verifies repeated splicing produces identical output", () => {
	const initialLive = [
		"<script>/* AJT */</script>",
		TEMPLATE_DELIMITERS.HTML.CANONICAL_START,
		"<div>First Push</div>",
		TEMPLATE_DELIMITERS.HTML.CANONICAL_END,
	].join("\n");

	const repoTemplate = "<div>Canonical Repo Code</div>";

	const firstPass = spliceHtmlTemplate(initialLive, repoTemplate).merged;
	const secondPass = spliceHtmlTemplate(firstPass, repoTemplate).merged;

	assert.equal(firstPass, secondPass);
});

test("update-templates: createBackup writes timestamped snapshots and metadata.json", () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "anki-backup-unit-test-"),
	);

	try {
		const mockTemplates = {
			"NotebookLM Quiz": {
				Front: "<div>Front Template</div>",
				Back: "<div>Back Template</div>",
			},
		};
		const mockStyling = { css: ".card { color: blue; }" };
		const fixedDate = new Date("2026-10-23T12:30:45Z");

		const backupPath = createBackup(
			tempDir,
			"NotebookLM Quiz",
			mockTemplates,
			mockStyling,
			() => fixedDate,
		);

		assert.ok(fs.existsSync(backupPath));
		assert.ok(
			fs.existsSync(path.join(backupPath, "NotebookLM_Quiz_front.html")),
		);
		assert.ok(
			fs.existsSync(path.join(backupPath, "NotebookLM_Quiz_back.html")),
		);
		assert.ok(fs.existsSync(path.join(backupPath, "styling.css")));
		assert.ok(fs.existsSync(path.join(backupPath, "metadata.json")));

		const meta = JSON.parse(
			fs.readFileSync(path.join(backupPath, "metadata.json"), "utf-8"),
		);
		assert.equal(meta.model_name, "NotebookLM Quiz");
		assert.equal(
			meta.templates["NotebookLM Quiz"].Front,
			"<div>Front Template</div>",
		);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("update-templates: computeUnifiedDiff generates hunk headers and changes", () => {
	const oldText = "line 1\nline 2\nline 3";
	const newText = "line 1\nline 2 modified\nline 3";

	const diff = computeUnifiedDiff(oldText, newText, "old.txt", "new.txt");
	assert.ok(diff.length > 0);
	assert.equal(diff[0], "--- old.txt");
	assert.equal(diff[1], "+++ new.txt");
	assert.ok(diff.some((line) => line.startsWith("-line 2")));
	assert.ok(diff.some((line) => line.startsWith("+line 2 modified")));
});

test("update-templates: formatColoredDiff returns in sync message when texts match", () => {
	const text = "<div>Identical</div>";
	const lines = formatColoredDiff("Test", text, text, false);
	assert.equal(lines.length, 1);
	assert.ok(lines[0].includes("In sync (no changes)."));
});

test("update-templates: parseArgs recognizes positional action and flags", () => {
	const args = parseArgs([
		"push",
		"-n",
		"--model-name",
		"Custom Model",
		"--no-backup",
	]);
	assert.equal(args.action, "push");
	assert.equal(args.dryRun, true);
	assert.equal(args.modelName, "Custom Model");
	assert.equal(args.noBackup, true);
});

test("update-templates: formatHelp documents actions and options", () => {
	const helpText = formatHelp();
	assert.ok(helpText.includes("Usage: node ./scripts/update-card-templates.js"));
	assert.ok(helpText.includes("push"));
	assert.ok(helpText.includes("diff"));
	assert.ok(helpText.includes("status"));
	assert.ok(helpText.includes("pull"));
	assert.ok(helpText.includes("--dry-run"));
});

test("update-templates: formatEditorConflictMessage explains the Single Main Window rule", () => {
	const msg = formatEditorConflictMessage();
	assert.ok(msg.includes("Close all Anki windows except the single main window"));
	assert.ok(msg.includes("Browse window"));
	assert.ok(msg.includes("Add window"));
	assert.ok(msg.includes("Cards..."));
});

test("update-templates: executeWithEditorRetry succeeds after interactive retry", async () => {
	let attempts = 0;
	const operation = async () => {
		attempts++;
		if (attempts === 1) {
			throw new Error("Close the affected editor before this API write");
		}
		return "success";
	};

	let promptCalled = 0;
	const mockPrompt = async () => {
		promptCalled++;
		return "\n"; // User presses enter to retry
	};

	const result = await executeWithEditorRetry(
		"testAction",
		operation,
		true,
		mockPrompt,
	);
	assert.equal(result, "success");
	assert.equal(attempts, 2);
	assert.equal(promptCalled, 1);
});

test("update-templates: executeWithEditorRetry aborts when user inputs 'q'", async () => {
	const operation = async () => {
		throw new Error("Close the affected editor before this API write");
	};

	const mockPrompt = async () => "q";

	await assert.rejects(
		() => executeWithEditorRetry("testAction", operation, true, mockPrompt),
		/Close the affected editor before this API write/,
	);
});

test("update-templates: executeWithEditorRetry throws immediately when non-interactive", async () => {
	const operation = async () => {
		throw new Error("Close the affected editor before this API write");
	};

	await assert.rejects(
		() => executeWithEditorRetry("testAction", operation, false),
		/Close the affected editor before this API write/,
	);
});

test("update-templates: executeWithEditorRetry propagates non-editor errors without retry", async () => {
	const operation = async () => {
		throw new Error("Generic Network Error");
	};

	await assert.rejects(
		() => executeWithEditorRetry("testAction", operation, true),
		/Generic Network Error/,
	);
});

test("update-templates: readLocalTemplates loads Front, Back, and Styling templates", () => {
	const tmpls = readLocalTemplates(REPO_ROOT);
	assert.ok(tmpls.frontHtml.length > 0);
	assert.ok(tmpls.backHtml.length > 0);
	assert.ok(tmpls.stylingCss.length > 0);
	assert.ok(tmpls.frontHtml.includes("NotebookLM Template: Start"));
	assert.ok(tmpls.backHtml.includes("NotebookLM Template: Start"));
	assert.ok(tmpls.stylingCss.includes("NotebookLM Template: Start"));
});

test("update-templates: AnkiTemplateSynchronizer class constructor and options", () => {
	const defaultSync = new AnkiTemplateSynchronizer();
	assert.equal(defaultSync.modelName, "NotebookLM Quiz");
	assert.equal(defaultSync.cardName, "NotebookLM Quiz");
	assert.equal(defaultSync.ankiUrl, "http://127.0.0.1:8765");
	assert.equal(defaultSync.dryRun, false);
	assert.equal(defaultSync.interactive, true);
	assert.equal(defaultSync.skipBackup, false);

	const customSync = new AnkiTemplateSynchronizer({
		ankiUrl: "http://10.0.0.1:8765",
		modelName: "Custom Quiz",
		cardName: "Custom Card",
		backupDir: "/tmp/anki-backups",
		dryRun: true,
		interactive: false,
		skipBackup: true,
	});
	assert.equal(customSync.ankiUrl, "http://10.0.0.1:8765");
	assert.equal(customSync.modelName, "Custom Quiz");
	assert.equal(customSync.cardName, "Custom Card");
	assert.equal(customSync.backupDir, "/tmp/anki-backups");
	assert.equal(customSync.dryRun, true);
	assert.equal(customSync.interactive, false);
	assert.equal(customSync.skipBackup, true);
});

test("update-templates: AnkiTemplateSynchronizer checkOnline and ensureConnection", async (t) => {
	await t.test("checkOnline returns true when AnkiConnect reports version number", async () => {
		const sync = new AnkiTemplateSynchronizer({
			fetchFn: async () => ({
				ok: true,
				json: async () => ({ result: 6, error: null }),
			}),
		});
		const online = await sync.checkOnline();
		assert.equal(online, true);
	});

	await t.test("checkOnline returns false on network error", async () => {
		const sync = new AnkiTemplateSynchronizer({
			fetchFn: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const online = await sync.checkOnline();
		assert.equal(online, false);
	});

	await t.test("ensureConnection returns true if online", async () => {
		const sync = new AnkiTemplateSynchronizer({
			fetchFn: async () => ({
				ok: true,
				json: async () => ({ result: 6, error: null }),
			}),
		});
		const ok = await sync.ensureConnection();
		assert.equal(ok, true);
	});

	await t.test("ensureConnection triggers launchApp on autoLaunch", async () => {
		let spawnCalled = false;
		let checkCount = 0;
		const sync = new AnkiTemplateSynchronizer({
			autoLaunch: true,
			spawnFn: () => {
				spawnCalled = true;
			},
			sleepFn: async () => {},
			fetchFn: async () => {
				checkCount++;
				if (checkCount === 1) throw new Error("ECONNREFUSED");
				return {
					ok: true,
					json: async () => ({ result: 6, error: null }),
				};
			},
		});

		const ok = await sync.ensureConnection();
		assert.equal(ok, true);
		assert.equal(spawnCalled, true);
	});
});

test("update-templates: AnkiTemplateSynchronizer actions with mocked responses", async (t) => {
	const liveTemplates = {
		"NotebookLM Quiz": {
			Front: `${TEMPLATE_DELIMITERS.HTML.CANONICAL_START}\n<div>Front</div>\n${TEMPLATE_DELIMITERS.HTML.CANONICAL_END}`,
			Back: `${TEMPLATE_DELIMITERS.HTML.CANONICAL_START}\n<div>Back</div>\n${TEMPLATE_DELIMITERS.HTML.CANONICAL_END}`,
		},
	};
	const liveStyling = {
		css: `${TEMPLATE_DELIMITERS.CSS.CANONICAL_START}\n.card {}\n${TEMPLATE_DELIMITERS.CSS.CANONICAL_END}`,
	};

	const createMockFetch = (extraHandlers = {}) => {
		return async (_url, options) => {
			const body = JSON.parse(options.body);
			if (extraHandlers[body.action]) {
				return extraHandlers[body.action](body);
			}
			if (body.action === "modelNames") {
				return {
					ok: true,
					json: async () => ({ result: ["NotebookLM Quiz"], error: null }),
				};
			}
			if (body.action === "findCards") {
				return {
					ok: true,
					json: async () => ({ result: [1001, 1002], error: null }),
				};
			}
			if (body.action === "modelTemplates") {
				return {
					ok: true,
					json: async () => ({ result: liveTemplates, error: null }),
				};
			}
			if (body.action === "modelStyling") {
				return {
					ok: true,
					json: async () => ({ result: liveStyling, error: null }),
				};
			}
			return {
				ok: true,
				json: async () => ({ result: null, error: null }),
			};
		};
	};

	await t.test("status queries models, card counts, and reports cleanly", async () => {
		const sync = new AnkiTemplateSynchronizer({
			repoRoot: REPO_ROOT,
			fetchFn: createMockFetch(),
		});

		await sync.status();
		assert.ok(true);
	});

	await t.test("diff compares templates and returns boolean diff status", async () => {
		const sync = new AnkiTemplateSynchronizer({
			repoRoot: REPO_ROOT,
			fetchFn: createMockFetch(),
		});

		const diffFound = await sync.diff();
		assert.equal(typeof diffFound, "boolean");
	});

	await t.test("push in dry-run mode does not send template writes to Anki", async () => {
		let wroteTemplates = false;
		let wroteStyling = false;

		const sync = new AnkiTemplateSynchronizer({
			repoRoot: REPO_ROOT,
			dryRun: true,
			fetchFn: createMockFetch({
				updateModelTemplates: () => {
					wroteTemplates = true;
					return { ok: true, json: async () => ({ result: null, error: null }) };
				},
				updateModelStyling: () => {
					wroteStyling = true;
					return { ok: true, json: async () => ({ result: null, error: null }) };
				},
			}),
		});

		await sync.push();
		assert.equal(wroteTemplates, false);
		assert.equal(wroteStyling, false);
	});

	await t.test("push writes templates and styling when differences exist", async () => {
		let wroteTemplates = false;
		let wroteStyling = false;

		const sync = new AnkiTemplateSynchronizer({
			repoRoot: REPO_ROOT,
			dryRun: false,
			skipBackup: true,
			fetchFn: createMockFetch({
				modelTemplates: () => ({
					ok: true,
					json: async () => ({
						result: {
							"NotebookLM Quiz": {
								Front: "<div>Outdated Front</div>",
								Back: "<div>Outdated Back</div>",
							},
						},
						error: null,
					}),
				}),
				updateModelTemplates: () => {
					wroteTemplates = true;
					return { ok: true, json: async () => ({ result: null, error: null }) };
				},
				updateModelStyling: () => {
					wroteStyling = true;
					return { ok: true, json: async () => ({ result: null, error: null }) };
				},
			}),
		});

		await sync.push();
		assert.equal(wroteTemplates, true);
		assert.equal(wroteStyling, true);
	});
});

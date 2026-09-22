/**
 * @fileoverview Dedicated extension linter script for NotebookLM to Anki Web Extension.
 * Stages the source files with Firefox MV3 manifest adaptations (background event pages)
 * and executes Mozilla's web-ext lint to validate the extension with zero warnings.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import webExt from "web-ext";

/**
 * Root directory of the repository.
 * @type {string}
 */
const ROOT_DIR = process.cwd();

/**
 * Extension source directory.
 * @type {string}
 */
const SRC_DIR = path.join(ROOT_DIR, "src");

/**
 * Staging directory used for Firefox manifest lint validation.
 * @type {string}
 */
const FIREFOX_LINT_DIR = path.join(ROOT_DIR, "dist", ".firefox-lint");

/**
 * Unique extension ID for Mozilla Add-on Developer Hub (AMO).
 * @type {string}
 */
const GECKO_ADDON_ID = "notebooklm-to-anki@rapjul.github.io";

/**
 * Main linter execution handler that stages Firefox configuration and runs web-ext lint.
 *
 * @returns {Promise<void>} Resolves when linting completes successfully.
 * @throws {Error} If lint validation encounters errors.
 */
async function runLint() {
	console.log("🔍 Staging extension for Firefox MV3 validation...");

	// Clean and populate temporary staging directory
	fs.rmSync(FIREFOX_LINT_DIR, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(FIREFOX_LINT_DIR), { recursive: true });
	fs.cpSync(SRC_DIR, FIREFOX_LINT_DIR, { recursive: true });

	// Adapt manifest for Firefox MV3 requirements (event pages instead of service workers)
	const stagingManifestPath = path.join(FIREFOX_LINT_DIR, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(stagingManifestPath, "utf-8"));

	manifest.browser_specific_settings = {
		gecko: {
			id: GECKO_ADDON_ID,
			data_collection_permissions: {
				required: ["none"],
			},
		},
	};

	manifest.background = {
		scripts: ["background.js"],
	};

	fs.writeFileSync(
		stagingManifestPath,
		JSON.stringify(manifest, null, 2) + "\n",
		"utf-8",
	);

	try {
		console.log("🦊 Running web-ext lint on staged Firefox manifest...\n");
		const lintResult = await webExt.cmd.lint(
			{
				sourceDir: FIREFOX_LINT_DIR,
				ignoreFiles: ["anki_templates/**", "anki_templates/*"],
				warningsAsErrors: true,
			},
			{ shouldExitProgram: false },
		);

		if (lintResult.summary.errors > 0 || lintResult.summary.warnings > 0) {
			throw new Error(
				`Extension validation failed with ${lintResult.summary.errors} error(s) and ${lintResult.summary.warnings} warning(s).`,
			);
		}
	} finally {
		// Clean up staging directory
		fs.rmSync(FIREFOX_LINT_DIR, { recursive: true, force: true });
	}
}

runLint().catch((err) => {
	console.error("\n❌ Linting failed:", err.message);
	process.exit(1);
});

/**
 * @fileoverview Automated multi-browser build script for NotebookLM to Anki Web Extension.
 * Packages distinct production release archives for Chrome/Edge (Chromium MV3)
 * and Firefox (Gecko MV3 with manifest adaptations).
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
 * Output artifacts directory.
 * @type {string}
 */
const DIST_DIR = path.join(ROOT_DIR, "dist");

/**
 * Temporary staging directory used when preparing Firefox manifest transformations.
 * @type {string}
 */
const FIREFOX_STAGING_DIR = path.join(DIST_DIR, ".firefox-build");

/**
 * Standard files and patterns ignored during packaging.
 * Excludes documentation, system metadata, editor artifacts, and version control files.
 * @type {Array<string>}
 */
const IGNORED_FILES = [
	"*.md",
	".DS_Store",
	"**/.DS_Store",
	"Thumbs.db",
	"**/Thumbs.db",
	"*.bak",
	"*~",
	"*.swp",
	"*.tmp",
	"**/.git*",
	".vscode/**",
	"**/.vscode/**",
];

/**
 * Unique extension ID for Mozilla Add-on Developer Hub (AMO).
 * @type {string}
 */
const GECKO_ADDON_ID = "notebooklm-to-anki@rapjul.github.io";

/**
 * Reads and parses the base manifest.json file from the source directory.
 * @returns {Record<string, any>} Parsed manifest JSON object.
 */
function getSourceManifest() {
	const manifestPath = path.join(SRC_DIR, "manifest.json");
	return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

/**
 * Packages the standard Chromium extension archive for Chrome, Microsoft Edge, Brave, and Opera.
 * @param {string} version - Semantic version string of the extension.
 * @returns {Promise<string>} Path to the created ZIP archive.
 */
async function buildChrome(version) {
	const filename = `notebooklm-to-anki-v${version}-chrome.zip`;
	console.log(`\n📦 Building Chrome/Edge distribution: ${filename}...`);

	const result = await webExt.cmd.build(
		{
			sourceDir: SRC_DIR,
			artifactsDir: DIST_DIR,
			filename: filename,
			overwriteDest: true,
			ignoreFiles: IGNORED_FILES,
		},
		{ shouldExitProgram: false },
	);

	// Also create a legacy-compatible copy matching standard web-ext naming
	const legacyFilename = `notebooklm_to_anki-${version}.zip`;
	fs.copyFileSync(
		path.join(DIST_DIR, filename),
		path.join(DIST_DIR, legacyFilename),
	);

	return result.extensionPath;
}

/**
 * Packages the Firefox extension archive with Gecko-specific manifest settings.
 * @param {string} version - Semantic version string of the extension.
 * @returns {Promise<string>} Path to the created ZIP archive.
 */
async function buildFirefox(version) {
	const filename = `notebooklm-to-anki-v${version}-firefox.zip`;
	console.log(`\n🦊 Building Firefox distribution: ${filename}...`);

	// Ensure staging directory is clean
	fs.rmSync(FIREFOX_STAGING_DIR, { recursive: true, force: true });
	fs.cpSync(SRC_DIR, FIREFOX_STAGING_DIR, { recursive: true });

	// Read and adapt manifest for Firefox MV3 requirements
	const stagingManifestPath = path.join(FIREFOX_STAGING_DIR, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(stagingManifestPath, "utf-8"));

	manifest.browser_specific_settings = {
		gecko: {
			id: GECKO_ADDON_ID,
			data_collection_permissions: {
				required: ["none"],
			},
		},
	};

	// Firefox MV3 requires background.scripts for event page support
	manifest.background = {
		scripts: ["background.js"],
	};

	fs.writeFileSync(
		stagingManifestPath,
		JSON.stringify(manifest, null, 2) + "\n",
		"utf-8",
	);

	// Lint staged extension against Firefox validation rules.
	// Note: anki_templates are Anki card templates with embedded script evaluation logic,
	// not browser extension UI pages subject to Extension CSP.
	console.log("   Validating Firefox extension with web-ext lint...");
	const lintResult = await webExt.cmd.lint(
		{
			sourceDir: FIREFOX_STAGING_DIR,
			ignoreFiles: ["anki_templates/**", "anki_templates/*"],
			warningsAsErrors: false,
		},
		{ shouldExitProgram: false },
	);

	if (lintResult.summary.errors > 0) {
		fs.rmSync(FIREFOX_STAGING_DIR, { recursive: true, force: true });
		throw new Error(
			`Firefox extension validation failed with ${lintResult.summary.errors} error(s).`,
		);
	}

	// Package the Firefox archive
	const buildResult = await webExt.cmd.build(
		{
			sourceDir: FIREFOX_STAGING_DIR,
			artifactsDir: DIST_DIR,
			filename: filename,
			overwriteDest: true,
			ignoreFiles: IGNORED_FILES,
		},
		{ shouldExitProgram: false },
	);

	// Clean up temporary staging directory
	fs.rmSync(FIREFOX_STAGING_DIR, { recursive: true, force: true });

	return buildResult.extensionPath;
}

/**
 * Formats file size in kilobytes for display.
 * @param {string} filePath - Absolute path to file.
 * @returns {string} Formatted size string (e.g. "47.2 KB").
 */
function getFileSizeKb(filePath) {
	const stats = fs.statSync(filePath);
	return `${(stats.size / 1024).toFixed(1)} KB`;
}

/**
 * Main execution handler parsing command line arguments and coordinating builds.
 * @returns {Promise<void>}
 */
async function main() {
	const args = process.argv.slice(2);
	const targetArg = args.find((a) => a.startsWith("--target="));
	const target = targetArg ? targetArg.split("=")[1].toLowerCase() : "all";

	const manifest = getSourceManifest();
	const version = manifest.version;
	if (!version) {
		throw new Error("Missing 'version' in src/manifest.json");
	}

	if (!fs.existsSync(DIST_DIR)) {
		fs.mkdirSync(DIST_DIR, { recursive: true });
	}

	console.log("==================================================");
	console.log(`🚀 NotebookLM to Anki — Release Builder (v${version})`);
	console.log(`🎯 Target: ${target.toUpperCase()}`);
	console.log("==================================================");

	const createdArtifacts = [];

	if (target === "all" || target === "chrome" || target === "chromium") {
		const chromePath = await buildChrome(version);
		createdArtifacts.push({
			browser: "Chrome / Edge (Chromium)",
			path: chromePath,
			file: path.basename(chromePath),
			size: getFileSizeKb(chromePath),
		});
	}

	if (target === "all" || target === "firefox" || target === "gecko") {
		const firefoxPath = await buildFirefox(version);
		createdArtifacts.push({
			browser: "Firefox (Gecko)",
			path: firefoxPath,
			file: path.basename(firefoxPath),
			size: getFileSizeKb(firefoxPath),
		});
	}

	console.log("\n==================================================");
	console.log("🎉 Build completed successfully!");
	console.log("📁 Generated Release Artifacts:");
	for (const artifact of createdArtifacts) {
		console.log(
			`   - ${artifact.browser.padEnd(26)}: dist/${artifact.file} (${artifact.size})`,
		);
	}
	console.log("==================================================");
}

main().catch((err) => {
	console.error("\n❌ Build failed:", err.message);
	process.exit(1);
});

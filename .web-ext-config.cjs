/**
 * web-ext configuration for the NotebookLM to Anki Web Extension.
 *
 * Defines packaging artifact output directories, source directory,
 * and destination overwrite rules.
 *
 * @module web-ext-config
 */
module.exports = {
	// Source directory containing extension runtime files
	sourceDir: "src",

	// Directory where packaged zip artifacts are stored
	artifactsDir: "dist",

	build: {
		// Overwrite only the destination archive matching the current version if it exists
		overwriteDest: true,
	},

	// Files and directories to exclude from packaging and linting.
	// Note: anki_templates are Anki card templates executed inside Anki Desktop,
	// not extension UI pages subject to browser CSP.
	ignoreFiles: [
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
		"anki_templates/**",
		"anki_templates/*",
	],
};

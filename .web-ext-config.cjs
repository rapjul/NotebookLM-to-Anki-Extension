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

  // Files to exclude from within the src/ directory
  ignoreFiles: ["*.md", ".DS_Store", "**/.DS_Store"],
};

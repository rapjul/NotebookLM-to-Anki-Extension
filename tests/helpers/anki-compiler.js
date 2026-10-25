/**
 * @fileoverview Pure template compiler simulating Anki's Mustache-style field replacements,
 * conditional blocks ({{#Field}}...{{/Field}} and {{^Field}}...{{/Field}}), and raw HTML injection.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, "../../src");

/**
 * Valid note field names defined in the 20-field adaptive schema.
 * @type {ReadonlySet<string>}
 */
export const VALID_SCHEMA_FIELDS = new Set([
	"Question",
	"Hint",
	"Image",
	"Option1",
	"Rationale1",
	"Flag1",
	"Option2",
	"Rationale2",
	"Flag2",
	"Option3",
	"Rationale3",
	"Flag3",
	"Option4",
	"Rationale4",
	"Flag4",
	"QuestionType",
	"TargetAnswer",
	"AcceptableAnswers",
	"Rubric",
	"GeneralRationale",
]);

/**
 * Compiles conditional sections ({{#Field}}...{{/Field}} and {{^Field}}...{{/Field}}).
 *
 * @param {string} template - Raw template containing conditional blocks.
 * @param {Record<string, string>} fields - Note field dictionary.
 * @returns {string} Template with conditional blocks resolved.
 */
function resolveConditionals(template, fields) {
	let output = template;

	// Resolve positive conditionals: {{#Field}}content{{/Field}}
	output = output.replace(
		/\{\{#([a-zA-Z0-9_-]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
		(_match, fieldName, innerContent) => {
			if (!VALID_SCHEMA_FIELDS.has(fieldName)) {
				throw new Error(`Unknown field in conditional block: {{#${fieldName}}}`);
			}
			const val = fields[fieldName];
			const hasValue = Boolean(val && String(val).trim().length > 0);
			return hasValue ? innerContent : "";
		},
	);

	// Resolve inverted conditionals: {{^Field}}content{{/Field}}
	output = output.replace(
		/\{\{\^([a-zA-Z0-9_-]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
		(_match, fieldName, innerContent) => {
			if (!VALID_SCHEMA_FIELDS.has(fieldName)) {
				throw new Error(`Unknown field in inverted conditional: {{^${fieldName}}}`);
			}
			const val = fields[fieldName];
			const isEmpty = !val || String(val).trim().length === 0;
			return isEmpty ? innerContent : "";
		},
	);

	return output;
}

/**
 * Replaces double-curly field placeholders with raw field values, rejecting unknown fields.
 *
 * @param {string} template - Template with conditionals already resolved.
 * @param {Record<string, string>} fields - Note field dictionary.
 * @returns {string} Compiled template string.
 */
function resolveFieldPlaceholders(template, fields) {
	return template.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_match, fieldName) => {
		if (!VALID_SCHEMA_FIELDS.has(fieldName)) {
			throw new Error(`Unknown field placeholder in template: {{${fieldName}}}`);
		}
		const val = fields[fieldName];
		return val !== undefined && val !== null ? String(val) : "";
	});
}

/**
 * Compiles an Anki template string with note field values.
 *
 * Simulates Anki's template engine: checks unknown fields, evaluates conditionals,
 * and performs raw field substitution without escaping HTML entities.
 *
 * @param {string} templateHtml - Raw template HTML markup.
 * @param {Record<string, string>} fields - Dictionary of note field values.
 * @returns {string} Fully compiled HTML markup.
 * @throws {Error} If an unknown field placeholder is encountered.
 */
export function compileTemplate(templateHtml, fields) {
	const withoutConditionals = resolveConditionals(templateHtml, fields);
	return resolveFieldPlaceholders(withoutConditionals, fields);
}

/**
 * Reads and compiles either the Front or Back card template from src/anki_templates.
 *
 * @param {"front" | "back"} side - Which template side to compile ("front" or "back").
 * @param {Record<string, string>} fields - Dictionary of note field values.
 * @returns {string} Compiled card side HTML.
 */
export function compileCardSide(side, fields) {
	const filename = side.toLowerCase() === "front" ? "front.html" : "back.html";
	const filePath = path.join(SRC_DIR, "anki_templates", filename);
	const rawHtml = fs.readFileSync(filePath, "utf-8");
	return compileTemplate(rawHtml, fields);
}

/**
 * Wraps compiled card HTML in Anki's canonical <div class="card"> container and stylesheet.
 *
 * @param {string} bodyHtml - Compiled card body markup.
 * @param {string} [customCss] - Optional custom CSS; defaults to src/anki_templates/styling.css.
 * @returns {string} Full HTML document string.
 */
export function wrapInCardDocument(bodyHtml, customCss) {
	let css = customCss;
	if (css === undefined) {
		const cssPath = path.join(SRC_DIR, "anki_templates", "styling.css");
		css = fs.readFileSync(cssPath, "utf-8");
	}

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${css}</style>
</head>
<body class="card">
  ${bodyHtml}
</body>
</html>`;
}

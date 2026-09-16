// tests/unit/templates.test.js - Unit tests for Anki templates and extension manifest integrity

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "../../src");

test("templates: front.html structure", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");

	// Verify required field replacements for 15-field schema
	const requiredFields = [
		"{{Question}}",
		"{{Hint}}",
		"{{Option1}}",
		"{{Option2}}",
		"{{Option3}}",
		"{{Option4}}",
		"{{Flag1}}",
		"{{Flag2}}",
		"{{Flag3}}",
		"{{Flag4}}",
	];

	for (const field of requiredFields) {
		assert.ok(
			frontHtml.includes(field),
			`front.html missing required Anki field placeholder: ${field}`,
		);
	}
});

test("templates: back.html structure", () => {
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");

	// Verify required field replacements for questions, options, rationales, and flags
	const requiredFields = [
		"{{Question}}",
		"{{Option1}}",
		"{{Option2}}",
		"{{Option3}}",
		"{{Option4}}",
		"{{Rationale1}}",
		"{{Rationale2}}",
		"{{Rationale3}}",
		"{{Rationale4}}",
		"{{Flag1}}",
		"{{Flag2}}",
		"{{Flag3}}",
		"{{Flag4}}",
	];

	for (const field of requiredFields) {
		assert.ok(
			backHtml.includes(field),
			`back.html missing required Anki field placeholder: ${field}`,
		);
	}
});

test("templates: styling.css rules", () => {
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	// Verify essential visual state classes exist
	const requiredSelectors = [
		".state-correct",
		".state-wrong",
		".state-dimmed",
		".card",
	];

	for (const selector of requiredSelectors) {
		assert.ok(
			cssContent.includes(selector),
			`styling.css missing required state selector: ${selector}`,
		);
	}
});

test("templates: manifest.json integrity", () => {
	const manifestPath = path.join(srcDir, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

	assert.equal(manifest.manifest_version, 3);
	assert.equal(manifest.name, "NotebookLM to Anki");
	assert.ok(manifest.version);

	// Verify background service worker is declared
	assert.equal(manifest.background?.service_worker, "background.js");

	// Verify content_scripts load utils.js before content.js
	assert.ok(Array.isArray(manifest.content_scripts));
	const contentScriptConfig = manifest.content_scripts[0];
	assert.deepEqual(contentScriptConfig.js, ["utils.js", "content.js"]);

	// Verify web accessible resources
	assert.ok(Array.isArray(manifest.web_accessible_resources));
	const webAccessible = manifest.web_accessible_resources[0];
	assert.ok(webAccessible.resources.includes("modal.html"));
	assert.ok(webAccessible.resources.includes("button.html"));
});

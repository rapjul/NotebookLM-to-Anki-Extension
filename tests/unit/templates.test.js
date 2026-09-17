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

	// Verify required field replacements for 20-field schema
	const requiredFields = [
		"{{Question}}",
		"{{Hint}}",
		"{{Image}}",
		"{{Option1}}",
		"{{Option2}}",
		"{{Option3}}",
		"{{Option4}}",
		"{{Flag1}}",
		"{{Flag2}}",
		"{{Flag3}}",
		"{{Flag4}}",
		"{{QuestionType}}",
		"{{TargetAnswer}}",
		"{{AcceptableAnswers}}",
		"{{Rubric}}",
		"{{GeneralRationale}}",
	];

	for (const field of requiredFields) {
		assert.ok(
			frontHtml.includes(field),
			`front.html missing required Anki field placeholder: ${field}`,
		);
	}

	assert.ok(
		frontHtml.includes('id="q-media"'),
		"front.html should include inline question media container",
	);
	assert.ok(
		frontHtml.includes('id="front-interactive-area"'),
		"front.html should include interactive area container",
	);
	assert.ok(
		frontHtml.includes("diagram-alt-description"),
		"front.html should include diagram-alt-description container logic",
	);
	assert.ok(
		!frontHtml.includes("ArchDiagram"),
		"front.html should not contain legacy ArchDiagram placeholder to prevent model validation errors",
	);
});

test("templates: back.html structure", () => {
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");

	// Verify required field replacements for questions, options, rationales, and flags
	const requiredFields = [
		"{{Question}}",
		"{{Image}}",
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
		"{{QuestionType}}",
		"{{TargetAnswer}}",
		"{{AcceptableAnswers}}",
		"{{Rubric}}",
		"{{GeneralRationale}}",
	];

	for (const field of requiredFields) {
		assert.ok(
			backHtml.includes(field),
			`back.html missing required Anki field placeholder: ${field}`,
		);
	}

	assert.ok(
		!backHtml.includes("ArchDiagram"),
		"back.html should not contain legacy ArchDiagram placeholder to prevent model validation errors",
	);

	// Verify multi-select adaptive feedback states
	assert.ok(
		backHtml.includes("Correct selection"),
		"back.html should include 'Correct selection' feedback label",
	);
	assert.ok(
		backHtml.includes("Missed correct option"),
		"back.html should include 'Missed correct option' feedback label",
	);
	assert.ok(
		backHtml.includes("Incorrect selection"),
		"back.html should include 'Incorrect selection' feedback label",
	);
	assert.ok(
		backHtml.includes("Incorrect option"),
		"back.html should include 'Incorrect option' feedback label",
	);

	assert.ok(
		backHtml.includes('id="back-q-media"'),
		"back.html should include inline question media container",
	);
	assert.ok(
		backHtml.includes('id="back-interactive-area"'),
		"back.html should include interactive area container",
	);
	assert.ok(
		backHtml.includes("diagram-alt-description"),
		"back.html should include diagram-alt-description container logic",
	);
});

test("templates: styling.css rules", () => {
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	// Verify essential visual state classes and multi-format component styles exist
	const requiredSelectors = [
		".state-correct",
		".state-wrong",
		".state-dimmed",
		".state-missed",
		".state-incorrect-unselected",
		".thats-missed",
		".thats-incorrect-unselected",
		".missed-badge",
		".card",
		".question-media",
		".score-pill",
		".fitb-input",
		".sa-scratchpad",
		".feedback-card",
		".rubric-checklist",
		".rubric-item",
		".rubric-checkbox",
		".sa-misconceptions",
		".diagram-alt-description",
		".diagram-alt-label",
	];

	for (const selector of requiredSelectors) {
		assert.ok(
			cssContent.includes(selector),
			`styling.css missing required state selector: ${selector}`,
		);
	}

	assert.ok(
		cssContent.includes("align-items: center;"),
		"styling.css .rubric-item should vertically center checkboxes and labels with align-items: center",
	);
});

test("templates: manifest.json integrity", () => {
	const manifestPath = path.join(srcDir, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

	assert.equal(manifest.manifest_version, 3);
	assert.equal(manifest.name, "NotebookLM to Anki");
	assert.ok(manifest.version);
	assert.ok(
		manifest.version_name,
		"manifest.json should declare version_name with build information",
	);
	assert.ok(
		manifest.version_name.startsWith(manifest.version),
		"manifest.json version_name should prefix with version number",
	);

	// Verify permissions include cookies and declarativeNetRequest
	assert.ok(manifest.permissions.includes("cookies"));
	assert.ok(manifest.permissions.includes("declarativeNetRequest"));

	// Verify background service worker is declared
	assert.equal(manifest.background?.service_worker, "background.js");

	// Verify host permissions include Google domains
	assert.ok(manifest.host_permissions.includes("https://lh3.google.com/*"));
	assert.ok(
		manifest.host_permissions.includes("https://*.googleusercontent.com/*"),
	);

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

test("templates: diagram image description toggle and mobile tap protection", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	// Verify front.html prevents flip on tapping image or description
	assert.ok(
		frontHtml.includes('.closest(".question-media img")'),
		"front.html interceptTap should protect .question-media img from triggering flip",
	);
	assert.ok(
		frontHtml.includes('.closest(".diagram-alt-description")'),
		"front.html interceptTap should protect .diagram-alt-description from triggering flip",
	);

	// Verify back.html prevents grading on tapping image or description
	assert.ok(
		backHtml.includes('.closest(".question-media img")'),
		"back.html intercept should protect .question-media img from triggering advance",
	);
	assert.ok(
		backHtml.includes('.closest(".diagram-alt-description")'),
		"back.html intercept should protect .diagram-alt-description from triggering advance",
	);

	// Verify accessibility attributes on images
	assert.ok(
		frontHtml.includes('imgEl.setAttribute("tabindex", "0")'),
		"front.html should set tabindex on diagram image for keyboard access",
	);
	assert.ok(
		frontHtml.includes('imgEl.setAttribute("role", "button")'),
		"front.html should set role='button' on diagram image",
	);
	assert.ok(
		backHtml.includes('imgEl.setAttribute("tabindex", "0")'),
		"back.html should set tabindex on diagram image for keyboard access",
	);
	assert.ok(
		backHtml.includes('imgEl.setAttribute("role", "button")'),
		"back.html should set role='button' on diagram image",
	);

	// Verify cursor and focus styling
	assert.ok(
		cssContent.includes("cursor: pointer;"),
		"styling.css should specify pointer cursor for clickable diagram images",
	);
	assert.ok(
		cssContent.includes(".question-media img:focus-visible"),
		"styling.css should specify focus-visible outline for keyboard navigation",
	);
});

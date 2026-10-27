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
	assert.ok(
		frontHtml.includes('class="status-icon hint-icon"'),
		"front.html should embed offline SVG hint icon",
	);
	assert.ok(
		!frontHtml.includes("fonts.googleapis.com"),
		"front.html should not load external fonts to guarantee offline functionality",
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
		".visually-hidden",
		".is-hidden",
		".template-loading",
		".hint-icon",
		".is-visible",
		".is-open",
		".status-icon-correct",
		".status-icon-wrong",
		".status-icon-skipped",
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

	// Verify zero !important usage across all rules in styling.css
	const importantMatches = cssContent.match(/!important/g) || [];
	assert.equal(
		importantMatches.length,
		0,
		`styling.css has ${importantMatches.length} '!important' declarations; expected 0`,
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

	// Verify background service worker is declared and Gecko scripts array is omitted
	assert.equal(manifest.background?.service_worker, "background.js");
	assert.equal(
		manifest.background?.scripts,
		undefined,
		"manifest.json should omit background.scripts to ensure Chromium MV3 compatibility",
	);

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

test("templates: diagram image accessibility and styling", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

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

test("templates: mobile multi-select and fill-in-the-blank styling rules", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	assert.ok(
		frontHtml.includes('enterkeyhint="done"'),
		"front.html fill-in-the-blank input should set enterkeyhint",
	);
	assert.ok(
		cssContent.includes("text-align: center;"),
		"styling.css submit-btn should be centered",
	);
	assert.ok(
		cssContent.includes(".ms-instruction-badge"),
		"styling.css should style multi-select instruction badge",
	);
	assert.ok(
		cssContent.includes(".ms-submit-btn.btn-disabled"),
		"styling.css should style disabled submit button",
	);
	assert.ok(
		cssContent.includes(".btn-shake"),
		"styling.css should define shake animation for invalid submit attempts",
	);
});

test("templates: fill-in-the-blank skipped state styling rules", () => {
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	assert.ok(
		cssContent.includes(".card-skipped {"),
		"styling.css should define .card-skipped",
	);
	assert.ok(
		cssContent.includes(".card-skipped .feedback-header {"),
		"styling.css should style .feedback-header within .card-skipped",
	);
	assert.ok(
		cssContent.includes(".btn-skipped {"),
		"styling.css should define .btn-skipped",
	);
});

test("templates: mobile viewport height and keyboard scroll reset", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	assert.ok(
		cssContent.includes("min-height: 0;"),
		"styling.css .card should use min-height: 0 to avoid extra vertical scrollable space on mobile",
	);
	assert.ok(
		cssContent.includes("scroll-margin-top: 20px;"),
		"styling.css .question-text should define scroll-margin-top: 20px matching mobile quiz-column padding",
	);
	assert.ok(
		!cssContent.includes(".main-wrapper.qtype-fill-in-the-blank .quiz-column"),
		"styling.css should keep mobile padding uniform across all question types",
	);
	assert.ok(
		frontHtml.includes("function bindKeyboardScrollAlignment(fieldEl)"),
		"front.html should define focus-gated bindKeyboardScrollAlignment helper",
	);
	assert.ok(
		frontHtml.includes("bindKeyboardScrollAlignment(inputEl)"),
		"front.html should bind keyboard scroll alignment to fill-in-the-blank input",
	);
	assert.ok(
		frontHtml.includes("bindKeyboardScrollAlignment(scratchEl)"),
		"front.html should bind keyboard scroll alignment to short-answer scratchpad",
	);
	assert.ok(
		frontHtml.includes("topEl.scrollIntoView("),
		"front.html should align the top question element into view using scrollIntoView",
	);
	assert.ok(
		frontHtml.includes("if (document.activeElement !== fieldEl) return;"),
		"front.html should guard scroll adjustments so they only run while the input is actively focused",
	);
	assert.ok(
		frontHtml.includes("window.__notebooklmViewportHandler") &&
			backHtml.includes("window.__notebooklmViewportHandler"),
		"both front.html and back.html should clean up lingering visualViewport resize listeners across card flips",
	);
	assert.ok(
		!frontHtml.includes('window.addEventListener("resize", scheduleScrollReset)'),
		"front.html must not attach unconditional global window resize listeners that hijack manual scrolling",
	);
});

test("templates: zero inline display styles and accessible standalone SVG icons", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");

	// Verify absence of direct .style.display mutations
	assert.ok(
		!frontHtml.includes(".style.display"),
		"front.html should not assign inline style.display; state toggles must use CSS classes",
	);
	assert.ok(
		!backHtml.includes(".style.display"),
		"back.html should not assign inline style.display; state toggles must use CSS classes",
	);

	// Verify all embedded SVGs contain XML namespace and accessibility attributes
	const svgRegex = /<svg[^>]*>/g;
	const frontSvgs = frontHtml.match(svgRegex) || [];
	const backSvgs = backHtml.match(svgRegex) || [];
	const allSvgs = [...frontSvgs, ...backSvgs];

	assert.ok(allSvgs.length > 0, "templates should define embedded SVG icons");
	for (const svgTag of allSvgs) {
		assert.ok(
			svgTag.includes('xmlns="http://www.w3.org/2000/svg"'),
			`SVG tag ${svgTag} must define XML namespace`,
		);
		assert.ok(
			svgTag.includes('aria-hidden="true"'),
			`SVG decorative icon ${svgTag} must include aria-hidden="true"`,
		);
	}
});

test("templates: all double curly braces match valid Anki note fields or conditionals", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");

	const validFields = new Set([
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

	const mustachePattern = /\{\{([^{}]+)\}\}/g;
	const checkTemplates = [
		{ name: "front.html", content: frontHtml },
		{ name: "back.html", content: backHtml },
	];

	for (const { name, content } of checkTemplates) {
		const matches = Array.from(content.matchAll(mustachePattern));
		assert.ok(matches.length > 0, `${name} should contain Anki field placeholders`);

		for (const match of matches) {
			const tagContent = match[1].trim();
			// Handle conditional blocks such as {{#Image}} and {{/Image}}
			const cleanName = tagContent.replace(/^[#/^]/, "");
			assert.ok(
				validFields.has(cleanName),
				`${name} contains unexpected double-brace tag '{{${tagContent}}}'. Only registered Anki note fields are permitted to avoid Anki template compilation errors.`,
			);
		}
	}
});

test("templates: continue button styling and mobile touch responsiveness", () => {
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	// Styling rules
	assert.ok(
		cssContent.includes("touch-action: manipulation;"),
		"styling.css .continue-btn should specify touch-action: manipulation to eliminate 300ms tap delay",
	);
	assert.ok(
		cssContent.includes("padding: 14px 16px;"),
		"styling.css .continue-btn should use comfortable padding for touch targets",
	);
	assert.ok(
		cssContent.includes("min-height: 48px;"),
		"styling.css .continue-btn should maintain at least 48px touch target height",
	);
	assert.ok(
		cssContent.includes(".mode-centered .continue-btn,\n.mode-centered .tappable,\n.mode-centered #action-container"),
		"styling.css should ensure pointer-events: auto for continue buttons, tappables, and action containers",
	);
});

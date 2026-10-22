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

	// Verify multi-select adaptive feedback states with consolidated user answer indicators
	assert.ok(
		backHtml.includes("Correct selection (Your answer)"),
		"back.html should include 'Correct selection (Your answer)' feedback label",
	);
	assert.ok(
		backHtml.includes("Missed correct option"),
		"back.html should include 'Missed correct option' feedback label",
	);
	assert.ok(
		backHtml.includes("Incorrect selection (Your answer)"),
		"back.html should include 'Incorrect selection (Your answer)' feedback label",
	);
	assert.ok(
		backHtml.includes("Incorrect option"),
		"back.html should include 'Incorrect option' feedback label",
	);

	// Verify single-choice adaptive feedback states with user answer indicators
	assert.ok(
		backHtml.includes("That's right! (Your answer)"),
		"back.html should include 'That's right! (Your answer)' feedback label",
	);
	assert.ok(
		backHtml.includes("Not quite (Your answer)"),
		"back.html should include 'Not quite (Your answer)' feedback label",
	);

	// Verify option content prompt line has full width without floating badges
	assert.ok(
		!backHtml.includes("${badgeHtml}"),
		"back.html option content should omit floating badge placeholder to guarantee full-width prompt text",
	);
	assert.ok(
		!backHtml.includes('class="your-answer-badge"'),
		"back.html should not inject .your-answer-badge in option content row",
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

test("templates: mobile multi-select tap shielding, validation, and fill-in-the-blank form submit", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	assert.ok(
		frontHtml.includes("window.__notebooklmAllowHostFlip = false;"),
		"front.html should reset host flip state on card render",
	);
	assert.ok(
		frontHtml.includes('btn.addEventListener("touchstart", handleOptionTap)'),
		"front.html should attach touchstart handler to multi-select options to block host tap-to-flip",
	);
	assert.ok(
		frontHtml.includes('btn = document.createElement("button")'),
		"front.html should instantiate multi-select options as native buttons for mobile tap safety",
	);
	assert.ok(
		frontHtml.includes('btn.setAttribute("onclick", "void(0)")'),
		"front.html should assign onclick attribute to multi-select buttons for AnkiMobile tap detection",
	);
	assert.ok(
		frontHtml.includes('pointer-events: none;'),
		"front.html multi-select inner contents should disable pointer events so hit-test targets the button",
	);
	assert.ok(
		frontHtml.includes('<form class="fitb-form fitb-container"'),
		"front.html should wrap the fill-in-the-blank input in a form with scoped classes",
	);
	assert.ok(
		frontHtml.includes('enterkeyhint="done"'),
		"front.html fill-in-the-blank input should set enterkeyhint",
	);
	assert.ok(
		frontHtml.includes('btn.className = "ms-option-btn tappable"'),
		"front.html multi-select options should carry ms-option-btn class",
	);
	assert.ok(
		frontHtml.includes("window.webkit.messageHandlers.cb.postMessage"),
		"front.html should dispatch flip command via AnkiMobile WebKit message handler bridge",
	);
	assert.ok(
		frontHtml.includes('addEventListener("submit", doSubmit)'),
		"front.html should submit fill-in-the-blank answers via form submit",
	);
	assert.ok(
		frontHtml.includes("inputEl.blur()"),
		"front.html should blur input element on submit to dismiss mobile software keyboard",
	);
	assert.ok(
		cssContent.includes("text-align: center;"),
		"styling.css submit-btn should be centered",
	);
	// Multi-select validation
	assert.ok(
		frontHtml.includes("selectedOpts.size === 0"),
		"front.html should require at least one choice before advancing multi-select",
	);
	assert.ok(
		frontHtml.includes("btn-shake"),
		"front.html should trigger shake animation when attempting to submit with zero selections",
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
	// Verify question type scoping
	assert.ok(
		frontHtml.includes('"qtype-" + questionType.toLowerCase()'),
		"front.html should attach scoped question type class to wrapper",
	);
	assert.ok(
		backHtml.includes('"qtype-" + questionType.toLowerCase()'),
		"back.html should attach scoped question type class to wrapper",
	);
	// Verify MULTIPLE_CHOICE single-select behavior remains intact
	assert.ok(
		frontHtml.includes('btn.addEventListener("click", (e) => {\n\t\t\t\t\t\tsaveState();\n\t\t\t\t\t\tflipToBack();'),
		"front.html single-choice multiple choice should retain instant auto-flip on selection",
	);
});

test("templates: fill-in-the-blank skipped state feedback and continue button", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	// CSS classes
	assert.ok(
		cssContent.includes(".card-skipped {"),
		"styling.css should define .card-skipped",
	);
	assert.ok(
		cssContent.includes(".card-skipped .feedback-header {"),
		"styling.css should style .feedback-header within .card-skipped",
	);
	assert.ok(
		cssContent.includes(".continue-btn.btn-skipped {"),
		"styling.css should define .continue-btn.btn-skipped",
	);
	assert.ok(
		cssContent.includes(".btn-skipped {"),
		"styling.css should define .btn-skipped",
	);

	// Front template skipped state evaluation
	assert.ok(
		frontHtml.includes("const isSkipped = typedNorm.length === 0;"),
		"front.html should determine isSkipped when typedNorm is empty",
	);
	assert.ok(
		frontHtml.includes('"card-skipped"'),
		"front.html should apply card-skipped class when skipped",
	);
	assert.ok(
		frontHtml.includes('"Skipped"'),
		"front.html should display Skipped header text when skipped",
	);
	assert.ok(
		frontHtml.includes('"⤼ Skipped — Tap to Grade"'),
		"front.html should update submit button with Skipped label and icon",
	);

	// Back template skipped state evaluation and grading button
	assert.ok(
		backHtml.includes("const isSkipped = normTyped.length === 0;"),
		"back.html should determine isSkipped when normTyped is empty",
	);
	assert.ok(
		backHtml.includes('"card-skipped"'),
		"back.html should apply card-skipped class when skipped",
	);
	assert.ok(
		backHtml.includes('"Again (Mark Skipped)"'),
		"back.html should provide Again (Mark Skipped) button label",
	);
	assert.ok(
		backHtml.includes("isSkipped = false"),
		"back.html renderContinueButton should accept isSkipped flag",
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

test("templates: back.html continue button multi-platform grading and mobile tap support", () => {
	const frontPath = path.join(srcDir, "anki_templates/front.html");
	const frontHtml = fs.readFileSync(frontPath, "utf-8");
	const backPath = path.join(srcDir, "anki_templates/back.html");
	const backHtml = fs.readFileSync(backPath, "utf-8");
	const cssPath = path.join(srcDir, "anki_templates/styling.css");
	const cssContent = fs.readFileSync(cssPath, "utf-8");

	// Front lifecycle export and isInteractive inclusion
	assert.ok(
		frontHtml.includes("window.__notebooklmFrontTapHandler = interceptTap;"),
		"front.html should expose window.__notebooklmFrontTapHandler for safe lifecycle cleanup",
	);
	assert.ok(
		frontHtml.includes('e.target.closest(".continue-btn")'),
		"front.html isInteractive check should permit .continue-btn to prevent swallowing taps across persistent WKWebView",
	);

	// Back lifecycle cleanup
	assert.ok(
		backHtml.includes("window.__notebooklmFrontTapHandler") &&
			backHtml.includes('window.removeEventListener(\n\t\t\t\t"click",\n\t\t\t\twindow.__notebooklmFrontTapHandler'),
		"back.html should detach lingering front tap handlers",
	);
	assert.ok(
		backHtml.includes("window.__notebooklmAllowHostFlip = true;"),
		"back.html should reset window.__notebooklmAllowHostFlip to allow host grading gestures",
	);

	// Multi-platform grading support
	assert.ok(
		backHtml.includes("bridgeCommand(easeCmd)") &&
			backHtml.includes('pycmd(easeCmd);'),
		"back.html gradeCard should dispatch bridgeCommand/pycmd ease3/ease1 on Desktop",
	);
	assert.ok(
		backHtml.includes("ankiAnswerEase3") && backHtml.includes("ankiAnswerEase1"),
		"back.html gradeCard should support direct AnkiDroid answer APIs",
	);
	assert.ok(
		backHtml.includes("AnkiDroidJS"),
		"back.html gradeCard should support AnkiDroidJS bridge object",
	);
	assert.ok(
		backHtml.includes("window.webkit.messageHandlers.bridgeCommand") &&
			backHtml.includes("window.webkit.messageHandlers.cb"),
		"back.html gradeCard should support AnkiMobile WebKit bridgeCommand and callback message handlers",
	);
	assert.ok(
		backHtml.includes('scheme: "ankitap"') &&
			backHtml.includes('msg: isCorrect ? "midRight" : "midLeft"'),
		"back.html gradeCard should support AnkiMobile ankitap gesture bridge for midRight (Good) and midLeft (Again)",
	);
	assert.ok(
		backHtml.includes('window.sendMessage2(\n\t\t\t\t\t\t"ankitap"'),
		"back.html gradeCard should support window.sendMessage2 for legacy iOS wrappers",
	);

	// Mobile detection and button construction
	assert.ok(
		backHtml.includes("function isMobilePlatform()"),
		"back.html should define isMobilePlatform detection helper",
	);
	assert.ok(
		backHtml.includes('navigator.maxTouchPoints > 1 &&\n\t\t\t\t\t(navigator.platform === "MacIntel"'),
		"back.html isMobilePlatform should recognize iPadOS touch screens with MacIntel desktop-class user agent",
	);
	assert.ok(
		backHtml.includes("function shouldShowKeyboardHints()"),
		"back.html should define shouldShowKeyboardHints helper for smart keyboard hint auto-detection",
	);
	assert.ok(
		backHtml.includes('window.matchMedia("(pointer: fine)")'),
		"back.html should detect Magic Keyboard / mouse fine pointers via matchMedia",
	);
	assert.ok(
		backHtml.includes('sessionStorage.getItem("notebooklm_has_keyboard") === "true"'),
		"back.html should detect session-cached physical keyboard usage",
	);
	assert.ok(
		backHtml.includes("continueBtn.className = `continue-btn tappable ${btnStateClass}`;"),
		"back.html renderContinueButton should assign .tappable class for iOS WKWebView tap pass-through",
	);
	assert.ok(
		backHtml.includes('continueBtn.type = "button";'),
		"back.html renderContinueButton should explicitly set type='button'",
	);

	// Platform-adaptive button labels
	assert.ok(
		backHtml.includes('"Good (Mark Correct)"') &&
			backHtml.includes('"Good (Mark Correct) [Space / 3]"'),
		"back.html should provide clean mobile label and desktop keyboard hint for correct answers",
	);
	assert.ok(
		backHtml.includes('"Again (Mark Incorrect)"') &&
			backHtml.includes('"Again (Mark Incorrect) [1]"'),
		"back.html should provide clean mobile label and desktop keyboard hint for incorrect answers",
	);
	assert.ok(
		backHtml.includes('"Again (Mark Skipped)"') &&
			backHtml.includes('"Again (Mark Skipped) [1]"'),
		"back.html should provide clean mobile label and desktop keyboard hint for skipped answers",
	);
	assert.ok(
		backHtml.includes('"Again (Review Later) [1]"') &&
			backHtml.includes('"Good (Understood) [Space / 3]"'),
		"back.html short-answer buttons should include desktop keyboard hints",
	);

	// Mobile gating and top grade banner
	assert.ok(
		backHtml.includes("if (isMobilePlatform()) {\n\t\t\t\treturn;\n\t\t\t}"),
		"back.html renderContinueButton should return early on mobile to let users rely on native AnkiMobile buttons",
	);
	assert.ok(
		backHtml.includes("if (actionContainer && !isMobilePlatform())"),
		"back.html should gate short answer action buttons to desktop platforms only",
	);
	assert.ok(
		backHtml.includes('"✓ Correct (Good)"') &&
			backHtml.includes('"✕ Incorrect (Again)"'),
		"back.html should render top-level score pill above choices for single-choice multiple choice",
	);
	assert.ok(
		backHtml.includes('${correctSelected}/${totalCorrect} Correct ${isFullyCorrect ? "(Good)" : "(Again)"}'),
		"back.html should render top-level score pill with rating intent for multi-select questions",
	);

	// Touch and click handling
	assert.ok(
		backHtml.includes("continueBtn.onclick = handleAction;") &&
			backHtml.includes('continueBtn.addEventListener("touchend", handleAction);'),
		"back.html renderContinueButton should assign onclick property and touchend listener for iOS tap pass-through",
	);

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

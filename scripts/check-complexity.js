/**
 * @fileoverview Cyclomatic complexity auditor for the NotebookLM to Anki Web Extension.
 *
 * Traverses Abstract Syntax Trees (ASTs) of core extension sources using acorn
 * to calculate McCabe cyclomatic complexity for every function. Enforces a hard
 * ceiling of 15 (CI threshold) and alerts on functions exceeding target complexity 10.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as acorn from "acorn";

/**
 * Hard ceiling for cyclomatic complexity.
 *
 * Any function with complexity exceeding this value triggers process exit 1.
 *
 * @type {number}
 */
const MAX_COMPLEXITY_CEILING = 14;

/**
 * Internal recommended target for individual helper functions.
 *
 * Functions exceeding this target emit informational warnings to guide refactoring.
 *
 * @type {number}
 */
const RECOMMENDED_HELPER_TARGET = 10;

/**
 * Target files audited for cyclomatic complexity.
 *
 * @type {Array<string>}
 */
const AUDIT_FILES = [
	"src/utils.js",
	"src/content.js",
	"src/background.js",
	"tests/helpers/mock-chrome.js",
];

/**
 * Checks whether an AST node introduces a new nested function boundary.
 *
 * @param {object} node - AST node to evaluate.
 * @returns {boolean} True if the node is a function declaration or expression.
 */
function isFunctionBoundary(node) {
	if (!node || typeof node.type !== "string") return false;
	return (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	);
}

/**
 * Calculates the McCabe cyclomatic complexity for a given function AST node.
 *
 * Starts at baseline complexity 1 and increments for conditional branches,
 * loops, logical expressions, and exception handlers within the function scope.
 *
 * @param {object} fnNode - The function AST node to evaluate.
 * @returns {number} The calculated McCabe cyclomatic complexity score.
 */
function calculateCyclomaticComplexity(fnNode) {
	let score = 1;

	/**
	 * Recursively traverses child nodes without crossing into nested functions.
	 *
	 * @param {object} node - Current AST node.
	 * @returns {void}
	 */
	function walk(node) {
		if (!node) return;

		switch (node.type) {
			case "IfStatement":
			case "ConditionalExpression":
			case "ForStatement":
			case "ForInStatement":
			case "ForOfStatement":
			case "WhileStatement":
			case "DoWhileStatement":
			case "CatchClause":
			case "LogicalExpression":
				score++;
				break;
			case "SwitchCase":
				if (node.test) score++;
				break;
			default:
				break;
		}

		for (const key of Object.keys(node)) {
			if (key === "parent") continue;
			const child = node[key];
			if (Array.isArray(child)) {
				for (const item of child) {
					if (item && typeof item.type === "string" && !isFunctionBoundary(item)) {
						walk(item);
					}
				}
			} else if (child && typeof child.type === "string" && !isFunctionBoundary(child)) {
				walk(child);
			}
		}
	}

	walk(fnNode.body);
	return score;
}

/**
 * Resolves an identifiable human-readable name for a function AST node.
 *
 * @param {object} node - The function AST node.
 * @returns {string} The resolved function or identifier name.
 */
function resolveFunctionName(node) {
	if (node.id?.name) {
		return node.id.name;
	}
	if (node.parent?.type === "VariableDeclarator" && node.parent.id?.name) {
		return node.parent.id.name;
	}
	if (node.parent?.type === "Property" && node.parent.key?.name) {
		return node.parent.key.name;
	}
	if (node.parent?.type === "AssignmentExpression" && node.parent.left?.name) {
		return node.parent.left.name;
	}
	return "<anonymous>";
}

/**
 * Recursively collects all functions defined within an AST node.
 *
 * @param {object} node - The root AST node to scan.
 * @param {Array<{ name: string, complexity: number, line: number }>} [results=[]] - Aggregator array.
 * @returns {Array<{ name: string, complexity: number, line: number }>} Array of analyzed functions.
 */
function collectFunctions(node, results = []) {
	if (!node) return results;

	if (isFunctionBoundary(node)) {
		const name = resolveFunctionName(node);
		const complexity = calculateCyclomaticComplexity(node);
		const line = node.loc?.start?.line || 0;
		results.push({ name, complexity, line });
	}

	for (const key of Object.keys(node)) {
		if (key === "parent") continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const item of child) {
				if (item && typeof item.type === "string") {
					item.parent = node;
					collectFunctions(item, results);
				}
			}
		} else if (child && typeof child.type === "string") {
			child.parent = node;
			collectFunctions(child, results);
		}
	}

	return results;
}

/**
 * Audits a single JavaScript source file for function cyclomatic complexity.
 *
 * @param {string} relativePath - Relative path to the target file.
 * @returns {{ file: string, functions: Array<{ name: string, complexity: number, line: number }>, violations: Array<object>, warnings: Array<object> }} Audit result summary.
 */
function auditFile(relativePath) {
	const absolutePath = path.resolve(process.cwd(), relativePath);
	const code = fs.readFileSync(absolutePath, "utf-8");
	const ast = acorn.parse(code, {
		ecmaVersion: "latest",
		sourceType: "module",
		locations: true,
	});

	const functions = collectFunctions(ast);
	const violations = functions.filter((fn) => fn.complexity > MAX_COMPLEXITY_CEILING);
	const warnings = functions.filter(
		(fn) =>
			fn.complexity > RECOMMENDED_HELPER_TARGET &&
			fn.complexity <= MAX_COMPLEXITY_CEILING,
	);

	return {
		file: relativePath,
		functions,
		violations,
		warnings,
	};
}

/**
 * Main execution routine that scans audited files and reports complexity metrics.
 *
 * @returns {void}
 */
function runComplexityAudit() {
	console.log("🔍 Auditing function cyclomatic complexity...");

	let totalViolations = 0;
	let totalWarnings = 0;
	let totalFunctions = 0;

	for (const file of AUDIT_FILES) {
		const result = auditFile(file);
		totalFunctions += result.functions.length;
		totalViolations += result.violations.length;
		totalWarnings += result.warnings.length;

		if (result.violations.length > 0) {
			console.error(`\n❌ ${file}: ${result.violations.length} function(s) exceed ceiling (>${MAX_COMPLEXITY_CEILING}):`);
			for (const v of result.violations) {
				console.error(`   - ${v.name} (line ${v.line}): complexity = ${v.complexity}`);
			}
		}

		if (result.warnings.length > 0) {
			console.warn(`\n⚠️  ${file}: ${result.warnings.length} function(s) above helper target (>${RECOMMENDED_HELPER_TARGET}):`);
			for (const w of result.warnings) {
				console.warn(`   - ${w.name} (line ${w.line}): complexity = ${w.complexity}`);
			}
		}
	}

	console.log(
		`\n📊 Audited ${totalFunctions} functions across ${AUDIT_FILES.length} files: ` +
		`${totalViolations} violations, ${totalWarnings} warnings.`,
	);

	if (totalViolations > 0) {
		console.error(
			`\n❌ Lint failed: ${totalViolations} function(s) exceeded the cyclomatic complexity ceiling of ${MAX_COMPLEXITY_CEILING + 1}.`,
		);
		process.exit(1);
	}

	console.log("✅ All audited functions satisfy the cyclomatic complexity threshold ceiling (≤ 14).\n");
}

runComplexityAudit();

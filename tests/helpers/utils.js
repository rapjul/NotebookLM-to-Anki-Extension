// tests/helpers/utils.js - Test helper re-exporting shared utilities

import "../../src/utils.js";

/**
 * Re-exported unescapeHtml utility.
 * @type {function(string): string}
 */
export const unescapeHtml = globalThis.NotebookLMToAnkiUtils.unescapeHtml;

/**
 * Re-exported cleanNotebookTitle utility.
 * @type {function(string|null|undefined): string}
 */
export const cleanNotebookTitle =
	globalThis.NotebookLMToAnkiUtils.cleanNotebookTitle;

/**
 * Re-exported cleanQuizTitle utility.
 * @type {function(string|null|undefined): string}
 */
export const cleanQuizTitle = globalThis.NotebookLMToAnkiUtils.cleanQuizTitle;

/**
 * Re-exported formatDeckTitle utility.
 * @type {function(string|null|undefined, string|null|undefined, string=): string}
 */
export const formatDeckTitle = globalThis.NotebookLMToAnkiUtils.formatDeckTitle;

/**
 * Re-exported formatErrorMessage utility.
 * @type {function(string|Array<string>|null|undefined): string}
 */
export const formatErrorMessage =
	globalThis.NotebookLMToAnkiUtils.formatErrorMessage;

/**
 * Re-exported parseQuizJson utility.
 * @type {function(string): { quizData: Array<object>, title: string|undefined }}
 */
export const parseQuizJson = globalThis.NotebookLMToAnkiUtils.parseQuizJson;

/**
 * Re-exported mapQuizDataToCards utility.
 * @type {function(Array<object>): Array<object>}
 */
export const mapQuizDataToCards =
	globalThis.NotebookLMToAnkiUtils.mapQuizDataToCards;

/**
 * Re-exported mapCardsToAnkiNotes utility.
 * @type {function(Array<object>, string, string=): Array<object>}
 */
export const mapCardsToAnkiNotes =
	globalThis.NotebookLMToAnkiUtils.mapCardsToAnkiNotes;

/**
 * Re-exported normalizeQuestionText utility.
 * @type {function(string|null|undefined): string}
 */
export const normalizeQuestionText =
	globalThis.NotebookLMToAnkiUtils.normalizeQuestionText;

/**
 * Re-exported filterDuplicateNotes utility.
 * @type {function(Array<object>, Set<string>): { notesToSend: Array<object>, skippedCount: number }}
 */
export const filterDuplicateNotes =
	globalThis.NotebookLMToAnkiUtils.filterDuplicateNotes;

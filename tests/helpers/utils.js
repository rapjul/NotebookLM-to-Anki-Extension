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
 * Re-exported extractQuestionMedia utility.
 * @type {function(string, Array<string>=): { cleanQuestion: string, mediaUrl: string|null, alt: string|null, caption: string|null }}
 */
export const extractQuestionMedia =
	globalThis.NotebookLMToAnkiUtils.extractQuestionMedia;

/**
 * Re-exported sanitizeTopicTags utility.
 * @type {function(Array<string>|null|undefined): Array<string>}
 */
export const sanitizeTopicTags =
	globalThis.NotebookLMToAnkiUtils.sanitizeTopicTags;

/**
 * Re-exported normalizeBlankAnswer utility.
 * @type {function(string|null|undefined): string}
 */
export const normalizeBlankAnswer =
	globalThis.NotebookLMToAnkiUtils.normalizeBlankAnswer;

/**
 * Re-exported isPlaceholderImageSrc utility.
 * @type {function(string): boolean}
 */
export const isPlaceholderImageSrc =
	globalThis.NotebookLMToAnkiUtils.isPlaceholderImageSrc;

/**
 * Re-exported normalizeQuestionText utility.
 * @type {function(string|null|undefined): string}
 */
export const normalizeQuestionText =
	globalThis.NotebookLMToAnkiUtils.normalizeQuestionText;

/**
 * Re-exported findImageUrlsDeep utility.
 * @type {function(*, Set<object>=): Array<string>}
 */
export const findImageUrlsDeep =
	globalThis.NotebookLMToAnkiUtils.findImageUrlsDeep;

/**
 * Re-exported resolveCardsWithDomImages utility.
 * @type {function(Array<object>, (Document|Element|null)=): Array<object>}
 */
export const resolveCardsWithDomImages =
	globalThis.NotebookLMToAnkiUtils.resolveCardsWithDomImages;

/**
 * Re-exported findMatchingDomImage utility.
 * @type {function(object, Array<Element>, Set<Element>=): (Element|null)}
 */
export const findMatchingDomImage =
	globalThis.NotebookLMToAnkiUtils.findMatchingDomImage;

/**
 * Re-exported filterDuplicateNotes utility.
 * @type {function(Array<object>, Set<string>): { notesToSend: Array<object>, skippedCount: number }}
 */
export const filterDuplicateNotes =
	globalThis.NotebookLMToAnkiUtils.filterDuplicateNotes;

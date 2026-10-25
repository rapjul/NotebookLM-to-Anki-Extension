/**
 * @fileoverview Persistent Anki Card Reviewer simulator using jsdom.
 * Emulates Desktop, AnkiMobile iOS, iPadOS Magic Keyboard, and AnkiDroid environments,
 * maintaining persistent window and sessionStorage across Front -> Back transitions.
 */

import { JSDOM } from "jsdom";
import { compileCardSide, wrapInCardDocument } from "./anki-compiler.js";

/**
 * Supported Anki host platform identifiers.
 * @typedef {"desktop" | "ankimobile-ios" | "ankimobile-ipados-keyboard" | "ankidroid"} AnkiPlatform
 */

/**
 * Tracks recorded bridge invocations during a review session.
 * @typedef {Object} BridgeRecordings
 * @property {string[]} pycmd - Commands sent via pycmd.
 * @property {string[]} bridgeCommand - Commands sent via bridgeCommand.
 * @property {string[]} ankiAnswerEase - Ease grades dispatched to AnkiDroid ease functions.
 * @property {number} showAnswer - Number of times showAnswer was called.
 * @property {any[]} webkitCb - Payloads passed to window.webkit.messageHandlers.cb.postMessage.
 * @property {any[]} webkitBridge - Payloads passed to window.webkit.messageHandlers.bridgeCommand.postMessage.
 * @property {Array<{ scheme: string, msg: string }>} sendMessage2 - Messages sent via window.sendMessage2.
 * @property {HTMLElement[][]} mathJaxTypeset - Element arrays passed to MathJax.typesetPromise.
 * @property {any[][]} mathJaxQueue - Queue commands passed to MathJax.Hub.Queue.
 * @property {any[]} templateErrors - Uncaught errors logged by card template error boundaries.
 */

/**
 * Creates an empty recordings container.
 *
 * @returns {BridgeRecordings} Empty recordings structure.
 */
function createEmptyRecordings() {
	return {
		pycmd: [],
		bridgeCommand: [],
		ankiAnswerEase: [],
		showAnswer: 0,
		webkitCb: [],
		webkitBridge: [],
		sendMessage2: [],
		mathJaxTypeset: [],
		mathJaxQueue: [],
		templateErrors: [],
	};
}

/**
 * Injects Desktop bridge functions onto the window object.
 *
 * @param {object} win - JSDOM window object.
 * @param {BridgeRecordings} recordings - Target recordings collector.
 * @returns {void}
 */
function applyDesktopProfile(win, recordings) {
	win.pycmd = (cmd) => {
		recordings.pycmd.push(String(cmd));
	};
	win.bridgeCommand = (cmd) => {
		recordings.bridgeCommand.push(String(cmd));
	};
}

/**
 * Injects AnkiMobile iOS bridge handlers and classes onto the window.
 *
 * @param {object} win - JSDOM window object.
 * @param {BridgeRecordings} recordings - Target recordings collector.
 * @returns {void}
 */
function applyAnkiMobileProfile(win, recordings) {
	win.document.documentElement.classList.add("mobile", "iphone", "ios");
	win.anki = true;

	win.webkit = {
		messageHandlers: {
			cb: {
				postMessage: (payload) => {
					recordings.webkitCb.push(payload);
				},
			},
			bridgeCommand: {
				postMessage: (payload) => {
					recordings.webkitBridge.push(payload);
				},
			},
		},
	};

	win.sendMessage2 = (scheme, msg) => {
		recordings.sendMessage2.push({ scheme: String(scheme), msg: String(msg) });
	};
}

/**
 * Injects iPadOS Magic Keyboard platform attributes onto the window.
 *
 * @param {object} win - JSDOM window object.
 * @param {BridgeRecordings} recordings - Target recordings collector.
 * @returns {void}
 */
function applyIPadOsKeyboardProfile(win, recordings) {
	applyAnkiMobileProfile(win, recordings);
	win.document.documentElement.classList.remove("iphone");
	win.document.documentElement.classList.add("ipad");

	Object.defineProperty(win.navigator, "platform", {
		value: "MacIntel",
		configurable: true,
	});
	Object.defineProperty(win.navigator, "maxTouchPoints", {
		value: 5,
		configurable: true,
	});
	Object.defineProperty(win.navigator, "userAgent", {
		value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
		configurable: true,
	});

	win.matchMedia = (query) => ({
		matches: query.includes("pointer: fine"),
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true,
	});
}

/**
 * Injects AnkiDroid bridge functions and classes onto the window.
 *
 * @param {object} win - JSDOM window object.
 * @param {BridgeRecordings} recordings - Target recordings collector.
 * @returns {void}
 */
function applyAnkiDroidProfile(win, recordings) {
	win.document.documentElement.classList.add("mobile", "android");

	win.showAnswer = () => {
		recordings.showAnswer++;
	};
	win.ankiAnswerEase1 = () => {
		recordings.ankiAnswerEase.push("ease1");
	};
	win.ankiAnswerEase3 = () => {
		recordings.ankiAnswerEase.push("ease3");
	};

	win.AnkiDroidJS = {
		showAnswer: () => {
			recordings.showAnswer++;
		},
		ankiAnswerEase1: () => {
			recordings.ankiAnswerEase.push("ease1");
		},
		ankiAnswerEase3: () => {
			recordings.ankiAnswerEase.push("ease3");
		},
	};
}

/**
 * Injects MathJax spies onto the simulated window.
 *
 * @param {object} win - JSDOM window object.
 * @param {BridgeRecordings} recordings - Target recordings collector.
 * @returns {void}
 */
function injectMathJaxSpy(win, recordings) {
	win.MathJax = {
		typesetPromise: (elements) => {
			recordings.mathJaxTypeset.push(elements);
			return Promise.resolve();
		},
		Hub: {
			Queue: (args) => {
				recordings.mathJaxQueue.push(args);
			},
		},
	};
}

/**
 * Injects console error capture to trap template runtime exceptions.
 *
 * @param {object} win - JSDOM window object.
 * @param {BridgeRecordings} recordings - Target recordings collector.
 * @returns {void}
 */
function injectConsoleTrap(win, recordings) {
	const origLog = win.console.log;
	win.console.log = (...args) => {
		const firstStr = String(args[0] || "");
		if (firstStr.includes("Template Error:")) {
			recordings.templateErrors.push(args[1] || args[0]);
		}
		origLog.apply(win.console, args);
	};
}

/**
 * Extracts and separates inline <script> contents from an HTML string.
 *
 * @param {string} html - Raw HTML with optional script blocks.
 * @returns {{ markupWithoutScripts: string, scripts: string[] }} Separated HTML and scripts.
 */
function extractScripts(html) {
	const scripts = [];
	const markupWithoutScripts = html.replace(
		/<script\b[^>]*>([\s\S]*?)<\/script>/gi,
		(_match, scriptContent) => {
			scripts.push(scriptContent);
			return "";
		},
	);
	return { markupWithoutScripts, scripts };
}

/**
 * In-memory simulator of Anki's card reviewer webview across Desktop and Mobile platforms.
 */
export class AnkiCardReviewer {
	/**
	 * Creates an AnkiCardReviewer simulator session.
	 *
	 * @param {object} [options={}] - Configuration options.
	 * @param {AnkiPlatform} [options.platform="desktop"] - Target platform profile.
	 * @param {string} [options.customCss] - Optional card stylesheet override.
	 */
	constructor(options = {}) {
		this.platform = options.platform || "desktop";
		this.customCss = options.customCss;
		this.recordings = createEmptyRecordings();

		const initialHtml = wrapInCardDocument("", this.customCss);
		this.dom = new JSDOM(initialHtml, {
			runScripts: "dangerously",
			url: "https://anki.local/reviewer",
			pretendToBeVisual: true,
		});

		this._initEnvironment();
	}

	/**
	 * Returns the window object of the simulated webview.
	 * @returns {object} JSDOM window instance.
	 */
	get window() {
		return this.dom.window;
	}

	/**
	 * Returns the document object of the simulated webview.
	 * @returns {Document} DOM Document instance.
	 */
	get document() {
		return this.dom.window.document;
	}

	/**
	 * Initializes platform bridges, MathJax spy, and console traps.
	 *
	 * @private
	 * @returns {void}
	 */
	_initEnvironment() {
		const win = this.dom.window;

		injectMathJaxSpy(win, this.recordings);
		injectConsoleTrap(win, this.recordings);

		switch (this.platform) {
			case "ankimobile-ios":
				applyAnkiMobileProfile(win, this.recordings);
				break;
			case "ankimobile-ipados-keyboard":
				applyIPadOsKeyboardProfile(win, this.recordings);
				break;
			case "ankidroid":
				applyAnkiDroidProfile(win, this.recordings);
				break;
			case "desktop":
			default:
				applyDesktopProfile(win, this.recordings);
				break;
		}
	}

	/**
	 * Renders the card Front side into the persistent webview and executes template scripts.
	 *
	 * @param {Record<string, string>} fields - Note field dictionary.
	 * @returns {Promise<void>} Resolves when script execution and microtasks settle.
	 */
	async renderFront(fields) {
		const frontHtml = compileCardSide("front", fields);
		await this._mountTemplate(frontHtml);
	}

	/**
	 * Renders the card Back side into the persistent webview, retaining sessionStorage from Front.
	 *
	 * @param {Record<string, string>} fields - Note field dictionary.
	 * @returns {Promise<void>} Resolves when script execution and microtasks settle.
	 */
	async renderBack(fields) {
		const backHtml = compileCardSide("back", fields);
		await this._mountTemplate(backHtml);
	}

	/**
	 * Mounts markup into document.body and executes extracted <script> blocks within the window.
	 *
	 * @private
	 * @param {string} templateHtml - Compiled template HTML with script tags.
	 * @returns {Promise<void>} Resolves after mounting and executing scripts.
	 */
	async _mountTemplate(templateHtml) {
		const { markupWithoutScripts, scripts } = extractScripts(templateHtml);

		this.document.body.innerHTML = markupWithoutScripts;

		for (const scriptContent of scripts) {
			this.window.eval(scriptContent);
		}

		// Allow microtasks and immediate macrotasks to settle
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	/**
	 * Clears recorded bridge calls and resets sessionStorage for a fresh review session.
	 *
	 * @returns {void}
	 */
	clearSession() {
		this.recordings = createEmptyRecordings();
		this.window.sessionStorage.clear();
	}
}

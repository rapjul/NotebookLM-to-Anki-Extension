/**
 * @fileoverview Zero-dependency in-memory mock harness for Chrome Extension APIs
 * and minimal DOM tree simulation for testing background, popup, and content scripts in Node.js.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, "../../src");

/**
 * Set of HTML tag names that are void (self-closing without an explicit closing tag).
 * @type {Set<string>}
 */
const VOID_ELEMENTS = new Set([
	"AREA",
	"BASE",
	"BR",
	"COL",
	"EMBED",
	"HR",
	"IMG",
	"INPUT",
	"LINK",
	"META",
	"PARAM",
	"SOURCE",
	"TRACK",
	"WBR",
]);

/**
 * In-memory mock DOM node representing either an element or text node.
 */
export class MockNode {
	/**
	 * Creates a new MockNode.
	 *
	 * @param {number} nodeType - DOM node type (1 for element, 3 for text).
	 * @param {string} [nodeName="#text"] - Name or tag of the node.
	 */
	constructor(nodeType, nodeName = "#text") {
		/**
		 * The DOM node type.
		 * @type {number}
		 */
		this.nodeType = nodeType;

		/**
		 * The DOM node name.
		 * @type {string}
		 */
		this.nodeName = nodeName.toUpperCase();

		/**
		 * The parent node reference.
		 * @type {MockNode|null}
		 */
		this.parentElement = null;

		/**
		 * The parent node reference (DOM alias).
		 * @type {MockNode|null}
		 */
		this.parentNode = null;

		/**
		 * Child nodes collection.
		 * @type {MockNode[]}
		 */
		this.childNodes = [];
	}

	/**
	 * Retrieves direct element children.
	 *
	 * @returns {MockElement[]} Array of child element nodes.
	 */
	get children() {
		return /** @type {MockElement[]} */ (
			this.childNodes.filter((child) => child.nodeType === 1)
		);
	}

	/**
	 * Retrieves the first child node.
	 *
	 * @returns {MockNode|null} The first child or null.
	 */
	get firstChild() {
		return this.childNodes[0] || null;
	}

	/**
	 * Retrieves the first child element.
	 *
	 * @returns {MockElement|null} The first child element or null.
	 */
	get firstElementChild() {
		return this.children[0] || null;
	}

	/**
	 * Retrieves the last child element.
	 *
	 * @returns {MockElement|null} The last child element or null.
	 */
	get lastElementChild() {
		const childElements = this.children;
		return childElements[childElements.length - 1] || null;
	}

	/**
	 * Appends a child node to this node.
	 *
	 * @param {MockNode} child - The node to append.
	 * @returns {MockNode} The appended child node.
	 */
	appendChild(child) {
		if (child.parentElement) {
			child.parentElement.removeChild(child);
		}
		child.parentElement = this;
		child.parentNode = this;
		this.childNodes.push(child);
		return child;
	}

	/**
	 * Inserts a child node before an existing reference child node.
	 *
	 * @param {MockNode} newChild - The new node to insert.
	 * @param {MockNode|null} refChild - The reference node before which newChild is inserted.
	 * @returns {MockNode} The inserted child node.
	 */
	insertBefore(newChild, refChild) {
		if (newChild.parentElement) {
			newChild.parentElement.removeChild(newChild);
		}
		newChild.parentElement = this;
		newChild.parentNode = this;

		if (!refChild) {
			this.childNodes.push(newChild);
			return newChild;
		}

		const index = this.childNodes.indexOf(refChild);
		if (index === -1) {
			this.childNodes.push(newChild);
		} else {
			this.childNodes.splice(index, 0, newChild);
		}
		return newChild;
	}

	/**
	 * Removes a child node from this node.
	 *
	 * @param {MockNode} child - The child node to remove.
	 * @returns {MockNode} The removed child node.
	 */
	removeChild(child) {
		const index = this.childNodes.indexOf(child);
		if (index !== -1) {
			this.childNodes.splice(index, 1);
			child.parentElement = null;
			child.parentNode = null;
		}
		return child;
	}
}

/**
 * In-memory mock DOM text node.
 */
export class MockTextNode extends MockNode {
	/**
	 * Creates a new MockTextNode.
	 *
	 * @param {string} text - The text content.
	 */
	constructor(text) {
		super(3, "#text");

		/**
		 * The text content of the node.
		 * @type {string}
		 */
		this._text = String(text);
	}

	/**
	 * Gets the text content.
	 *
	 * @returns {string} The text content.
	 */
	get textContent() {
		return this._text;
	}

	/**
	 * Sets the text content.
	 *
	 * @param {string} value - The new text content.
	 */
	set textContent(value) {
		this._text = String(value);
	}
}

/**
 * In-memory mock DOM element supporting attributes, classList, events, and query selectors.
 */
export class MockElement extends MockNode {
	/**
	 * Creates a new MockElement.
	 *
	 * @param {string} tagName - Tag name of the element (e.g., 'DIV', 'BUTTON').
	 */
	constructor(tagName) {
		super(1, tagName);

		/**
		 * Normalized uppercase tag name.
		 * @type {string}
		 */
		this.tagName = tagName.toUpperCase();

		/**
		 * Attributes storage.
		 * @type {Map<string, string>}
		 */
		this._attributes = new Map();

		/**
		 * Registered event listener callbacks.
		 * @type {Map<string, Array<function(object): void>>}
		 */
		this._listeners = new Map();

		/**
		 * Form field value property.
		 * @type {string}
		 */
		this.value = "";

		/**
		 * Disabled state flag.
		 * @type {boolean}
		 */
		this.disabled = false;

		/**
		 * Direct onclick handler property.
		 * @type {function(object): void|null}
		 */
		this.onclick = null;

		/**
		 * Mock iframe contentWindow reference if this element is an iframe.
		 * @type {object|null}
		 */
		this.contentWindow = null;

		/**
		 * Class list representation for the element.
		 */
		this.classList = {
			/**
			 * Adds class names to the element.
			 * @param {...string} tokens - Classes to add.
			 * @returns {void}
			 */
			add: (...tokens) => {
				const current = this.className
					? this.className.split(/\s+/)
					: [];
				for (const token of tokens) {
					if (!current.includes(token)) {
						current.push(token);
					}
				}
				this.className = current.join(" ");
			},
			/**
			 * Removes class names from the element.
			 * @param {...string} tokens - Classes to remove.
			 * @returns {void}
			 */
			remove: (...tokens) => {
				const current = this.className
					? this.className.split(/\s+/)
					: [];
				const updated = current.filter((cls) => !tokens.includes(cls));
				this.className = updated.join(" ");
			},
			/**
			 * Checks if a class is present.
			 * @param {string} token - Class to check.
			 * @returns {boolean} True if class is present.
			 */
			contains: (token) => {
				const current = this.className
					? this.className.split(/\s+/)
					: [];
				return current.includes(token);
			},
		};
	}

	/**
	 * Element ID attribute getter.
	 *
	 * @returns {string} The element ID.
	 */
	get id() {
		return this._attributes.get("id") || "";
	}

	/**
	 * Element ID attribute setter.
	 *
	 * @param {string} value - The element ID.
	 */
	set id(value) {
		this.setAttribute("id", value);
	}

	/**
	 * Element class attribute getter.
	 *
	 * @returns {string} The space-separated class names.
	 */
	get className() {
		return this._attributes.get("class") || "";
	}

	/**
	 * Element class attribute setter.
	 *
	 * @param {string} value - The space-separated class names.
	 */
	set className(value) {
		this.setAttribute("class", value);
	}

	/**
	 * Retrieves an attribute value.
	 *
	 * @param {string} name - Attribute name.
	 * @returns {string|null} The attribute value, or null if missing.
	 */
	getAttribute(name) {
		return this._attributes.has(name) ? this._attributes.get(name) : null;
	}

	/**
	 * Sets an attribute value.
	 *
	 * @param {string} name - Attribute name.
	 * @param {string|number|boolean} value - Attribute value.
	 * @returns {void}
	 */
	setAttribute(name, value) {
		this._attributes.set(name, String(value));
	}

	/**
	 * Checks if an attribute exists.
	 *
	 * @param {string} name - Attribute name.
	 * @returns {boolean} True if attribute exists.
	 */
	hasAttribute(name) {
		return this._attributes.has(name);
	}

	/**
	 * Removes an attribute.
	 *
	 * @param {string} name - Attribute name.
	 * @returns {void}
	 */
	removeAttribute(name) {
		this._attributes.delete(name);
	}

	/**
	 * Gets text content of all descendants.
	 *
	 * @returns {string} Concatenated text content.
	 */
	get textContent() {
		return this.childNodes
			.map((child) =>
				child.nodeType === 3
					? /** @type {MockTextNode} */ (child).textContent
					: /** @type {MockElement} */ (child).textContent,
			)
			.join("");
	}

	/**
	 * Sets text content, clearing child nodes and creating a text child.
	 *
	 * @param {string} text - The new text.
	 */
	set textContent(text) {
		this.childNodes = [];
		if (text !== "") {
			this.appendChild(new MockTextNode(text));
		}
	}

	/**
	 * DOM innerText alias.
	 *
	 * @returns {string} The text content.
	 */
	get innerText() {
		return this.textContent;
	}

	/**
	 * Sets innerText.
	 *
	 * @param {string} text - The text value.
	 */
	set innerText(text) {
		this.textContent = text;
	}

	/**
	 * Sets HTML content, parsing the string into child nodes.
	 *
	 * @param {string} html - HTML markup string.
	 */
	set innerHTML(html) {
		this.childNodes = [];
		const parsedNodes = parseHTMLToNodes(html);
		for (const node of parsedNodes) {
			this.appendChild(node);
		}
	}

	/**
	 * Adds an event listener.
	 *
	 * @param {string} type - Event type (e.g., 'click', 'input').
	 * @param {function(object): void} listener - Event listener callback.
	 * @returns {void}
	 */
	addEventListener(type, listener) {
		if (!this._listeners.has(type)) {
			this._listeners.set(type, []);
		}
		this._listeners.get(type).push(listener);
	}

	/**
	 * Removes an event listener.
	 *
	 * @param {string} type - Event type.
	 * @param {function(object): void} listener - Event listener callback.
	 * @returns {void}
	 */
	removeEventListener(type, listener) {
		if (!this._listeners.has(type)) return;
		const list = this._listeners.get(type);
		const index = list.indexOf(listener);
		if (index !== -1) {
			list.splice(index, 1);
		}
	}

	/**
	 * Dispatches an event on this element.
	 *
	 * @param {object} event - Event object.
	 * @param {string} event.type - Event type name.
	 * @returns {boolean} True if not cancelled.
	 */
	dispatchEvent(event) {
		const list = this._listeners.get(event.type) || [];
		for (const listener of list) {
			listener(event);
		}
		return true;
	}

	/**
	 * Simulates a mouse click on this element.
	 *
	 * @param {object} [eventProps={}] - Optional event properties.
	 * @returns {void}
	 */
	click(eventProps = {}) {
		const event = {
			type: "click",
			target: this,
			currentTarget: this,
			defaultPrevented: false,
			preventDefault: () => {
				event.defaultPrevented = true;
			},
			stopPropagation: () => {},
			...eventProps,
		};

		if (typeof this.onclick === "function") {
			this.onclick(event);
		}
		this.dispatchEvent(event);
	}

	/**
	 * Finds the closest ancestor element (or self) matching the selector.
	 *
	 * @param {string} selector - CSS selector.
	 * @returns {MockElement|null} The matching element or null.
	 */
	closest(selector) {
		let current = /** @type {MockElement|null} */ (this);
		while (current && current.nodeType === 1) {
			if (matchesSelector(current, selector)) {
				return current;
			}
			current = /** @type {MockElement|null} */ (current.parentElement);
		}
		return null;
	}

	/**
	 * Queries the subtree for the first matching element.
	 *
	 * @param {string} selector - CSS selector string.
	 * @returns {MockElement|null} First matching element or null.
	 */
	querySelector(selector) {
		for (const child of this.childNodes) {
			if (child.nodeType === 1) {
				const elem = /** @type {MockElement} */ (child);
				if (matchesSelector(elem, selector)) {
					return elem;
				}
				const deeper = elem.querySelector(selector);
				if (deeper) return deeper;
			}
		}
		return null;
	}

	/**
	 * Queries the subtree for all matching elements.
	 *
	 * @param {string} selector - CSS selector string.
	 * @returns {MockElement[]} Array of matching elements.
	 */
	querySelectorAll(selector) {
		const results = [];
		for (const child of this.childNodes) {
			if (child.nodeType === 1) {
				const elem = /** @type {MockElement} */ (child);
				if (matchesSelector(elem, selector)) {
					results.push(elem);
				}
				results.push(...elem.querySelectorAll(selector));
			}
		}
		return results;
	}
}

/**
 * Splits a compound CSS selector on descendant whitespace, respecting quoted attribute strings.
 *
 * @param {string} selector - Compound CSS selector.
 * @returns {string[]} Array of selector parts.
 */
function splitSelectorParts(selector) {
	const parts = [];
	let current = "";
	let inQuote = false;
	let quoteChar = "";

	for (let i = 0; i < selector.length; i++) {
		const ch = selector[i];
		if ((ch === '"' || ch === "'") && (!inQuote || quoteChar === ch)) {
			inQuote = !inQuote;
			quoteChar = inQuote ? ch : "";
			current += ch;
		} else if (!inQuote && /\s/.test(ch)) {
			if (current.length > 0) {
				parts.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current.length > 0) {
		parts.push(current);
	}
	return parts;
}

/**
 * Checks whether a given element matches a supported CSS selector.
 *
 * @param {MockElement} element - The element to check.
 * @param {string} selector - The CSS selector string.
 * @returns {boolean} True if the element matches the selector.
 */
function matchesSelector(element, selector) {
	const trimmed = selector.trim();

	// Compound descendant selector: e.g. ".notebooklm-to-anki-btn-label span:last-child"
	const parts = splitSelectorParts(trimmed);
	if (parts.length > 1) {
		const lastPart = parts[parts.length - 1];
		if (!matchesSelector(element, lastPart)) {
			return false;
		}
		let parent = element.parentElement;
		while (parent && parent.nodeType === 1) {
			if (
				matchesSelector(/** @type {MockElement} */ (parent), parts[0])
			) {
				return true;
			}
			parent = parent.parentElement;
		}
		return false;
	}

	// Pseudo-class :last-child
	if (trimmed.endsWith(":last-child")) {
		const baseSelector = trimmed.replace(":last-child", "");
		if (baseSelector && !matchesSelector(element, baseSelector)) {
			return false;
		}
		if (!element.parentElement) return true;
		const siblings = element.parentElement.children;
		return siblings[siblings.length - 1] === element;
	}

	// ID selector: #id
	if (trimmed.startsWith("#")) {
		return element.id === trimmed.slice(1);
	}

	// Class selector: .class
	if (trimmed.startsWith(".")) {
		return element.classList.contains(trimmed.slice(1));
	}

	// Tag with class: tag.class (e.g. div.flex, input.artifact-title)
	const tagClassMatch = trimmed.match(/^([a-zA-Z0-9]+)\.([a-zA-Z0-9-_]+)$/);
	if (tagClassMatch) {
		return (
			element.tagName === tagClassMatch[1].toUpperCase() &&
			element.classList.contains(tagClassMatch[2])
		);
	}

	// Attribute selector: tag[attr="val"] or [attr="val"]
	const attrExactMatch = trimmed.match(
		/^(?:([a-zA-Z0-9]+))?\[([a-zA-Z0-9-_:]+)=["'](.*?)["']\]$/,
	);
	if (attrExactMatch) {
		const [, tag, attrName, attrVal] = attrExactMatch;
		if (tag && element.tagName !== tag.toUpperCase()) return false;
		return element.getAttribute(attrName) === attrVal;
	}

	// Attribute existence selector: tag[attr] or [attr]
	const attrExistsMatch = trimmed.match(
		/^(?:([a-zA-Z0-9]+))?\[([a-zA-Z0-9-_:]+)\]$/,
	);
	if (attrExistsMatch) {
		const [, tag, attrName] = attrExistsMatch;
		if (tag && element.tagName !== tag.toUpperCase()) return false;
		return element.hasAttribute(attrName);
	}

	// Bare tag name: tag
	if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
		return element.tagName === trimmed.toUpperCase();
	}

	return false;
}

/**
 * Parses an HTML string into a flat or nested tree of MockNode objects.
 *
 * @param {string} html - HTML string to parse.
 * @returns {MockNode[]} Top-level parsed MockNodes.
 */
export function parseHTMLToNodes(html) {
	const root = new MockNode(1, "#root");
	const stack = [root];
	const regex =
		/(<(\/)?([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9-_:]+(?:="[^"]*"|='[^']*'|=[^\s>]+)?)*)\s*(\/)?>)|([^<]+)/g;
	let match;

	while ((match = regex.exec(html)) !== null) {
		if (match[6] !== undefined) {
			const text = match[6];
			if (text) {
				stack[stack.length - 1].appendChild(new MockTextNode(text));
			}
		} else if (match[1] !== undefined) {
			const isClosing = Boolean(match[2]);
			const tagName = match[3].toUpperCase();
			const rawAttrs = match[4] || "";
			const isSelfClosing =
				Boolean(match[5]) || VOID_ELEMENTS.has(tagName);

			if (isClosing) {
				if (
					stack.length > 1 &&
					stack[stack.length - 1].nodeName === tagName
				) {
					stack.pop();
				}
			} else {
				const elem = new MockElement(tagName);
				const attrRegex =
					/([a-zA-Z0-9-_:]+)(?:=(["'])(.*?)\2|=([^\s>]+))?/g;
				let attrMatch;
				while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
					const attrName = attrMatch[1];
					const attrVal =
						attrMatch[3] !== undefined
							? attrMatch[3]
							: attrMatch[4] !== undefined
								? attrMatch[4]
								: "";
					elem.setAttribute(attrName, attrVal);
				}

				stack[stack.length - 1].appendChild(elem);
				if (!isSelfClosing) {
					stack.push(elem);
				}
			}
		}
	}

	return root.childNodes;
}

/**
 * Creates an in-memory mock DOM environment for window, document, and MutationObserver.
 *
 * @param {object} [options={}] - Options for initializing the DOM.
 * @param {boolean} [options.isIframe=false] - If true, simulates execution inside a sub-frame.
 * @param {string} [options.title="NotebookLM"] - Default document title.
 * @returns {object} Mock DOM environment objects { window, document, MutationObserver }.
 */
export function createMockDOM(options = {}) {
	const documentElement = new MockElement("HTML");
	const body = new MockElement("BODY");
	documentElement.appendChild(body);

	const listeners = new Map();
	const activeObservers = new Set();

	/**
	 * Mock MutationObserver class.
	 */
	class MockMutationObserver {
		/**
		 * Creates a MutationObserver.
		 * @param {function(Array<object>, MockMutationObserver): void} callback - Callback.
		 */
		constructor(callback) {
			this.callback = callback;
			activeObservers.add(this);
		}

		/**
		 * Observes a target element.
		 * @param {MockNode} target - Target element.
		 * @param {object} config - MutationObserver options.
		 * @returns {void}
		 */
		observe(target, config) {
			this.target = target;
			this.config = config;
		}

		/**
		 * Disconnects the observer.
		 * @returns {void}
		 */
		disconnect() {
			activeObservers.delete(this);
		}

		/**
		 * Triggers all active mutation observers.
		 * @param {Array<object>} [mutations=[]] - Mutation records to dispatch.
		 * @returns {void}
		 */
		static triggerAll(mutations = []) {
			for (const obs of activeObservers) {
				obs.callback(mutations, obs);
			}
		}
	}

	const doc = {
		documentElement,
		body,
		title: options.title || "NotebookLM",
		/**
		 * Creates an element.
		 * @param {string} tag - Tag name.
		 * @returns {MockElement} Created element.
		 */
		createElement: (tag) => new MockElement(tag),
		/**
		 * Finds element by ID.
		 * @param {string} id - Element ID.
		 * @returns {MockElement|null} Found element or null.
		 */
		getElementById: (id) => documentElement.querySelector(`#${id}`),
		/**
		 * Queries first matching element.
		 * @param {string} selector - Selector.
		 * @returns {MockElement|null} Found element.
		 */
		querySelector: (selector) => documentElement.querySelector(selector),
		/**
		 * Queries all matching elements.
		 * @param {string} selector - Selector.
		 * @returns {MockElement[]} Found elements.
		 */
		querySelectorAll: (selector) =>
			documentElement.querySelectorAll(selector),
		/**
		 * Adds event listener.
		 * @param {string} type - Event type.
		 * @param {function(object): void} listener - Listener callback.
		 * @returns {void}
		 */
		addEventListener: (type, listener) => {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(listener);
		},
		/**
		 * Removes event listener.
		 * @param {string} type - Event type.
		 * @param {function(object): void} listener - Listener callback.
		 * @returns {void}
		 */
		removeEventListener: (type, listener) => {
			if (!listeners.has(type)) return;
			const list = listeners.get(type);
			const idx = list.indexOf(listener);
			if (idx !== -1) list.splice(idx, 1);
		},
		/**
		 * Dispatches event on document.
		 * @param {object} event - Event object.
		 * @returns {boolean}
		 */
		dispatchEvent: (event) => {
			const list = listeners.get(event.type) || [];
			for (const listener of list) {
				listener(event);
			}
			return true;
		},
	};

	const windowListeners = new Map();
	const win = {
		document: doc,
		console: globalThis.console,
		alerts: [],
		prompts: [],
		/**
		 * Records alert message.
		 * @param {string} msg - Message.
		 * @returns {void}
		 */
		alert: (msg) => {
			win.alerts.push(msg);
		},
		/**
		 * Records prompt and returns mock response.
		 * @param {string} msg - Message.
		 * @returns {string|null} Mock response or null.
		 */
		prompt: (msg) => {
			win.prompts.push(msg);
			return "Mock Prompt Title";
		},
		/**
		 * Adds window event listener.
		 * @param {string} type - Event type.
		 * @param {function(object): void} listener - Listener.
		 * @returns {void}
		 */
		addEventListener: (type, listener) => {
			if (!windowListeners.has(type)) windowListeners.set(type, []);
			windowListeners.get(type).push(listener);
		},
		/**
		 * Removes window event listener.
		 * @param {string} type - Event type.
		 * @param {function(object): void} listener - Listener.
		 * @returns {void}
		 */
		removeEventListener: (type, listener) => {
			if (!windowListeners.has(type)) return;
			const list = windowListeners.get(type);
			const idx = list.indexOf(listener);
			if (idx !== -1) list.splice(idx, 1);
		},
		/**
		 * Posts message to window.
		 * @param {object} data - Message payload.
		 * @param {string} [targetOrigin="*"] - Target origin.
		 * @returns {void}
		 */
		postMessage: (data, targetOrigin = "*") => {
			const event = { data, origin: targetOrigin };
			const list = windowListeners.get("message") || [];
			for (const listener of list) {
				listener(event);
			}
		},
	};

	if (options.isIframe) {
		const topWindowListeners = new Map();
		const topWin = {
			document: doc,
			messages: [],
			addEventListener: (type, listener) => {
				if (!topWindowListeners.has(type))
					topWindowListeners.set(type, []);
				topWindowListeners.get(type).push(listener);
			},
			postMessage: (data, origin = "*") => {
				topWin.messages.push(data);
				const list = topWindowListeners.get("message") || [];
				for (const listener of list) {
					listener({ data, origin });
				}
			},
		};
		win.top = topWin;
	} else {
		win.top = win;
	}

	return {
		window: win,
		document: doc,
		MutationObserver: MockMutationObserver,
	};
}

/**
 * Creates an in-memory mock implementation of the Chrome extension APIs.
 *
 * @param {Record<string, *>} [initialStorage={}] - Initial key-value pairs for local storage.
 * @returns {object} The mock chrome object containing runtime, storage, tabs, and scripting APIs.
 */
export function createMockChrome(initialStorage = {}) {
	const storageData = { ...initialStorage };
	const storageListeners = new Set();
	const messageListeners = [];
	const scriptInjections = [];

	const runtime = {
		onMessage: {
			/**
			 * Registers a runtime message listener.
			 * @param {function(object, object, function(object): void): boolean|void} listener - Listener.
			 * @returns {void}
			 */
			addListener: (listener) => {
				runtime.onMessage.listeners.push(listener);
			},
			/**
			 * Registered listeners array for test inspection.
			 * @type {Array<function(object, object, function(object): void): boolean|void>}
			 */
			listeners: messageListeners,
		},
		/**
		 * Sends a message across extension scripts.
		 * @param {object} message - Message payload.
		 * @param {function(object): void} [callback] - Response callback.
		 * @returns {void}
		 */
		sendMessage: (message, callback) => {
			for (const listener of runtime.onMessage.listeners) {
				const handled = listener(
					message,
					{ id: "mock-sender" },
					callback || (() => {}),
				);
				if (handled) return;
			}
		},
		/**
		 * Resolves extension asset path to a mock URL.
		 * @param {string} assetPath - Relative asset path.
		 * @returns {string} Fully qualified mock URL.
		 */
		getURL: (assetPath) =>
			`chrome-extension://mock-extension-id/${assetPath}`,
	};

	return {
		storage: {
			local: {
				get: (keys, callback) => {
					let result = {};
					if (typeof keys === "string") {
						result[keys] = storageData[keys];
					} else if (Array.isArray(keys)) {
						for (const key of keys) {
							result[key] = storageData[key];
						}
					} else if (keys && typeof keys === "object") {
						result = { ...keys };
						for (const [key, defaultVal] of Object.entries(keys)) {
							if (key in storageData) {
								result[key] = storageData[key];
							} else {
								result[key] = defaultVal;
							}
						}
					} else {
						result = { ...storageData };
					}
					callback(result);
				},
				set: (items, callback) => {
					const changes = {};
					for (const [key, value] of Object.entries(items)) {
						changes[key] = {
							oldValue: storageData[key],
							newValue: value,
						};
						storageData[key] = value;
					}
					for (const listener of storageListeners) {
						listener(changes, "local");
					}
					if (typeof callback === "function") {
						callback();
					}
				},
			},
			onChanged: {
				addListener: (listener) => {
					storageListeners.add(listener);
				},
				removeListener: (listener) => {
					storageListeners.delete(listener);
				},
				dispatch: (changes, areaName = "local") => {
					for (const listener of storageListeners) {
						listener(changes, areaName);
					}
				},
			},
		},
		runtime,
		tabs: {
			/**
			 * Queries tabs matching filter criteria.
			 * @param {object} queryInfo - Tab query filter.
			 * @returns {Promise<Array<object>>} Matching mock tab objects.
			 */
			query: async (queryInfo) => {
				return [
					{
						id: 101,
						active: true,
						currentWindow: true,
						url: "https://notebooklm.google.com/notebook/test",
					},
				];
			},
		},
		scripting: {
			/**
			 * Records and simulates script execution.
			 * @param {object} details - Script execution details.
			 * @returns {Promise<Array<object>>} Execution results.
			 */
			executeScript: async (details) => {
				scriptInjections.push(details);
				return [{ frameId: 0, result: null }];
			},
			/**
			 * Recorded script injections for test assertions.
			 * @type {Array<object>}
			 */
			injections: scriptInjections,
		},
	};
}

/**
 * Creates a mock fetch function that loads extension template files from disk
 * and delegates external URLs (like AnkiConnect) to a test-provided responder.
 *
 * @param {function(string, object=): Promise<object>} [customResponder] - Custom HTTP handler for AnkiConnect calls.
 * @returns {function(string, object=): Promise<object>} Mock fetch implementation.
 */
export function createMockFetch(customResponder) {
	return async (url, options = {}) => {
		const urlStr = String(url);

		// Handle extension templates
		if (urlStr.includes("button.html")) {
			const content = fs.readFileSync(
				path.join(SRC_DIR, "button.html"),
				"utf8",
			);
			return {
				ok: true,
				status: 200,
				text: async () => content,
			};
		}
		if (urlStr.includes("modal.html")) {
			const content = fs.readFileSync(
				path.join(SRC_DIR, "modal.html"),
				"utf8",
			);
			return {
				ok: true,
				status: 200,
				text: async () => content,
			};
		}
		if (urlStr.includes("anki_templates/front.html")) {
			const content = fs.readFileSync(
				path.join(SRC_DIR, "anki_templates/front.html"),
				"utf8",
			);
			return {
				ok: true,
				status: 200,
				text: async () => content,
			};
		}
		if (urlStr.includes("anki_templates/back.html")) {
			const content = fs.readFileSync(
				path.join(SRC_DIR, "anki_templates/back.html"),
				"utf8",
			);
			return {
				ok: true,
				status: 200,
				text: async () => content,
			};
		}
		if (urlStr.includes("anki_templates/styling.css")) {
			const content = fs.readFileSync(
				path.join(SRC_DIR, "anki_templates/styling.css"),
				"utf8",
			);
			return {
				ok: true,
				status: 200,
				text: async () => content,
			};
		}

		if (customResponder) {
			return customResponder(urlStr, options);
		}

		return {
			ok: true,
			status: 200,
			json: async () => ({ result: null, error: null }),
			text: async () => "",
		};
	};
}

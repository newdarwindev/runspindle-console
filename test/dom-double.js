// Explicit minimal DOM double: tests behavior, not browser semantics/layout.
export class ElementDouble {
  /** @param {string} tag @param {any} document */
  constructor(tag, document) {
    this.tag = tag;
    this.ownerDocument = document;
    /** @type {ElementDouble[]} */ this.children = [];
    /** @type {Record<string,string>} */ this.attrs = {};
    this.text = "";
    /** @type {ElementDouble | null} */ this.parent = null;
    this.tabIndex = 0;
    /** @type {Record<string,string>} */ this.style = {};
    /** @type {Map<string, Set<() => void>>} */ this.listeners = new Map();
  }
  /** @param {string} text */
  set textContent(text) {
    this.text = String(text);
    this.children = [];
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  /** @param {any[]} nodes */
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  /** @param {ElementDouble[]} nodes */
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }
  /** @param {string} key @param {string} value */
  setAttribute(key, value) {
    this.attrs[key] = value;
  }
  /** @param {string} key */
  getAttribute(key) {
    return this.attrs[key] ?? null;
  }
  /** @param {string} type @param {() => void} callback */
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(callback);
  }
  /** @param {string} type @param {() => void} callback */
  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }
  click() {
    for (const callback of this.listeners.get("click") ?? []) callback();
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
  }
  /** @param {string} selector @returns {any} */
  querySelector(selector) {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    for (const child of this.children) {
      if (
        match
          ? Object.hasOwn(child.attrs, match[1]) &&
            (match[2] === undefined || child.attrs[match[1]] === match[2])
          : child.tag === selector
      )
        return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

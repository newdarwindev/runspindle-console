import test from "node:test";
import assert from "node:assert/strict";
import { createProjectionView } from "../src/view.js";
import { createProjection } from "../src/projection.js";
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
import { assertProjectionDom } from "./view.assertions.js";

// Explicit minimal DOM double: tests behavior, not browser semantics/layout.
class ElementDouble {
  /** @param {string} tag @param {any} document */
  constructor(tag, document) {
    this.tag = tag;
    this.ownerDocument = document;
    /** @type {ElementDouble[]} */ this.children = [];
    /** @type {Record<string,string>} */ this.attrs = {};
    this.text = "";
    /** @type {ElementDouble | null} */ this.parent = null;
    this.tabIndex = 0;
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
  /** @param {string} key @param {string} value */
  setAttribute(key, value) {
    this.attrs[key] = value;
  }
  /** @param {string} key */
  getAttribute(key) {
    return this.attrs[key] ?? null;
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
test("DOM-double projection rendering; not real browser acceptance", async () => {
  /** @type {any} */
  const document = { activeElement: null, body: null, createElement: null };
  document.createElement = /** @param {string} tag */ (tag) =>
    new ElementDouble(tag, document);
  document.body = document.createElement("body");
  assert.ok(
    (await assertProjectionDom(
      document,
      createProjectionView,
      createProjection,
      consoleScenarios,
    )) >= 30,
  );
});

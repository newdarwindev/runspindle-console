import test from "node:test";
import assert from "node:assert/strict";
import { createProjectionView } from "../src/view.js";
import { createProjection } from "../src/projection.js";
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
import { assertProjectionDom } from "./view.assertions.js";

import { ElementDouble } from "./dom-double.js";

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

// Real DOM/History only. Transport remains explicitly synthetic and read-only.
/** @param {Window} browser @param {Function} makeNavigator @param {Function} makeHistory @param {Function} makeStream @param {any} scenarios @param {any} catalog */
export async function assertNavigationBrowser(
  browser,
  makeNavigator,
  makeHistory,
  makeStream,
  scenarios,
  catalog,
) {
  const document = browser.document;
  let assertions = 0;
  /** @param {unknown} condition @param {string} message */
  function check(condition, message) {
    assertions++;
    if (!condition) throw new Error(message);
  }
  const root = document.createElement("main");
  document.body.append(root);
  const url = browser.location.href;
  browser.history.replaceState({ sentinel: "preserved" }, "");
  let subscriptions = 0,
    closes = 0,
    views = 0;
  const stream = makeStream({
    clock: () => 1000,
    subscribe: () => {
      subscriptions++;
      return {
        close: () => {
          closes++;
        },
      };
    },
    readSnapshot: /** @param {unknown} identity */ (identity) => ({
      ...scenarios.observation,
      identity,
    }),
    openPassive: () => {
      views++;
      throw new Error("forbidden passive open");
    },
  });
  const navigator = makeNavigator(root, {
    catalog: [...catalog],
    stream,
    history: makeHistory(browser),
  });
  /** @param {string} selector @returns {HTMLElement} */
  function required(selector) {
    const node = root.querySelector(selector);
    if (!node) throw new Error("missing navigation node");
    return /** @type {HTMLElement} */ (node);
  }
  /** @param {string} key */
  const button = (key) => required(`[data-task-key="${key}"]`);
  /** @param {string} task */
  async function waitTask(task) {
    for (let n = 0; n < 100; n++) {
      if (
        required('[data-field="task"]').textContent === task &&
        required('[data-field="label"]').textContent ===
          scenarios.observation.label
      )
        return;
      await new Promise((resolve) => browser.setTimeout(resolve, 5));
    }
    throw new Error("history navigation timeout");
  }
  /** @param {"back" | "forward"} direction */
  async function travel(direction) {
    await new Promise((resolve, reject) => {
      const timeout = browser.setTimeout(() => {
        browser.removeEventListener("popstate", listener);
        reject(new Error("history navigation timeout"));
      }, 500);
      const listener = () => {
        browser.clearTimeout(timeout);
        resolve(undefined);
      };
      browser.addEventListener("popstate", listener, { once: true });
      browser.history[direction]();
    });
  }
  try {
    check(await navigator.navigate("a"), "first task navigation");
    check(await navigator.navigate("b"), "second task navigation");
    const length = browser.history.length;
    const count = subscriptions;
    button("b").click();
    await Promise.resolve();
    check(
      browser.history.length === length && subscriptions === count,
      "repeated selection creates no history or subscription",
    );
    check(
      browser.history.state.sentinel === "preserved" &&
        browser.location.href === url,
      "history preserves other state and URL",
    );
    await travel("back");
    await waitTask("task-a");
    check(
      document.activeElement === button("a") &&
        button("a").getAttribute("aria-current") === "page",
      "Back restores selected identity and focus",
    );
    await travel("forward");
    await waitTask("task-b");
    check(
      document.activeElement === button("b") &&
        button("b").getAttribute("aria-current") === "page",
      "Forward restores selected identity and focus",
    );
    check(
      browser.history.length === length,
      "popstate creates no replacement history",
    );
    check(
      root.querySelector("nav")?.getAttribute("aria-label") === "Tasks",
      "navigation has accessible name",
    );
    check(views === 0, "navigation never opens passive viewer");
    await travel("back");
    await waitTask("task-a");
    const beforeUnknown = subscriptions;
    await travel("back");
    check(
      required('[data-field="task"]').textContent === "Unknown" &&
        required('[data-field="label"]').textContent === "Unknown",
      "unselected history clears old identity and data",
    );
    check(
      subscriptions === beforeUnknown &&
        button("a").getAttribute("aria-current") === "false",
      "unknown history starts no observation",
    );
    navigator.dispose();
    const final = subscriptions;
    await travel("forward");
    await new Promise((resolve) => browser.setTimeout(resolve, 20));
    check(
      subscriptions === final && closes === subscriptions,
      "disposed navigation has no new subscription and closes owned streams",
    );
    check(root.children.length === 0, "disposed navigation removes owned DOM");
  } finally {
    navigator.dispose();
    root.remove();
  }
  return assertions;
}

import { createProjectionView } from "./view.js";

/** @typedef {{key: string, label: string, identity: Readonly<Record<string, unknown>>}} Task */
/** @typedef {{current: () => unknown, push: (key: string) => void, subscribe: (listener: (key: unknown) => void) => (() => void)}} TaskHistory */
/**
 * Read-only task navigation over trusted synthetic catalog/stream adapters.
 * The navigator owns stream disposal and its history subscription, not History.
 * @param {HTMLElement} root
 * @param {{catalog: Task[], stream: any, history: TaskHistory}} options
 */
export function createTaskNavigator(root, { catalog, stream, history }) {
  if (!Array.isArray(catalog) || catalog.length > 100 || !stream || !history)
    throw new TypeError("invalid navigator dependencies");
  const tasks = new Map();
  for (const task of catalog) {
    if (
      !task ||
      typeof task.key !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(task.key) ||
      tasks.has(task.key) ||
      typeof task.label !== "string" ||
      task.label.length < 1 ||
      task.label.length > 256
    )
      throw new TypeError("invalid task catalog");
    tasks.set(
      task.key,
      Object.freeze({ ...task, identity: Object.freeze({ ...task.identity }) }),
    );
  }
  const document = root.ownerDocument;
  const container = document.createElement("section");
  container.setAttribute("aria-label", "Synthetic read-only task navigation");
  const navigation = document.createElement("nav");
  navigation.setAttribute("aria-label", "Tasks");
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.textContent =
    "Synthetic catalog. No runtime task discovery or control.";
  const content = document.createElement("div");
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.textContent = "Retry observation";
  retryButton.setAttribute("data-retry-observation", "");
  retryButton.disabled = true;
  container.append(navigation, message, retryButton, content);
  root.append(container);
  let disposed = false,
    generation = 0;
  /** @type {string | null} */ let selected = null;
  let unavailable = true;
  let connecting = false;
  function readSelectedState() {
    const identity = selected === null ? null : tasks.get(selected)?.identity;
    const unknown = { status: "unknown", identity, record: null };
    if (unavailable) return unknown;
    const state = stream.state();
    if (
      !identity ||
      !state?.identity ||
      Object.keys(identity).length !== Object.keys(state.identity).length ||
      !Object.entries(identity).every(
        ([key, value]) => state.identity[key] === value,
      )
    )
      return unknown;
    if (connecting)
      return {
        ...unknown,
        status: ["offline", "error", "unknown", "unsupported"].includes(
          state.status,
        )
          ? state.status
          : "loading",
      };
    return state;
  }
  const view = createProjectionView(content, { readState: readSelectedState });
  /** @type {Map<string, HTMLButtonElement>} */ const buttons = new Map();
  /** @type {Array<() => void>} */ const removers = [];
  /** @type {(() => void) | null} */ let unsubscribe = null;

  /** @param {unknown} key @param {boolean} [focus] @param {boolean} [retry] @returns {Promise<boolean>} */
  async function select(key, focus = false, retry = false) {
    if (disposed) return false;
    const task = typeof key === "string" ? tasks.get(key) : undefined;
    if (task && selected === key && !unavailable && !retry) return !connecting;
    const ticket = ++generation;
    selected = task ? task.key : null;
    unavailable = !task;
    connecting = !!task;
    retryButton.disabled = !task || connecting;
    for (const [id, button] of buttons)
      button.setAttribute("aria-current", id === selected ? "page" : "false");
    if (!task) {
      try {
        stream.disconnect();
      } catch {
        /* Unknown selection is never old data. */
      }
      message.textContent = "Unknown task. No observation selected.";
      view.update();
      return false;
    }
    if (focus) buttons.get(task.key)?.focus();
    message.textContent = "Synthetic task selected. Read-only observation.";
    try {
      if (retry) {
        // Reuse the stream owner: it fences callbacks and refuses acquisition
        // when cleanup is unknown. A UI retry never overrides that refusal.
        stream.disconnect();
        if (disposed || ticket !== generation) return false;
      }
      const pending = stream.connect(task.identity);
      view.update();
      const result = await pending;
      if (disposed || ticket !== generation) return false;
      connecting = false;
      retryButton.disabled = false;
      if (result !== true) {
        unavailable = true;
        message.textContent = "Observation unavailable.";
        try {
          stream.disconnect();
        } catch {
          /* Refused admission is not readiness. */
        }
      }
      view.update();
      return result === true;
    } catch {
      if (!disposed && ticket === generation) {
        unavailable = true;
        connecting = false;
        retryButton.disabled = false;
        try {
          stream.disconnect();
        } catch {
          /* Never display old task data. */
        }
        message.textContent = "Observation unavailable.";
        view.update();
      }
      return false;
    }
  }
  /** @param {string} key */
  async function navigate(key) {
    if (disposed || !tasks.has(key)) return false;
    if (selected === key && !unavailable) return !connecting;
    if (selected === key && unavailable) return select(key, true);
    try {
      history.push(key);
    } catch {
      message.textContent = "Navigation unavailable. Selection unchanged.";
      return false;
    }
    return select(key, true);
  }
  function retryAvailable() {
    if (disposed || selected === null) return false;
    if (!connecting) return true;
    const ticket = generation;
    try {
      const status = stream.state().status;
      // A terminal subscription can outlive its unresolved snapshot promise.
      // Loading still suppresses duplicates; the stream owns cleanup admission.
      return (
        !disposed &&
        ticket === generation &&
        (status === "offline" || status === "error")
      );
    } catch {
      return false;
    }
  }
  async function retryObservation() {
    if (!retryAvailable()) return false;
    return select(selected, false, true);
  }
  const retryListener = () => {
    void retryObservation();
  };
  retryButton.addEventListener("click", retryListener);
  removers.push(() => retryButton.removeEventListener("click", retryListener));
  for (const [key, task] of tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = task.label;
    // Keep full task identity visible when a catalog label has no break points.
    button.style.maxWidth = "100%";
    button.style.overflowWrap = "anywhere";
    button.setAttribute("data-task-key", key);
    button.setAttribute("aria-current", "false");
    const listener = () => {
      void navigate(key);
    };
    button.addEventListener("click", listener);
    removers.push(() => button.removeEventListener("click", listener));
    buttons.set(key, button);
    navigation.append(button);
  }
  function update() {
    if (disposed) return false;
    retryButton.disabled = !retryAvailable();
    return view.update();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    for (const remove of removers) remove();
    try {
      unsubscribe?.();
    } catch {
      /* No cleanup confirmation is inferred. */
    } finally {
      try {
        stream.dispose();
      } catch {
        /* Trusted adapter owns resource cleanup. */
      } finally {
        view.dispose();
        container.remove();
      }
    }
  }
  try {
    unsubscribe = history.subscribe((key) => {
      void select(key, true);
    });
    if (typeof unsubscribe !== "function")
      throw new TypeError("missing history cleanup");
    void select(history.current());
  } catch {
    dispose();
    throw new Error("navigation initialization unavailable");
  }
  return Object.freeze({ navigate, retryObservation, update, dispose });
}

/**
 * Browser History adapter: namespaced state only, never rewrites/navigates a URL.
 * Browser integration remains unqualified until exercised in a real browser.
 * @param {Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>} browser
 * @returns {TaskHistory}
 */
export function createBrowserTaskHistory(browser) {
  const property = "runspindleConsoleTask";
  function current() {
    const state = browser.history.state;
    return state && typeof state === "object" && Object.hasOwn(state, property)
      ? state[property]
      : null;
  }
  /** @param {string} key */
  function push(key) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key))
      throw new TypeError("invalid task key");
    const state = browser.history.state;
    if (state !== null && (typeof state !== "object" || Array.isArray(state)))
      throw new TypeError("incompatible history state");
    browser.history.pushState({ ...state, [property]: key }, "");
  }
  /** @param {(key:unknown)=>void} listener */
  function subscribe(listener) {
    const callback = () => listener(current());
    browser.addEventListener("popstate", callback);
    return () => browser.removeEventListener("popstate", callback);
  }
  return Object.freeze({ current, push, subscribe });
}

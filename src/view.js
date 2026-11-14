// Original read-only DOM surface for the provisional process-local projection.
const IDENTITY_FIELDS = [
  "task",
  "host",
  "workspace",
  "nativeSession",
  "browser",
  "leaseEpoch",
  "trace",
  "span",
  "artifactDigest",
];
const VIEW_STATUSES = new Set([
  "empty",
  "loading",
  "error",
  "stale",
  "offline",
  "unknown",
  "unsupported",
  "ready",
]);
const VIEW_AUTHORITIES = new Set([
  "unknown",
  "pending",
  "denied",
  "agent",
  "human",
  "handback_pending",
]);
const VIEW_EVIDENCE = new Set([
  "synthetic_component",
  "isolated_integration",
  "live_acceptance",
  "retained_local",
]);

/** @param {unknown} value @param {number} [limit] @returns {string} */
function displayText(value, limit = 4096) {
  if (typeof value === "string" && value.length > 0 && value.length <= limit)
    return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return "Unknown";
}

/**
 * Mount a read-only surface. Call update after an observation or clock change.
 * The trusted reader supplies createProjection/createStreamProjection state;
 * this is NOT a wire-envelope parser, authorization gate, or secret sanitizer.
 * @param {HTMLElement} root
 * @param {{readState: () => any}} options
 */
export function createProjectionView(root, { readState }) {
  if (!root || !root.ownerDocument || typeof readState !== "function")
    throw new TypeError("invalid view dependencies");
  const document = root.ownerDocument;
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Read-only task projection");
  panel.setAttribute("data-console-projection", "");
  panel.tabIndex = -1;
  const heading = document.createElement("h2");
  heading.textContent = "Task projection";
  const notice = document.createElement("p");
  notice.textContent =
    "Read-only observation. No execution or control capability.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const list = document.createElement("dl");
  /** @type {Map<string, HTMLElement>} */
  const fields = new Map();
  const descriptions = [
    ...IDENTITY_FIELDS.map((key) => [key, key]),
    ["label", "Observation"],
    ["freshness", "Freshness"],
    ["observedAt", "Observed at (Unix milliseconds)"],
    ["revision", "Revision"],
    ["evidenceClass", "Reported evidence class (not independently verified)"],
    ["authority", "Reported authority (cannot grant control)"],
    ["gap", "Event continuity"],
    ["simulation", "View provenance"],
    ["view", "Desktop view"],
    ["acceptance", "Artifact acceptance"],
    ["delivery", "Delivery"],
  ];
  for (const [key, label] of descriptions) {
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.setAttribute("data-field", key);
    value.textContent = "Unknown";
    fields.set(key, value);
    list.append(term, value);
  }
  panel.append(heading, notice, status, list);
  root.append(panel);
  let disposed = false;
  /** @param {string} key @param {unknown} value */
  function put(key, value) {
    const node = fields.get(key);
    if (node) node.textContent = displayText(value);
  }
  function update() {
    if (disposed) return false;
    // Read fully before touching the DOM, so a broken reader/getter cannot
    // leave the previous task's identities under a newly selected task label.
    /** @type {Record<string, unknown>} */
    let values = {};
    let visibleStatus = "unknown";
    try {
      const state = readState();
      visibleStatus = VIEW_STATUSES.has(state?.status)
        ? state.status
        : "unknown";
      for (const key of IDENTITY_FIELDS)
        values[key] = displayText(state?.identity?.[key], 256);
      const record = state?.record;
      values.label = displayText(record?.label);
      values.freshness = ["fresh", "stale", "unknown"].includes(
        state?.freshness,
      )
        ? state.freshness
        : "unknown";
      values.observedAt = displayText(record?.observedAt);
      values.revision = displayText(record?.revision);
      values.evidenceClass = VIEW_EVIDENCE.has(record?.evidenceClass)
        ? record.evidenceClass
        : "unknown";
      values.authority = VIEW_AUTHORITIES.has(state?.authority)
        ? state.authority
        : "unknown";
      values.gap =
        record?.gap === true
          ? "Gap: incomplete observation history"
          : record?.gap === false
            ? "No gap reported"
            : "Unknown";
      values.simulation =
        record?.simulated === true
          ? "SIMULATED — synthetic component observation"
          : "Source unverified — no qualified desktop integration";
    } catch {
      values = {};
      visibleStatus = "unknown";
    }
    status.textContent = `Status: ${visibleStatus}`;
    for (const key of fields.keys()) put(key, values[key]);
    put("view", "Unavailable in this read-only surface. No viewer opened.");
    put("acceptance", "Unknown — not supplied by this projection");
    put("delivery", "Unknown — not supplied by this projection");
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    panel.remove();
    fields.clear();
  }
  update();
  return Object.freeze({ update, dispose });
}

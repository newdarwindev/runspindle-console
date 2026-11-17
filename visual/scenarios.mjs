// Original synthetic reference annotations. Not a runtime adapter or authority engine.
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
export const visualIdentity = Object.freeze({
  ...consoleScenarios.identity,
  nativeSession: "native-synthetic-007",
  span: "span-synthetic-1",
  artifactDigest: "7".repeat(64),
});
const defaults = {
  status: "ready",
  freshness: "fresh",
  observedAt: 1000,
  authority: "denied",
  gap: false,
  desktop: "Unavailable — no desktop adapter is connected",
  authorityPresentation:
    "No interactive control. This reference cannot grant authority.",
  reason: "Control is not implemented in this local reference.",
  telemetry: "Readback unknown — no backend readback qualified",
  acceptance: "Not accepted — no validation receipt supplied",
  delivery: "Unknown — no exact delivery receipt",
  receipt: "receipt-synthetic-unconfirmed",
  revision: 1,
  note: "Synthetic state only. Backend and live-provider acceptance remain separate.",
  interaction: "inspect-only",
  long: false,
};
const row = (id, title, patch = {}) =>
  Object.freeze({ ...defaults, id, title, ...patch });
export const visualScenarios = Object.freeze([
  ...consoleScenarios.statuses.map((status) =>
    row(
      status === "ready" ? "fresh" : status,
      status === "ready"
        ? "Fresh observation"
        : status[0].toUpperCase() + status.slice(1),
      {
        status,
        freshness:
          status === "ready"
            ? "fresh"
            : status === "stale"
              ? "stale"
              : "unknown",
        observedAt: ["empty", "loading", "unknown", "unsupported"].includes(
          status,
        )
          ? null
          : 1000,
        note:
          status === "stale"
            ? "Retained source observation is stale; it is not a live update."
            : defaults.note,
      },
    ),
  ),
  row("missing-timestamp", "Timestamp missing", {
    freshness: "unknown",
    observedAt: null,
    note: "Missing source time must never look fresh.",
  }),
  row("desktop-unavailable", "Desktop unavailable"),
  row("desktop-unauthorized", "Desktop unauthorized", {
    desktop: "Unauthorized — no view permission established",
    authorityPresentation:
      "Viewing permission is absent; control remains unavailable.",
  }),
  row("desktop-disconnected", "Desktop disconnected", {
    status: "offline",
    freshness: "unknown",
    desktop: "Disconnected — previous frame is not live",
    note: "No retained frame is presented as current.",
  }),
  row("desktop-reconnect", "Desktop reconnecting", {
    status: "loading",
    freshness: "unknown",
    desktop: "Reconnect pending — waiting for a new verified observation",
    note: "A reconnect request is not a fresh frame or control grant.",
  }),
  row("takeover-pending", "Takeover pending", {
    authority: "pending",
    authorityPresentation:
      "Takeover requested — awaiting an authenticated grant",
    reason: "Pending request is not authority; interactive input disabled.",
  }),
  row("takeover-denied", "Takeover denied", {
    authorityPresentation: "Takeover denied by the reference decision",
    reason: "Denied request cannot enable input.",
  }),
  row("takeover-granted", "Reported grant", {
    authority: "human",
    authorityPresentation:
      "Synthetic grant reported for holder-synthetic-a; no real control attached",
    reason: "A rendered grant label cannot create backend authority.",
  }),
  row("stale-epoch", "Stale lease epoch", {
    freshness: "stale",
    authority: "unknown",
    authorityPresentation: "Observed epoch 1 conflicts with expected epoch 2",
    reason: "Stale epoch: do not accept interactive input.",
  }),
  row("wrong-holder", "Wrong holder", {
    authority: "unknown",
    authorityPresentation:
      "Reported holder-synthetic-b differs from selected holder-synthetic-a",
    reason: "Holder mismatch: control remains disabled.",
  }),
  row("wrong-target", "Wrong target", {
    authority: "unknown",
    authorityPresentation:
      "Reported browser-other differs from browser-synthetic",
    reason: "Target mismatch: no alternate target control.",
  }),
  row("wrong-account", "Wrong account", {
    authority: "unknown",
    authorityPresentation:
      "Reported account-other differs from account-synthetic",
    reason: "Account mismatch: no credential or control action.",
  }),
  row("release-pending", "Release pending", {
    authority: "handback_pending",
    authorityPresentation:
      "Release requested — waiting for confirmed revocation",
    reason: "Release request is not confirmed handback.",
  }),
  row("closure-timeout", "Closure timed out", {
    authority: "unknown",
    authorityPresentation:
      "Closure timeout — ownership outcome remains unknown",
    reason: "Timeout cannot prove release or enable another holder.",
  }),
  row("incomplete-handback", "Incomplete handback", {
    authority: "handback_pending",
    authorityPresentation:
      "Handback incomplete — no exclusive-owner confirmation",
    reason: "No new controller until fenced handback is confirmed.",
  }),
  row("telemetry-queued", "Telemetry queued", {
    telemetry: "Queued locally — not exported or persisted",
    receipt: "telemetry-synthetic-queued",
  }),
  row("telemetry-exported", "Telemetry exported", {
    telemetry: "Export acknowledged — persistence not verified",
    receipt: "telemetry-synthetic-export-ack",
  }),
  row("telemetry-persisted", "Telemetry persisted", {
    telemetry:
      "Synthetic persistence receipt present — readback still not verified",
    receipt: "telemetry-synthetic-persistence",
  }),
  row("telemetry-readback", "Telemetry read back", {
    telemetry:
      "Synthetic exact readback receipt present — no real backend claim",
    receipt: "telemetry-synthetic-readback",
  }),
  row("duplicate-events", "Duplicate observation", {
    telemetry:
      "Duplicate sequence 7 ignored in storyboard; no second persistence claim",
    note: "Duplicate/lost/queued/exported/persisted are separate observations.",
  }),
  row("event-gap", "Event gap", {
    gap: true,
    freshness: "unknown",
    telemetry: "Sequence gap 7 → 9 — event 8 not observed",
    note: "Missing telemetry is visible, not silently filled.",
  }),
  row("out-of-order", "Out-of-order observation", {
    gap: true,
    freshness: "stale",
    telemetry: "Sequence 6 arrived after 7 — retained as stale reference",
    note: "Older observations must not replace a newer task or timestamp.",
  }),
  row("accepted-delivery-unknown", "Accepted artifact, delivery unknown", {
    acceptance: "Accepted exact digest: " + visualIdentity.artifactDigest,
    delivery: "Unknown — no matching delivered receipt",
    receipt: "artifact-synthetic-acceptance-only",
    note: "Validation/acceptance is not transport delivery. No generated preview proves bytes delivered.",
  }),
  row("long-identities", "Long identity and text", {
    long: true,
    note: "Long identifiers and observation labels remain complete, wrap safely, and do not hide freshness or authority.",
  }),
  row("task-switch-late", "Task switch with late response", {
    interaction: "late-switch",
    note: "Select task B while task A observation is pending; late A cannot relabel B.",
  }),
  row("repeated-clicks", "Repeated selection", {
    interaction: "repeated",
    note: "Repeated selection is navigation only; it must not create control or duplicate observation work.",
  }),
  row("back-forward", "Back and Forward", {
    interaction: "history",
    note: "Browser history restores selected synthetic task identity and focus; no control operation.",
  }),
  row("cancel-close", "Cancel, Close and focus restoration", {
    interaction: "preview",
    note: "Only the local simulated-reference dialog opens. Cancel/Close returns focus; no desktop session is acquired.",
  }),
]);

export function referenceState(scenario) {
  const id = scenario.long
    ? {
        ...visualIdentity,
        task: consoleScenarios.longIdentity,
        host: "host-" + "h".repeat(240),
      }
    : visualIdentity;
  return {
    status: scenario.status,
    freshness: scenario.freshness,
    authority: scenario.authority,
    identity: id,
    record: {
      ...consoleScenarios.observation,
      observedAt: scenario.observedAt,
      revision: scenario.revision,
      authority: scenario.authority,
      label: scenario.long
        ? consoleScenarios.hostileText +
          " — " +
          "Long synthetic observation. ".repeat(22)
        : scenario.title,
      simulated: true,
      gap: scenario.gap,
    },
  };
}

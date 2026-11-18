/* global document, HTMLSelectElement */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ObservationShell } from "./shell.mjs";
import { visualScenarios, referenceState } from "../visual/scenarios.mjs";
const h = React.createElement;
const unknown = visualScenarios.find((s) => s.id === "unknown");
if (!unknown) throw Error("missing unknown scenario");
export const scenarios = [
  ...visualScenarios,
  {
    ...unknown,
    id: "effect-unknown",
    title: "External effect unknown",
    note: "An unconfirmed effect must be reconciled, not retried from this view.",
  },
  {
    ...unknown,
    id: "approval-required",
    title: "Approval required",
    authority: "pending",
    note: "Approval remains pending. This label is not permission and cannot authorize execution.",
  },
];
function App() {
  const [id, select] = useState("fresh");
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) throw Error("invalid scenario");
  return h(
    "main",
    { id: "reference" },
    h(
      "header",
      null,
      h("p", { className: "eyebrow" }, "RUNSPINDLE / OBSERVATION WORKSPACE"),
      h("h1", null, "Know what is observed. Keep authority separate."),
    ),
    h("label", { htmlFor: "scenario" }, "Synthetic scenario"),
    h(
      "select",
      {
        id: "scenario",
        value: id,
        onChange: (e) => {
          if (e.target instanceof HTMLSelectElement) select(e.target.value);
        },
      },
      scenarios.map((s) => h("option", { key: s.id, value: s.id }, s.title)),
    ),
    h(ObservationShell, {
      state: referenceState(scenario),
      annotation: scenario.note,
    }),
    h(
      "footer",
      null,
      "Synthetic component demonstration. No live fleet, desktop or provider qualification.",
    ),
  );
}
const app = document.getElementById("app");
if (!app) throw Error("application root missing");
createRoot(app).render(h(App));

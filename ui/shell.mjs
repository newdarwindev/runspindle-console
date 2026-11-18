// Generic React/Radix presentation only. Domain decisions remain in src/view.js.
import React, { useLayoutEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { createProjectionView } from "../src/view.js";
const h = React.createElement;

/** @param {{state: unknown}} props */
export function Projection({ state }) {
  const element = useRef(/** @type {HTMLDivElement | null} */ (null));
  const current = useRef(state);
  const view = useRef(
    /** @type {ReturnType<typeof createProjectionView> | null} */ (null),
  );
  current.current = state;
  useLayoutEffect(() => {
    if (!element.current) throw Error("projection root missing");
    view.current = createProjectionView(element.current, {
      readState: () => current.current,
    });
    view.current.update();
    return () => {
      view.current?.dispose();
      view.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    view.current?.update();
  }, [state]);
  return h("div", { ref: element, "data-domain-projection": "" });
}

/** @param {{state: unknown, annotation?: string}} props */
export function ObservationShell({ state, annotation = "" }) {
  return h(
    "section",
    { className: "observation-shell" },
    h(
      "p",
      { className: "notice" },
      "SIMULATED · Read-only observation · No live backend",
    ),
    h(Projection, { state }),
    h(
      Dialog.Root,
      null,
      h(Dialog.Trigger, { className: "inspect" }, "Inspect evidence boundary"),
      h(
        Dialog.Portal,
        null,
        h(Dialog.Overlay, { className: "overlay" }),
        h(
          Dialog.Content,
          { className: "dialog" },
          h(Dialog.Title, null, "Observation is not authority"),
          h(
            Dialog.Description,
            null,
            "These are synthetic observations. Viewing, approval labels and takeover labels do not grant control or confirm an external effect.",
          ),
          h("p", { "data-annotation": "" }, annotation),
          h(
            "p",
            null,
            "No approval, takeover, send or retry endpoint is connected.",
          ),
          h(Dialog.Close, { className: "cancel" }, "Cancel inspection"),
          h(Dialog.Close, { className: "close" }, "Close inspection"),
        ),
      ),
    ),
  );
}

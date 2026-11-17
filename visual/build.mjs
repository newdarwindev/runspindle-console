// Deterministic file-local bundle using the existing keyboard harness source seam.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { visualScenarios, referenceState } from "./scenarios.mjs";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const SOURCES = [
  "src/projection.js",
  "src/view.js",
  "src/stream.js",
  "src/navigation.js",
  "fixtures/console-ui/scenarios.js",
  "visual/scenarios.mjs",
  "visual/page.mjs",
];
/** @param {string | Uint8Array} data */
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
export function build() {
  /** @type {Record<string,string>} */
  const sources = {};
  const script = SOURCES.map((name) => {
    const original = fs.readFileSync(path.join(ROOT, name), "utf8");
    sources[name] = sha(original);
    const flattened = original
      .replace(
        /^import \{[^}]+\} from ['"](?:\.\/|\.\.\/)[^'"\n]+['"];\n/gm,
        "",
      )
      .replaceAll("export ", "");
    if (/^import /m.test(flattened))
      throw Error("unreviewed module import in " + name);
    return flattened;
  }).join("\n");
  new vm.Script(script); // Compile only; never run DOM code in the builder.
  const css = fs.readFileSync(path.join(ROOT, "visual/layout.css"), "utf8");
  for (const name of ["visual/layout.css", "visual/build.mjs"])
    sources[name] = sha(fs.readFileSync(path.join(ROOT, name)));
  const manifest = {
    schema: "runspindle.console-visual.v1",
    evidence_class: "synthetic_local_reference_only",
    actual_ui: "not_run",
    parents: [
      "runspindle-console#1",
      "runspindle-console#3",
      "runspindle-browser#9",
      "runspindle#13",
      "runspindle#15",
      "runspindle#16",
    ],
    clock: 1000,
    seed: "fixed invented scenarios; no randomness",
    source_sha256: sources,
    scenarios: visualScenarios.map((s) => {
      const state = referenceState(s);
      return {
        id: s.id,
        title: s.title,
        interaction: s.interaction,
        parent_criteria:
          s.id.startsWith("telemetry") ||
          ["event-gap", "out-of-order", "duplicate-events"].includes(s.id)
            ? [
                "F12/H09 source identity and freshness",
                "H08 telemetry acceptance versus readback",
              ]
            : [
                "F12/H09 truthful console projection",
                "F08/H06 authority presentation only",
              ],
        expected_visible: [
          s.title,
          "SIMULATED",
          s.desktop,
          s.authorityPresentation,
          s.reason,
          s.telemetry,
          s.acceptance,
          s.delivery,
          s.note,
        ],
        expected_fields: {
          fleet: "fleet-synthetic-01",
          source: "synthetic-console-fixture",
          sourceTimestamp:
            s.observedAt === null
              ? "Unknown — source timestamp missing"
              : "1970-01-01T00:00:01.000Z (fixed synthetic source time)",
          account: "account-synthetic",
          holder: "holder-synthetic-a",
          receipt: s.receipt,
          telemetry: s.telemetry,
          acceptance: s.acceptance,
          delivery: s.delivery,
          desktop: s.desktop,
          authorityPresentation: s.authorityPresentation,
          controlReason: s.reason,
        },
        expected_projection: {
          ...Object.fromEntries(
            Object.entries(state.identity).map(([k, v]) => [k, String(v)]),
          ),
          label: state.record.label,
          evidenceClass: "synthetic_component",
          view: "Unavailable in this read-only surface. No viewer opened.",
          freshness: s.freshness,
          observedAt: s.observedAt === null ? "Unknown" : String(s.observedAt),
          revision: String(s.revision),
          authority: s.authority,
          gap: s.gap
            ? "Gap: incomplete observation history"
            : "No gap reported",
          simulation: "SIMULATED — synthetic component observation",
          acceptance: "Unknown — not supplied by this projection",
          delivery: "Unknown — not supplied by this projection",
        },
        expected_actions: [
          {
            id: "request-control",
            label: "Request control (unavailable)",
            disabled: true,
            reason_id: "control-reason",
            reason: s.reason,
          },
          {
            id: "release-control",
            label: "Release control (unavailable)",
            disabled: true,
            reason_id: "control-reason",
            reason: s.reason,
          },
        ],
        expected_status: s.status,
        actual_ui: "not_run",
      };
    }),
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-console-reference'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>Runspindle console · synthetic visual reference</title><style>${css}</style></head><body data-ready="false"><header class="top"><div class="eyebrow">RUNSPINDLE / LOCAL VISUAL REFERENCE</div><h1>Observe without inventing certainty</h1><p>SIMULATED · Generated reference, not a live fleet or desktop</p></header><div class="shell"><section class="selector" aria-label="Reference scenario"><label for="scenario">Choose a synthetic state</label><select id="scenario"></select><p>No accounts, provider calls, credential access or execution controls.</p></section><main id="reference"><div class="case-title"><div><h2 id="scenario-title"></h2><p id="scenario-note"></p></div><span class="badge">SIMULATED / NOT LIVE</span></div><div class="grid"><div><section class="panel" aria-label="Canonical read-only projection"><p class="scope">Existing product DOM renderer, supplied only with invented fixture state.</p><div id="projection"></div></section></div><div><section class="panel annotations" aria-labelledby="story-heading"><h2 id="story-heading">Intended-state annotations</h2><p class="annotation-label">Reference storyboard only. These labels are not implemented backend receipts or authority.</p><dl><dt>Fleet</dt><dd data-visual-field="fleet"></dd><dt>Observation source</dt><dd data-visual-field="source"></dd><dt>Source timestamp</dt><dd data-visual-field="sourceTimestamp"></dd><dt>Account binding</dt><dd data-visual-field="account"></dd><dt>Holder binding</dt><dd data-visual-field="holder"></dd><dt>Receipt identity</dt><dd data-visual-field="receipt"></dd><dt>Telemetry/readback</dt><dd data-visual-field="telemetry"></dd><dt>Exact artifact acceptance</dt><dd data-visual-field="acceptance"></dd><dt>Delivery outcome</dt><dd data-visual-field="delivery"></dd></dl></section><section class="panel" aria-labelledby="desktop-heading"><h2 id="desktop-heading">Desktop and control boundary</h2><div id="simulated-frame" class="simulated-frame" role="img"><strong data-simulated-marker>SIMULATED — NOT A REAL DESKTOP</strong><pre>┌ Synthetic workspace ┐
No real pixels or input.
View status is below.
└ Reference only ┘</pre></div><p data-visual-field="desktop"></p><p data-visual-field="authorityPresentation"></p><div class="actions"><button id="inspect-preview" type="button">Inspect simulated frame</button><button id="request-control" type="button" data-authority-action disabled aria-describedby="control-reason">Request control (unavailable)</button><button id="release-control" type="button" data-authority-action disabled aria-describedby="control-reason">Release control (unavailable)</button></div><p id="control-reason" class="reason" data-visual-field="controlReason"></p></section></div></div><section class="panel nav-demo" id="navigation-demo" hidden aria-labelledby="nav-heading"><h2 id="nav-heading">Existing navigation, synthetic transport</h2><p>Actual read-only navigation and stream modules; no backend connection. Task identity below is independently scoped.</p><div class="demo-actions"><button id="history-back" type="button">Back in synthetic task history</button><button id="history-forward" type="button">Forward in synthetic task history</button><button id="late-response" type="button" hidden>Release old task A response</button></div><div id="navigation-root"></div></section><footer id="reference-footer" class="footer">END OF SYNTHETIC REFERENCE · Native integration, authority enforcement, delivery and persistence are not qualified by this picture.</footer></main></div><dialog id="preview-dialog" aria-labelledby="preview-title"><h2 id="preview-title">SIMULATED reference preview</h2><p>This is a local illustration, not a passive desktop session. No real view, keyboard or pointer channel is opened.</p><div class="simulated-frame" role="img" aria-label="SIMULATED placeholder only, no actual desktop"><strong>SIMULATED — NO LIVE SCREEN</strong><pre>Synthetic task workspace
No interactive input attached.</pre></div><div class="actions"><button id="preview-cancel" type="button">Cancel reference preview</button><button id="preview-close" type="button">Close reference preview</button></div></dialog><script nonce="console-reference">${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  return { html, manifest };
}
/** @param {string} destination */
export function publish(destination) {
  if (fs.existsSync(destination))
    throw Error("refuse existing output directory");
  const { html, manifest } = build();
  fs.mkdirSync(destination, { recursive: false });
  try {
    fs.writeFileSync(path.join(destination, "index.html"), html);
    fs.writeFileSync(
      path.join(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 4 || process.argv[2] !== "--output")
    throw Error("usage: node visual/build.mjs --output NEW_DIRECTORY");
  const manifest = publish(path.resolve(process.argv[3]));
  console.log(
    JSON.stringify({
      status: "source_generated_not_rendered",
      scenarios: manifest.scenarios.length,
    }),
  );
}

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(
  process.argv[2] || path.join(root, "../dist/observation"),
);
if (fs.existsSync(output)) throw Error("new output directory required");
fs.mkdirSync(output, { recursive: true });
await build({
  entryPoints: {
    app: path.join(root, "main.mjs"),
    tasks: path.join(root, "tasks.mjs"),
  },
  bundle: true,
  outdir: output,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
  metafile: true,
}).then((result) =>
  fs.writeFileSync(
    path.join(output, "bundle-inputs.json"),
    JSON.stringify(result.metafile, null, 2),
  ),
);
fs.copyFileSync(path.join(root, "style.css"), path.join(output, "style.css"));
for (const [page, script, title, body] of [
  ["index", "app", "Observation workspace", '<div id="app"></div>'],
  [
    "tasks",
    "tasks",
    "Task workspace",
    '<main><header><a href="index.html">Observation scenarios</a><h1>Task workspace</h1></header><div id="tasks"></div></main>',
  ],
]) {
  fs.writeFileSync(
    path.join(output, page + ".html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><title>Runspindle ${title} · SIMULATED</title><link rel="stylesheet" href="style.css"></head><body>${body}<script src="${script}.js"></script></body></html>`,
  );
}

// Ship exact upstream notices with every generated application distribution.
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const notices = [];
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name || entry.dev) continue;
  const folder = path.join(root, name);
  const license = fs
    .readdirSync(folder)
    .find((n) => /^licen[sc]e(?:\.|$)/i.test(n));
  const sourceLicense = license
    ? path.join(folder, license)
    : name === "node_modules/react-remove-scroll-bar" &&
        entry.version === "2.3.8"
      ? path.join(root, "licenses/react-remove-scroll-bar-2.3.8.txt")
      : null;
  if (!sourceLicense) throw Error("missing upstream license: " + name);
  if (
    !/Permission (is hereby granted|to use)/.test(
      fs.readFileSync(sourceLicense, "utf8"),
    )
  )
    throw Error("unrecognized license text: " + name);
  notices.push(
    name + "@" + entry.version + "\n" + fs.readFileSync(sourceLicense, "utf8"),
  );
}
fs.writeFileSync(
  path.join(output, "THIRD_PARTY_LICENSES.txt"),
  notices.join("\n\n---\n\n"),
);

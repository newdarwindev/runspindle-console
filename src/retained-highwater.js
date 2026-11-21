// Trusted local configuration only. This stores digests, never retained labels.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const helper = fileURLToPath(
  new URL("../tools/retained_highwater.py", import.meta.url),
);
const pin = JSON.parse(
  readFileSync(
    new URL("../dependencies/tether-snapshot.json", import.meta.url),
    "utf8",
  ),
).commit;
/** @param {{highwater:string,database:string,identity:{task:string,host:string,workspace:string},python?:string}} options */
export function createRetainedHighwater(options) {
  if (
    typeof options.highwater !== "string" ||
    !options.highwater ||
    options.highwater.length > 4096
  )
    throw new TypeError("invalid retained fence path");
  const binding = createHash("sha256")
    .update(
      JSON.stringify([
        pin,
        resolve(options.database),
        options.identity.task,
        options.identity.host,
        options.identity.workspace,
      ]),
    )
    .digest("hex");
  const path = resolve(options.highwater);
  if (path === resolve(options.database))
    throw new TypeError("fence must be separate");
  /** @param {{revision:number,label?:string}} record */
  return (record) => {
    const result = spawnSync(
      options.python ?? "python3",
      ["-I", "-B", helper, path],
      {
        input: JSON.stringify({ binding, record }),
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 1000,
        // spawnSync waits for exit even if a helper ignores the default SIGTERM.
        killSignal: "SIGKILL",
      },
    );
    if (result.status !== 0 || result.error)
      throw new Error("retained fence unavailable");
  };
}

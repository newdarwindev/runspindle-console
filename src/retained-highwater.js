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
  /** @param {{revision:number,label?:string,deleted?:boolean}} record */
  return (record) => {
    const { deleted, ...legacyRecord } = record;
    if (
      (deleted !== undefined && typeof deleted !== "boolean") ||
      (deleted === true && record.label !== "")
    )
      throw new TypeError("invalid retained deletion");
    // Nonempty labels already prove the snapshot is not a deletion. Preserve
    // those receipts and require the deletion flag for new ambiguous labels.
    const evidence =
      record.label === "" && deleted !== undefined ? record : legacyRecord;
    const result = spawnSync(
      options.python ?? "python3",
      ["-I", "-B", helper, path],
      {
        input: JSON.stringify({ binding, record: evidence }),
        encoding: "utf8",
        timeout: 1000,
        maxBuffer: 1024,
      },
    );
    if (result.status !== 0 || result.error)
      throw new Error("retained fence unavailable");
  };
}

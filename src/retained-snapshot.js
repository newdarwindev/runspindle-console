// Node-only read transport for historical local SQLite snapshots. Never control.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = "runspindle.console.retained.v1";
const PIN = JSON.parse(
  readFileSync(
    new URL("../dependencies/tether-snapshot.json", import.meta.url),
    "utf8",
  ),
).commit;
const LIMIT = 16384;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const exporter = fileURLToPath(
  new URL("../tools/retained_snapshot.py", import.meta.url),
);
/** @param {unknown} value @returns {asserts value} */
function require(value) {
  if (!value) throw new Error("retained snapshot rejected");
}
/** @param {any} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** @param {any} value @param {string[]} expected */
function keys(value, expected) {
  require(value && typeof value === "object" && !Array.isArray(value));
  require(
    Object.keys(value).sort().join(",") === [...expected].sort().join(","),
  );
}
/** @param {any} value */
function identity(value) {
  keys(value, ["task", "host", "workspace"]);
  require([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    require(
      typeof key === "string" &&
        ["task", "host", "workspace"].includes(key) &&
        descriptor?.enumerable &&
        Object.hasOwn(descriptor, "value"),
    );
  }
  for (const key of ["task", "host", "workspace"])
    require(typeof value[key] === "string" && IDENTIFIER.test(value[key]));
  return Object.freeze({
    task: value.task,
    host: value.host,
    workspace: value.workspace,
  });
}

/** @param {any} expectedIdentity @param {number} revision */
export function createRetainedDecoder(expectedIdentity, revision) {
  const expected = identity(expectedIdentity);
  require(Number.isSafeInteger(revision) && revision > 0);
  const decoder = new globalThis.TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    pending = "",
    sequence = 0,
    failed = false,
    complete = false;
  /** @type {null | {version:number, identity:Readonly<{task:string,host:string,workspace:string}>,revision:number,observedAt:null,authority:string,connection:string,label:string,simulated:boolean,evidenceClass:string,viewUrl:null}} */
  let result = null;
  /** @param {Uint8Array} chunk */
  function push(chunk) {
    try {
      require(!failed && !complete && chunk instanceof Uint8Array);
      bytes += chunk.byteLength;
      require(bytes <= LIMIT);
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const frame = JSON.parse(line);
        require(canonical(frame) === line);
        require(frame.version === VERSION && frame.sequence === sequence);
        if (sequence === 0) {
          keys(frame, [
            "version",
            "type",
            "sequence",
            "identity",
            "revision",
            "source",
          ]);
          require(
            frame.type === "begin" &&
              frame.source === PIN &&
              frame.revision === revision,
          );
          require(canonical(identity(frame.identity)) === canonical(expected));
        } else if (sequence === 1) {
          keys(frame, [
            "version",
            "type",
            "sequence",
            "identity",
            "revision",
            "label",
            "deleted",
            "observedAt",
            "authority",
            "connection",
          ]);
          require(
            frame.type === "snapshot" &&
              frame.revision === revision &&
              canonical(identity(frame.identity)) === canonical(expected),
          );
          require(
            frame.observedAt === null &&
              frame.authority === "unknown" &&
              frame.connection === "unknown",
          );
          require(
            typeof frame.label === "string" &&
              frame.label.length <= 4096 &&
              typeof frame.deleted === "boolean",
          );
          require(!frame.deleted || frame.label === "");
          result = Object.freeze({
            version: 1,
            identity: expected,
            revision,
            observedAt: null,
            authority: "unknown",
            connection: "unknown",
            label: frame.label,
            simulated: false,
            evidenceClass: "retained_local",
            viewUrl: null,
          });
        } else {
          keys(frame, ["version", "type", "sequence"]);
          require(sequence === 2 && frame.type === "end");
        }
        sequence++;
      }
    } catch {
      failed = true;
      result = null;
      throw new Error("retained snapshot rejected");
    }
  }
  function finish() {
    try {
      require(
        !failed &&
          !complete &&
          decoder.decode() === "" &&
          pending === "" &&
          sequence === 3 &&
          result !== null,
      );
      complete = true;
      return result;
    } catch {
      failed = true;
      result = null;
      throw new Error("retained snapshot rejected");
    }
  }
  return Object.freeze({ push, finish });
}

// Paths and interpreter are trusted application configuration, never wire fields.
// This launches one bounded read process, not a watcher or a network service.
/** @param {{source:string,database:string,revision:number,python?:string,timeoutMs?:number}} options */
export function createRetainedSnapshotReader({
  source,
  database,
  revision,
  python = "python3",
  timeoutMs = 5000,
}) {
  require(
    [source, database, python].every(
      (value) =>
        typeof value === "string" && value.length > 0 && value.length <= 4096,
    ),
  );
  require(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000,
  );
  require(Number.isSafeInteger(revision) && revision > 0);
  /** @param {any} selected @param {{signal?:AbortSignal}} options */
  return function readSnapshot(selected, { signal } = {}) {
    const expected = identity(selected);
    const decoder = createRetainedDecoder(expected, revision);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("retained snapshot unavailable"));
        return;
      }
      const child = spawn(
        python,
        [
          "-I",
          "-B",
          exporter,
          "--source",
          source,
          "--database",
          database,
          "--task",
          expected.task,
          "--revision",
          String(revision),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let failed = false;
      function stop() {
        failed = true;
        child.kill("SIGKILL");
      }
      const timer = setTimeout(stop, timeoutMs);
      signal?.addEventListener("abort", stop, { once: true });
      child.stderr.resume(); // Never expose raw dependency paths or errors.
      child.stdout.on("data", (chunk) => {
        try {
          decoder.push(chunk);
        } catch {
          stop();
        }
      });
      child.on("error", () => {
        failed = true;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        try {
          require(!failed && !signal?.aborted && code === 0);
          resolve(decoder.finish());
        } catch {
          reject(new Error("retained snapshot unavailable"));
        }
      });
    });
  };
}

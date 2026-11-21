// Node-only read transport for historical local SQLite snapshots. Never control.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = "runspindle.console.retained.v1";
const LATEST_VERSION = "runspindle.console.retained-head.v2";
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
  require(Number.isSafeInteger(revision) && revision > 0);
  return createDecoder(expectedIdentity, revision);
}

/** @param {unknown} expectedIdentity */
export function createRetainedHeadDecoder(expectedIdentity) {
  return createDecoder(expectedIdentity, null);
}

/** @param {unknown} expectedIdentity @param {number|null} revision */
function createDecoder(expectedIdentity, revision) {
  const expected = identity(expectedIdentity);
  const latest = revision === null;
  require(
    revision === null || (Number.isSafeInteger(revision) && revision > 0),
  );
  const version = latest ? LATEST_VERSION : VERSION;
  const decoder = new globalThis.TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    pending = "",
    sequence = 0,
    failed = false,
    complete = false;
  /** @type {null | {version:number, identity:Readonly<{task:string,host:string,workspace:string}>,revision:number,observedAt:null,authority:string,connection:string,label:string,simulated:boolean,evidenceClass:string,viewUrl:null,deleted?:boolean}} */
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
        require(frame.version === version && frame.sequence === sequence);
        if (sequence === 0) {
          keys(frame, [
            "version",
            "type",
            "sequence",
            "identity",
            "revision",
            "source",
          ]);
          if (latest) {
            require(Number.isSafeInteger(frame.revision) && frame.revision > 0);
            revision = frame.revision;
          }
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
            revision: /** @type {number} */ (revision),
            observedAt: null,
            authority: "unknown",
            connection: "unknown",
            label: frame.label,
            simulated: false,
            evidenceClass: "retained_local",
            viewUrl: null,
            ...(latest ? { deleted: frame.deleted } : {}),
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
export function createRetainedSnapshotReader(options) {
  require(Number.isSafeInteger(options.revision) && options.revision > 0);
  return createReader(options);
}

/** @param {{source:string,database:string,python?:string,timeoutMs?:number}} options */
export function createRetainedHeadReader(options) {
  return createReader({ ...options, revision: null });
}

/** @param {{source:string,database:string,revision:number|null,python?:string,timeoutMs?:number}} options */
function createReader({
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
  let pending = false;
  let cleanupUnknown = false;
  function unavailable() {
    return Object.assign(new Error("retained snapshot unavailable"), {
      cleanup: cleanupUnknown ? "unknown" : "no_unconfirmed_process",
    });
  }
  /** @param {any} selected @param {{signal?:AbortSignal}} options */
  function readSnapshot(selected, { signal } = {}) {
    const expected = identity(selected);
    const decoder = createDecoder(expected, revision);
    if (pending || cleanupUnknown || signal?.aborted)
      return Promise.reject(unavailable());
    pending = true;
    return new Promise((resolve, reject) => {
      /** @type {import("node:child_process").ChildProcessByStdio<null, import("node:stream").Readable, import("node:stream").Readable>} */
      let child;
      try {
        child = spawn(
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
            ...(revision === null
              ? ["--latest-head"]
              : ["--revision", String(revision)]),
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch {
        pending = false;
        reject(unavailable());
        return;
      }
      let settled = false;
      let exited = false;
      function release() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        pending = false;
      }
      function stop() {
        if (settled) return;
        // A deadline/abort is not a descendant-cleanup receipt. Fence all later
        // reads even if closing our pipes subsequently produces a close event.
        cleanupUnknown = true;
        settled = true;
        release();
        if (!exited && child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* uncertainty retained */
          }
        }
        // Descendants can inherit these descriptors after the owned leader
        // exits. Do not wait for their EOF, signal a reused PID or claim cleanup.
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        reject(unavailable());
      }
      const timer = setTimeout(stop, timeoutMs);
      signal?.addEventListener("abort", stop, { once: true });
      child.stderr.resume(); // Never expose raw dependency paths or errors.
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        try {
          decoder.push(chunk);
        } catch {
          stop();
        }
      });
      child.stdout.on("error", stop);
      child.stderr.on("error", stop);
      child.on("exit", () => {
        exited = true;
      });
      child.on("error", () => {
        if (settled) return;
        if (child.pid !== undefined) {
          stop();
          return;
        }
        // Failure before acquiring a PID allocated no owned child.
        settled = true;
        release();
        reject(unavailable());
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        release();
        try {
          require(!signal?.aborted && code === 0);
          resolve(decoder.finish());
        } catch {
          reject(unavailable());
        }
      });
      // Cover cancellation between the initial check and listener attachment.
      if (signal?.aborted) stop();
    });
  }
  return Object.assign(readSnapshot, {
    state: () =>
      Object.freeze({
        pending,
        cleanup: cleanupUnknown ? "unknown" : "no_unconfirmed_process",
      }),
  });
}

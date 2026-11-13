// Provisional, process-local console API. This is not a shared wire protocol.
const ID_KEYS = ['task', 'host', 'workspace', 'nativeSession', 'browser', 'leaseEpoch', 'trace', 'span', 'artifactDigest'];
const STATES = new Set(['online', 'offline', 'unknown', 'unsupported']);
const AUTHORITY = new Set(['unknown', 'pending', 'denied', 'agent', 'human', 'handback_pending']);
const EVIDENCE = new Set(['synthetic_component', 'isolated_integration', 'live_acceptance']);

function identity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid identity');
  for (const key of Object.keys(value)) if (!ID_KEYS.includes(key)) throw new TypeError('unknown identity field');
  for (const key of ['task', 'host', 'workspace']) {
    if (typeof value[key] !== 'string' || !value[key].length || value[key].length > 256) throw new TypeError('invalid identity');
  }
  for (const key of ['nativeSession', 'browser', 'trace', 'span']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].length || value[key].length > 256)) throw new TypeError('invalid identity');
  }
  if (value.artifactDigest !== undefined && (typeof value.artifactDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.artifactDigest))) throw new TypeError('invalid artifact digest');
  if (value.span !== undefined && !value.trace) throw new TypeError('span without trace');
  if (value.leaseEpoch !== undefined && (!Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 0 || !value.browser)) throw new TypeError('invalid lease');
  return Object.freeze({...value});
}

function sameIdentity(left, right) {
  return ID_KEYS.every(key => left[key] === right[key]);
}

export function safeViewUrl(value, allowedOrigins) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && allowedOrigins.includes(url.origin)
      ? url.href : null;
  } catch { return null; }
}

// For a future text renderer; never insert raw adapter strings as HTML.
export function escapeText(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new TypeError('invalid text');
  return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

export function createProjection({clock, readSnapshot, openPassive, allowedViewOrigins = [], maxAgeMs = 30_000} = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new TypeError('invalid clock or age');
  if (!Array.isArray(allowedViewOrigins) || allowedViewOrigins.some(origin => safeViewUrl(origin, [origin]) !== `${origin}/`)) throw new TypeError('invalid allowed origins');
  let target = null, generation = 0, latestRequest = 0, phase = 'empty', record = null;
  let pendingRead = null, pendingView = null, activeView = null, disposed = false;

  function releaseView() {
    pendingView?.abort();
    pendingView = null;
    if (activeView) { try { activeView.close(); } catch { /* No authority is granted when adapter cleanup fails. */ } finally { activeView = null; } }
  }
  function select(next) {
    if (disposed) throw new Error('projection disposed');
    const parsed = identity(next);
    generation++;
    pendingRead?.abort();
    pendingRead = null;
    releaseView();
    target = parsed;
    record = null;
    phase = 'empty';
  }
  function merge(update, {snapshot = false} = {}) {
    if (disposed || !target) return false;
    let incoming;
    try { incoming = identity(update.identity); } catch { return false; }
    if (!sameIdentity(target, incoming) || update.version !== 1 || !Number.isSafeInteger(update.revision) || update.revision < 0) return false;
    if (!STATES.has(update.connection) || !AUTHORITY.has(update.authority) || !EVIDENCE.has(update.evidenceClass)) return false;
    if (update.observedAt !== null && (!Number.isSafeInteger(update.observedAt) || update.observedAt < 0)) return false;
    if (typeof update.label !== 'string' || update.label.length > 4096 || typeof update.simulated !== 'boolean') return false;
    if (update.simulated && update.evidenceClass !== 'synthetic_component') return false;
    if (record && (update.revision <= record.revision || (update.observedAt !== null && record.observedAt !== null && update.observedAt < record.observedAt))) return false;
    const gap = !snapshot && !!record && (record.gap || update.revision !== record.revision + 1);
    record = Object.freeze({
      revision: update.revision, observedAt: update.observedAt, connection: update.connection,
      authority: update.authority, evidenceClass: update.evidenceClass, label: update.label,
      simulated: update.simulated, gap,
      viewUrl: safeViewUrl(update.viewUrl, allowedViewOrigins),
    });
    phase = 'ready';
    return true;
  }
  function state() {
    let freshness = 'unknown';
    const now = clock();
    if (record && record.observedAt !== null && Number.isSafeInteger(now) && now >= record.observedAt) {
      freshness = now - record.observedAt > maxAgeMs ? 'stale' : 'fresh';
    }
    const status = phase !== 'ready' ? phase : record.connection === 'unsupported' ? 'unsupported'
      : record.connection === 'offline' ? 'offline'
      : record.connection === 'unknown' || record.gap || freshness === 'unknown' ? 'unknown'
      : freshness === 'stale' ? 'stale' : 'ready';
    return Object.freeze({
      status, identity: target, record, freshness,
      authority: record?.authority ?? 'unknown', canExecute: false,
      viewLabel: !record?.viewUrl ? 'View unavailable' : record.simulated ? 'Simulated view — synthetic component evidence' : 'View source unverified — adapter qualification required',
    });
  }
  async function refresh() {
    if (disposed || !target) return false;
    if (typeof readSnapshot !== 'function') { phase = 'unsupported'; return false; }
    pendingRead?.abort();
    const controller = new AbortController(), expectedGeneration = generation, request = ++latestRequest;
    pendingRead = controller;
    phase = 'loading';
    try {
      const update = await readSnapshot(target, {signal: controller.signal});
      if (controller.signal.aborted || disposed || expectedGeneration !== generation || request !== latestRequest) return false;
      if (update === null) { phase = record ? 'ready' : 'empty'; return true; }
      const accepted = merge(update, {snapshot: true});
      phase = record ? 'ready' : 'error';
      return accepted;
    } catch {
      if (!controller.signal.aborted && !disposed && expectedGeneration === generation && request === latestRequest) phase = 'error';
      return false;
    } finally { if (pendingRead === controller) pendingRead = null; }
  }
  async function view() {
    if (disposed || pendingView || activeView || state().status !== 'ready' || !record.viewUrl || typeof openPassive !== 'function') return false;
    const controller = new AbortController(), expectedGeneration = generation;
    pendingView = controller;
    try {
      const opened = await openPassive(Object.freeze({identity: target, url: record.viewUrl, mode: 'passive', simulated: record.simulated}), {signal: controller.signal});
      if (!opened || typeof opened.close !== 'function') return false;
      if (controller.signal.aborted || disposed || expectedGeneration !== generation || state().status !== 'ready') { opened.close(); return false; }
      activeView = opened;
      return true;
    } catch { return false; }
    finally { if (pendingView === controller) pendingView = null; }
  }
  function dispose() {
    generation++;
    disposed = true;
    pendingRead?.abort();
    pendingRead = null;
    releaseView();
    target = null;
    record = null;
    phase = 'empty';
  }
  return Object.freeze({select, merge, state, refresh, view, dispose});
}

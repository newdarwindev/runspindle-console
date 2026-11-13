import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjection, safeViewUrl, escapeText} from '../src/projection.js';

const target = Object.freeze({task: 'task-synthetic-1', host: 'host-synthetic-1', workspace: 'workspace-synthetic-1', nativeSession: 'native-synthetic-1', browser: 'browser-synthetic-1', leaseEpoch: 3, trace: 'trace-synthetic-1', span: 'span-synthetic-1', artifactDigest: `sha256:${'a'.repeat(64)}`});
const fixture = (change = {}) => ({version: 1, identity: target, revision: 1, observedAt: 1000, connection: 'online', authority: 'denied', evidenceClass: 'synthetic_component', label: 'Synthetic task', simulated: true, viewUrl: 'https://viewer.invalid/desktop/1', ...change});
function make(options = {}) {
  const projection = createProjection({clock: () => 1000, allowedViewOrigins: ['https://viewer.invalid'], ...options});
  projection.select(target);
  return projection;
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; }

test('timestamps are observed, bounded and reevaluated with the injected clock', () => {
  let now = 1000;
  const projection = make({clock: () => now, maxAgeMs: 100});
  assert.equal(projection.state().status, 'empty');
  assert.equal(projection.merge(fixture()), true);
  assert.equal(projection.state().status, 'ready');
  now = 1101;
  assert.equal(projection.state().status, 'stale');
  now = 999;
  assert.equal(projection.state().status, 'unknown');
  assert.equal(projection.merge(fixture({revision: 2, observedAt: null})), true);
  now = 2000;
  assert.equal(projection.state().freshness, 'unknown');
  assert.equal(projection.state().canExecute, false);
});

test('all explicit observation states preserve identity and never enable execution', () => {
  for (const [connection, status] of [['online', 'ready'], ['offline', 'offline'], ['unknown', 'unknown'], ['unsupported', 'unsupported']]) {
    for (const authority of ['unknown', 'pending', 'denied', 'agent', 'human', 'handback_pending']) {
      const projection = make();
      projection.merge(fixture({connection, authority}));
      const view = projection.state();
      assert.deepEqual(view.identity, target);
      assert.equal(view.status, status);
      assert.equal(view.authority, authority);
      assert.equal(view.canExecute, false);
      assert.match(view.viewLabel, /Simulated/);
    }
  }
});

test('old, duplicate, conflicting and mismatched updates preserve the accepted observation', () => {
  const projection = make();
  projection.merge(fixture({revision: 3}));
  const before = projection.state().record;
  const mutations = [
    {revision: 2}, {revision: 3, label: 'conflicting duplicate'}, {revision: 4, observedAt: 999},
    {version: 9}, {identity: {...target, task: 'another-task'}}, {identity: {...target, host: 'other-host'}},
    {identity: {...target, workspace: 'other-workspace'}}, {identity: {...target, nativeSession: 'other-native'}},
    {identity: {...target, browser: 'other-browser'}}, {identity: {...target, leaseEpoch: 2}}, {identity: {...target, trace: 'other-trace'}},
    {identity: {...target, span: 'other-span'}}, {identity: {...target, artifactDigest: `sha256:${'b'.repeat(64)}`}},
    {identity: {...target, leaseEpoch: undefined}}, {identity: {...target, actor: 'forged'}},
    {revision: 1.5}, {observedAt: undefined}, {connection: 'live'}, {authority: 'approved'},
    {label: 'x'.repeat(4097)}, {simulated: true, evidenceClass: 'live_acceptance'},
  ];
  for (const mutation of mutations) {
    assert.equal(projection.merge(fixture({revision: 4, ...mutation})), false, JSON.stringify(mutation));
    assert.equal(projection.state().record, before);
  }
});

test('an event gap remains unknown until a newer complete snapshot', async () => {
  const projection = make({readSnapshot: async () => fixture({revision: 5})});
  projection.merge(fixture());
  projection.merge(fixture({revision: 3}));
  assert.equal(projection.state().status, 'unknown');
  projection.merge(fixture({revision: 4}));
  assert.equal(projection.state().status, 'unknown');
  await projection.refresh();
  assert.equal(projection.state().status, 'ready');
});

test('task switch aborts request; late success and failure cannot populate the next task', async () => {
  for (const fails of [false, true]) {
    const request = deferred(); let signal;
    const projection = make({readSnapshot: async (_, options) => {signal = options.signal; return request.promise;}});
    const pending = projection.refresh();
    assert.equal(projection.state().status, 'loading');
    const next = {...target, task: 'task-synthetic-2'};
    projection.select(next);
    assert.equal(signal.aborted, true);
    fails ? request.reject(new Error('untrusted private error')) : request.resolve(fixture());
    assert.equal(await pending, false);
    assert.deepEqual(projection.state().identity, next);
    assert.equal(projection.state().record, null);
    assert.equal(projection.state().status, 'empty');
  }
});

test('latest overlapping request wins, including an adapter that ignores abort', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const projection = make({readSnapshot: () => (++count === 1 ? first : second).promise});
  const one = projection.refresh(), two = projection.refresh();
  second.resolve(fixture({revision: 4}));
  assert.equal(await two, true);
  first.resolve(fixture({revision: 10, label: 'late wrong snapshot'}));
  assert.equal(await one, false);
  assert.equal(projection.state().record.revision, 4);
});

test('missing APIs, empty results, malformed results and backend failure are explicit', async () => {
  const absent = make(); await absent.refresh(); assert.equal(absent.state().status, 'unsupported');
  const empty = make({readSnapshot: async () => null}); await empty.refresh(); assert.equal(empty.state().status, 'empty');
  const bad = make({readSnapshot: async () => ({identity: target})}); await bad.refresh(); assert.equal(bad.state().status, 'error');
  const fail = make({readSnapshot: async () => {throw new Error('secret-canary-not-projected');}});
  await fail.refresh(); assert.equal(fail.state().status, 'error');
  assert.doesNotMatch(JSON.stringify(fail.state()), /secret-canary/);
});

test('passive opening is deduplicated and never invokes a control boundary', async () => {
  const request = deferred(); const calls = []; let closes = 0, controls = 0;
  const projection = make({openPassive: async (input, options) => {calls.push({input, options}); return request.promise;}, control: () => controls++});
  projection.merge(fixture());
  const first = projection.view();
  assert.equal(await projection.view(), false);
  request.resolve({close() {closes++;}});
  assert.equal(await first, true);
  assert.equal(await projection.view(), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.mode, 'passive');
  assert.deepEqual(calls[0].input.identity, target);
  assert.equal(controls, 0);
  projection.dispose();
  assert.equal(closes, 1);
  assert.equal(await projection.view(), false);
});

test('a delayed view is closed after navigation; stale or denied viewer URLs cause zero calls', async () => {
  const request = deferred(); let calls = 0, closes = 0, signal;
  const projection = make({openPassive: async (_, options) => {calls++; signal = options.signal; return request.promise;}});
  projection.merge(fixture());
  const pending = projection.view();
  projection.select({...target, task: 'task-2'});
  assert.equal(signal.aborted, true);
  request.resolve({close() {closes++;}});
  assert.equal(await pending, false);
  assert.equal(closes, 1);
  projection.merge(fixture({identity: {...target, task: 'task-2'}, viewUrl: 'javascript:alert(1)'}));
  assert.equal(await projection.view(), false);
  assert.equal(calls, 1);
  const stale = make({clock: () => 100_000, openPassive: () => {calls++;}});
  stale.merge(fixture()); assert.equal(await stale.view(), false); assert.equal(calls, 1);
});

test('untrusted URL and text values cannot become active content through rendering helpers', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'http://viewer.invalid/', 'https://evil.invalid/', 'https://viewer.invalid.evil.invalid/', 'https://user:pass@viewer.invalid/', '//viewer.invalid/', {}, null]) {
    assert.equal(safeViewUrl(value, ['https://viewer.invalid']), null);
  }
  assert.equal(safeViewUrl('https://viewer.invalid/path', ['https://viewer.invalid']), 'https://viewer.invalid/path');
  assert.equal(escapeText('<img src=x onerror="alert(1)">&\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  assert.throws(() => escapeText({}), TypeError);
  assert.throws(() => make({allowedViewOrigins: ['https://viewer.invalid/path']}), TypeError);
});

test('task and observation bounds are enforced; returned objects cannot mutate accepted state', () => {
  const projection = make();
  assert.throws(() => projection.select({...target, task: ''}), TypeError);
  assert.throws(() => projection.select({...target, leaseEpoch: Number.MAX_SAFE_INTEGER + 1}), TypeError);
  projection.merge(fixture());
  assert.throws(() => {projection.state().record.authority = 'agent';}, TypeError);
  assert.throws(() => {projection.state().identity.host = 'other';}, TypeError);
  projection.dispose();
  assert.throws(() => projection.select(target), /disposed/);
});

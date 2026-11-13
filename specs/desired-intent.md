# Desired intent: Truthful operator control and evidence

Status: engineering direction and acceptance obligations, not a new implementation
claim, grant of authority, or replacement for existing versioned contracts.

## System intent and evidence boundary

Runspindle is intended to turn an authorized one-off task into a repeatable,
maintained workflow by composing scoped access, managed native/browser sessions,
explicit human takeover, and evaluated workflow candidates. The useful capability
is the composition: cross-application execution can retain identity and evidence
across interruptions, while approved examples can inform later DSPy experiments.
This is a design objective, not evidence of emergent intelligence, autonomous
self-improvement, deployed integration, or measured gains.

A workflow revision must identify its inputs, permitted effects, target bindings,
exception policy, acceptance criteria and resource budget. Repetition does not
create a recurring schedule or expand permission. Human intervention is first an
execution event; only a separately reviewed, consented and sanitized example may
enter a dataset. A successful evaluation is evidence for review, not authority to
promote, serve, spend, publish or act in another account.

## Component responsibility

The console should let a person understand what a workflow is doing, which
computer/session/account it is bound to, what is uncertain, and where human action
is needed. Fleet visibility, real desktop views, execution traces and evaluation
results should share causal identity without collapsing their evidence levels.
An operator interface is a projection of observed facts, not an authority service.

## Interfaces and acceptance obligations

- Display requested, acknowledged, observed terminal, validation and delivery
  states distinctly. Show observation time, source, sequence and freshness; an
  offline feed must not leave a misleading live/healthy badge.
- Bind rendered artifacts, traces and candidate results to exact revisions and
  digests. A current task label must not relabel historical evidence as current.
- Keep passive viewing separate from interactive takeover. Control actions must
  pass authoritative backend checks and show pending/unknown until confirmed;
  disabling a UI button is not fencing or authorization enforcement.
- Show human exceptions with minimal necessary context and explicit return state.
  Do not export desktop content, private prompts or credentials into analytics,
  screenshots, Slack summaries or feedback datasets by default.
- Present baseline and candidate evidence with sample size, exclusions, metric
  version, cost/latency units, blocked gates and approval status. Evaluation passed,
  approved, promoted and serving are different facts.
- Test stale/out-of-order observations, reconnect, duplicate controls, conflicting
  revisions, missing evidence and cancellation races. Test actual desktop/UI
  integration separately from deterministic projection functions.

## Present scope

The current JavaScript projection candidate and Python fixture consumer are
process-local synthetic component evidence. An integrated UI, real desktop adapter,
durable state and live acceptance are not implemented. See
[implementation evidence](../docs/IMPLEMENTATION_EVIDENCE.md).

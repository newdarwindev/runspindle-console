# console specification

Status: planned contract, implementation and live acceptance not verified.

## Responsibility

Fleet, session, trace and actual desktop views with truthful freshness.

## Shared identifiers

Correlate task, intent revision, selected host, native session, browser instance, lease epoch, trace/span, artifact digest and Slack destination without placing credentials or raw private content in public receipts.

## Required behavior

Preserve explicit authority and unknown outcomes. Distinguish request admission, execution, validation, acceptance and delivery. Exact state transitions belong in component-specific specs added beside this file.

## Acceptance

1. Unit/contract tests with synthetic data.
2. Isolated integration tests against pinned upstream dependencies.
3. Bounded live acceptance in an authorized target.
4. Failure, restart, uncertain-effect reconciliation and rollback evidence.

Synthetic component tests now cover a bounded process-local projection candidate.
See [implementation evidence](../docs/IMPLEMENTATION_EVIDENCE.md). Integration,
rendered accessibility, live acceptance and restart/durability gates remain not run.
The internal API is provisional and is not the cross-component wire protocol.

## Engineering direction

[Desired intent](desired-intent.md) connects this component to scoped access,
managed sessions, explicit human exceptions and evaluated maintained workflows.
It adds design and verification obligations without changing runtime schemas,
existing acceptance results or operational permissions.

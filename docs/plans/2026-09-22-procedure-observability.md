# Procedure observability and traceability

## Status

Design brief only. This document records the product and engineering decisions
that should be agreed before Jentera executes a taught procedure. It does not
authorize procedure execution, background scheduling, screenshot capture, or a
new top-level monitoring area.

## Goal

An owner must be able to answer, without reading agent chat or raw logs:

1. What is Jentera doing now?
2. What has it already done?
3. Which system and procedure version performed each step?
4. Did a deterministic rule or an AI-assisted judgment produce the result?
5. Is the owner needed, and what exactly are they being asked to approve?
6. What stopped, failed, changed, or was retried?
7. Which business record was affected, without exposing credentials or
   unrelated private data?

The governing rule is:

> A procedure step that cannot produce a bounded, owner-visible trace is not
> allowed to execute.

Visibility is part of the execution contract, not an optional logging feature.

## Product location

Do not add a separate **Monitor** section for the first release.

- **Activity** remains the cross-procedure history and exception queue.
- Opening an Activity item shows the live or completed procedure run.
- A future procedure detail page may show that procedure's versions, health,
  and run history, but it should link to the same run detail rather than create
  another trace model.
- Home may show a small active-work summary, but it is not a second source of
  truth.

This matches the existing architecture: `run` is the unit of execution,
`run_event` is its ordered trace, and `work_record` is the owner-facing
projection shown by Home and Activity.

## Disclosure levels

The monitor uses progressive disclosure rather than exposing an engineering
console to every owner.

### 1. Business summary

Always visible. It answers what happened and whether the owner is needed.

Example:

> Reconciled 97 payments. 92 matched automatically and 5 need review. About
> 18 minutes saved.

Show:

- objective and current status;
- progress, useful totals, and elapsed time;
- the next required owner action;
- the business outcome and affected-record count; and
- who or what started the run.

### 2. Step timeline

Available to every owner from the run detail. It shows one plain-language row
per material step:

- `Checking incoming bank transactions`;
- `Looking for matching Bukku invoices`;
- `Matched 92 payments`;
- `5 payments need your review`; and
- `Stopped because Bukku's request format changed`.

Each row may reveal the system, execution mode (`connection`, `browser`, or
`rule`), start/end time, result category, retry count, and safe record
references. It must not reveal raw payloads.

### 3. Technical trace

Advanced disclosure for diagnosis and audit. It shows the immutable event
name, sequence number, timestamps, procedure/step version, policy decision,
execution mode, bounded error class, and evidence references. It does not show
chain-of-thought or credential material.

## Live experience

While a procedure is running, the run detail should show:

- procedure name and immutable version;
- status: queued, working, waiting for approval, paused, completed, failed, or
  cancelled;
- current step and `n of total` progress when the path is known;
- totals processed, succeeded, skipped, and needing review;
- elapsed time and, only when supported by observed history, an estimated
  completion time;
- execution mode for the current step;
- a plain-language reason when stopped or waiting; and
- owner controls allowed by policy.

The existing run stream may update this view. Polling remains a bounded
recovery path, not the primary live transport.

An API/connector step will not produce a fake browser animation. Browser steps
may offer the existing Business Browser viewer when useful, but the step
timeline is the authoritative view for both browser and direct execution.

## Owner controls

Controls are commands that create trace events; they must not mutate history.

- **Pause**: finish or safely interrupt the current atomic step, then stop
  before the next material action.
- **Stop**: cancel future work and record which step was last settled.
- **Approve / decline**: act on the exact proposed operation and parameters,
  with the deciding owner and expiry recorded.
- **Resume**: continue only from a declared recovery point.
- **Review exception**: show the affected records and configured escalation
  action without asking the model to improvise.

Closing the page does not pause or stop a procedure. Control is durable and
server-authoritative.

## Event vocabulary

Procedure events extend the existing closed run-event vocabulary. Proposed
events are:

```text
procedure.run.started
procedure.step.started
procedure.step.completed
procedure.step.skipped
procedure.approval.requested
procedure.approval.granted
procedure.approval.rejected
procedure.exception.raised
procedure.run.paused
procedure.run.resumed
procedure.run.cancelled
procedure.run.completed
procedure.run.failed
```

These should coexist with existing generic work events while procedure support
is introduced. Do not create a second event store.

Every procedure event has a bounded envelope:

```ts
interface ProcedureTraceEnvelope {
  procedureId: string;
  procedureVersion: number;
  stepId?: string;
  stepVersion?: number;
  executionMode?: 'connection' | 'browser' | 'rule' | 'judgment';
  system?: string;
  status?: 'started' | 'completed' | 'skipped' | 'waiting' | 'failed';
  durationMs?: number;
  attempt?: number;
  counters?: Record<string, number>;
  recordRefs?: Array<{ kind: string; id: string }>;
  evidenceRefs?: string[];
  reasonCode?: string;
  summary?: string;
}
```

The accepted keys, string lengths, array sizes, counter names, record-reference
kinds, and reason codes must be allowlisted at the Control boundary. Runtimes
cannot append arbitrary objects to an owner-visible trace.

## Decision visibility

Owners need an explanation, not hidden model reasoning.

For deterministic steps, show the rule and the facts it used:

> Matched because the normalized payment reference equalled invoice INV-0192
> and the amount matched exactly.

For judgment steps, record:

- the named decision being made;
- the bounded business inputs used;
- the allowed outcomes;
- the selected outcome and owner-readable reason;
- confidence or uncertainty category, where meaningful; and
- whether policy required review.

Do not persist chain-of-thought, model scratchpads, raw prompts, or unbounded
tool results as the explanation.

## Credential and privacy boundary

Procedure observability inherits the model boundary defined by Procedure Lab.
The trace must never contain:

- passwords, passcodes, one-time codes, API keys, bearer tokens, cookies,
  session identifiers, or authorization values;
- raw request or response headers and bodies;
- clipboard contents or typed values;
- raw selectors, pointer coordinates, or terminal transcripts;
- model chain-of-thought; or
- complete customer records when an opaque tenant-scoped reference is enough.

The trace may say `Used the owner's Bukku connection` or carry an opaque
credential-binding identifier. It may not contain the credential itself.
Credential resolution happens after the model boundary under a short-lived,
tenant-, run-, procedure-, and operation-scoped grant.

Procedure and Worker code must reconstruct trace DTOs field by field. Logs,
exception messages, and provider responses are not safe merely because the
runtime is private.

## Screenshots and video

Do not enable continuous recording by default.

Akai publicly describes step-level logs and replayable video. Video can be
valuable for incident review, but it also captures customer data, credentials,
and unrelated page content; it creates a large retention and access-control
surface.

Jentera should begin with structured evidence. A later visual-evidence feature
must be separately consented and should:

- capture only around a failure, approval boundary, or material browser write;
- redact password fields and configured sensitive regions before persistence;
- use tenant-scoped encryption and short retention;
- restrict access by role and record every view/export; and
- never be sent to a model by default.

The existing live browser view is transport, not stored audit evidence.

## Failure and drift behavior

An unexpected response, missing field, changed request contract, ambiguous
match, authentication failure, or policy violation creates an exception event
and stops at the configured boundary. The executor must not silently discover
a new action or let a model guess through the change.

The exception shown to the owner includes:

- what Jentera was trying to do;
- which step stopped;
- which safe records are affected;
- the bounded reason category;
- whether earlier steps completed; and
- the permitted next actions.

Retries are traceable attempts of the same step. They do not overwrite the
failed attempt.

## Audit properties

The existing `run_event` sequence is the source for the timeline. Events are
ordered per run and updates are prohibited. Business erasure still requires
deletion support, so the current database guarantee is append-only during the
record's lifetime, not an externally anchored tamper-proof ledger.

If regulated customers require stronger evidence later, add a per-run hash
chain, signed completion receipt, and export manifest. Do not claim
tamper-evidence until those controls exist and are independently verified.

## Metrics

Useful operational metrics are projections of structured trace events:

- successful execution rate by procedure version;
- exception and owner-intervention rate;
- approval and correction rate;
- duration and cost by step;
- browser fallback rate versus direct connection;
- request-contract drift rate;
- retries and repeated failure categories;
- time saved; and
- how often owners open the technical trace to understand a result.

Metrics must not be inferred later from chat transcripts.

## Relationship to Akai

The useful principles in Akai's public material are explicit demonstration,
underlying server-call capture, connector-first execution, owner review,
deterministic handling where exactness matters, granular approvals, exception
escalation, and a replayable audit history.

Jentera adopts those principles where they fit but keeps its own boundaries:
structured evidence before stored video, no credential material in model or
trace contexts, and the existing Activity/run spine as the single owner-facing
history.

References:

- [How Akai works](https://www.akai.run/)
- [The control model behind every Akai workflow](https://www.akai.run/blog/the-control-model-behind-every-akai-workflow/)

## Implementation order

1. Add the closed procedure event vocabulary and strict payload validator.
2. Add a reusable owner-facing step timeline to the existing task detail.
3. Project procedure progress and counters from `run_event`; do not create a
   parallel progress table.
4. Add durable pause, stop, resume, approval, and exception commands with
   events written in the same transaction as state changes.
5. Add immutable procedure/version identity to every procedure run.
6. Add supervised execution only after every executor path emits the required
   trace.
7. Add cross-run health and version comparison after real runs exist.
8. Consider opt-in visual evidence and stronger audit cryptography only after
   retention, access, and deletion policies are complete.

## First implementation slice

The first code slice should remain narrow:

- procedure event constants and a secret-free envelope validator;
- tests that reject raw bodies, header values, cookie/token/password fields,
  unknown keys, excessive nesting, and oversized summaries;
- a plain-language timeline component using the existing run-trace endpoint;
- live refresh while the run is active; and
- no executor, scheduler, screenshots, or new navigation.

This creates an observable execution contract before there is any procedure
execution capable of escaping it.

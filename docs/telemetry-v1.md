# Telemetry v1

Legion's durable runtime log is a compact, append-only JSON Lines stream. Each
line is one telemetry event and conforms to the TypeScript schema in
`src/types/telemetry.ts`.

## Envelope

Every event contains these fields:

| Field           | Type                 | Meaning                                        |
| --------------- | -------------------- | ---------------------------------------------- |
| `schemaVersion` | `1`                  | Version of this event and extraction contract. |
| `sequence`      | non-negative integer | Run-local publication order.                   |
| `timestamp`     | ISO-8601 string      | Wall-clock occurrence time.                    |
| `monotonicMs`   | non-negative number  | Milliseconds since the recorder was created.   |
| `runId`         | string               | Stable identity of one Legion process run.     |
| `event`         | string               | Event name from the table below.               |
| `data`          | object               | Event-specific compact measurements.           |

Correlation fields are required according to the work being observed:

| Scope               | Required correlation                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Run or startup work | `runId`                                                                                       |
| Epoch work          | `runId`, `epochId`                                                                            |
| Candidate lifecycle | `runId`, `epochId`, `wave`, `candidateId`, `nodeId`                                           |
| Provider inference  | `data.inferenceId`, `data.stage`; epoch/candidate correlation is also present when applicable |

`spanId` and `parentSpanId` correlate nested operations where a span exists.
Their absence means the event is not part of a nested span, not that telemetry
was disabled.

## Events

| Event                             | Required data                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `run.started`                     | none                                                                                                                        |
| `run.completed`                   | `status`                                                                                                                    |
| `epoch.started`                   | `inputIds`                                                                                                                  |
| `epoch.completed`                 | `status`, aggregate and per-wave counts, inference/tool counts, total provider time, critical-path time                     |
| `candidate.generated`             | candidate/node/wave identity, `contentHash`, bounded evidence, `inputIds`                                                   |
| `candidate.outcome`               | candidate/node/wave identity, attention and selection outcomes                                                              |
| `inference.completed`             | `inferenceId`, `stage`, monotonic duration, outcome; `errorCategory` on failure                                             |
| `relevance.completed`             | duration, outcome, top-N, ordered candidate IDs, exact survivor IDs                                                         |
| `distillation.attempt-completed`  | attempt identity/type, strategy, duration, outcome, input and selected candidate IDs, resolved evidence, action disposition |
| `distillation.fallback-activated` | failed attempt ID and bounded error category                                                                                |
| `tool.elaboration-completed`      | request/call IDs, duration, outcome                                                                                         |
| `tool.invocation-completed`       | request/call/tool identity, duration, outcome, bounded evidence on success                                                  |
| `node.split-completed`            | parent, two children on success, duration, outcome                                                                          |
| `persistence.completed`           | operation, logical target, duration, outcome                                                                                |
| `user-input.received`             | input ID and content hash                                                                                                   |
| `user-input.consumed`             | input ID and receipt-to-consumption latency                                                                                 |
| `user-input.broadcast-selected`   | input ID, receipt-to-first-selection latency, selected broadcast hash                                                       |
| `error.reported`                  | source, bounded message, bounded category; diagnostics only when enabled                                                    |
| `system.notice`                   | bounded message; metadata only when diagnostics are enabled                                                                 |

Durations use the recorder's monotonic clock. Wall-clock timestamps are for
human correlation and must not be used to calculate latency.

## Evidence and diagnostics

Default telemetry does not embed prompts, node contexts, candidate prose, tool
payloads, or persistence contents. Candidate and broadcast content is
represented by SHA-256 hashes.

Successful tool results may contribute an `EvidenceDescriptor` containing a
stable ID, content hash, and at most eight source URLs or artifact references.
References are capped at 512 characters. URL credentials, fragments, and
sensitive query parameters are removed or redacted. Distillation evidence is
resolved to a required stable ID and content hash before emission. Completion
events require `errorCategory` on failure and omit it on success.

`telemetryDiagnostics` is opt-in. When enabled, diagnostic values are bounded
by `telemetryMaxTextLength`, collections are capped at 32 entries, traversal is
capped at 256 values, common secret-bearing keys are redacted, and circular
values are replaced by a marker. Optional evidence and diagnostic fields
reflect genuinely absent domain data; telemetry itself is not optional at
runtime boundaries.

## Benchmark extraction contract

The supported extractor is `src/telemetry/benchmark-extractor.ts`:

- `parseTelemetryJsonl(contents)` parses non-empty lines and rejects records
  without the telemetry v1 envelope, required event correlation, or complete
  event-specific payload shape.
- `extractEpochSummaries(events)` partitions appended records by `runId`, then
  groups by `epochId`, orders by run-local `sequence`, derives measurements,
  and rejects duplicate sequences within a run, missing/duplicate epoch
  boundaries, and emitted aggregates that do not equal the lifecycle records.
- `scoreGroundedSelection(events, epochId, labels)` evaluates the deterministic
  local-events regression described in issue #101.

For each epoch, extraction derives:

- generated count from `candidate.generated`;
- attention-passed count from non-rejected `candidate.outcome` records;
- selected count from selected cognitive candidate outcomes;
- inference and tool-call counts from their completion events;
- total provider time as the sum of inference durations;
- critical-path latency as `epoch.completed.monotonicMs - epoch.started.monotonicMs`;
- fallback activation and distillation-attempt counts from their lifecycle
  events.

The extractor verifies those values against `epoch.completed`; consumers do
not need to reconstruct state from domain snapshots.
Duration verification allows only machine-precision floating-point drift;
counts, identities, and lifecycle cardinality remain exact.
Distillation failures use stable semantic categories: `undefined-result`,
`synthesis-failure`, `selection-failure`, and `validation-failure`. They do not
depend on JavaScript constructor names.

For the local-events regression, label candidate IDs as `search`,
`clarification`, `unsupported-answer`, or `other`. Selecting search or
clarification when no relevant tool evidence exists is success. Selecting an
unsupported answer while a search or clarification candidate survived
attention is a harmful selection and benchmark failure.

Consumers must reject unknown `schemaVersion` values rather than interpreting
them as v1. New optional diagnostic payloads may be added within v1; changes to
required correlation, lifecycle meaning, or derivation formulas require a new
schema version.

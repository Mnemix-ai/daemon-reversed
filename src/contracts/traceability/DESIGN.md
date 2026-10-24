# Northsun trace schema (`northsun.trace.v0.1`)

Draft contract for Beacon's traceability layer. Readers are agents, not
dashboards: every field is typed, enumerated where the domain allows, and
versioned by `schema_version`. Unknown fields are rejected, so additions require
a version bump instead of silent drift.

- Schema and parser: [`beaconTraceSchema.ts`](beaconTraceSchema.ts)
- Synthetic fixtures: [`beaconTrace.fixture.ts`](beaconTrace.fixture.ts)
- Rules as tests: [`beaconTraceSchema.test.ts`](beaconTraceSchema.test.ts)

## Model

The span model follows Datadog Agent Observability (formerly LLM
Observability) and extends it for Northsun.

- **Trace**: one Gargantua run (`origin: gargantua_run`) or one Beacon delivery
  decision (`origin: beacon_delivery`). It has a 128-bit hex `trace_id`, trace
  identity, and a flat `spans` list that must form a single tree under exactly
  one root of kind `agent`.
- **Span**: `span_id` and `parent_span_id` (64-bit hex; `null` only on the
  root). It also has a `kind`, `name`, `start_time` (RFC 3339 UTC), and
  `duration_ns`. Status and error (`type`, `message`, `traceback`) must agree.
  The span carries `inputs`/`outputs` (value, messages, tool calls, tool
  results), typed `metadata` (temperature, max_tokens, ...), `metrics` (input,
  output, cached input and total tokens), and `tags`.
- **Kinds**: the seven Datadog kinds (`llm`, `workflow`, `agent`, `tool`,
  `task`, `embedding`, `retrieval`) plus `harness_event` and the decision kinds
  `infer`, `retrieve`, `rerank`, `deliver`, `reflect`, `decay`, `write`.
- **Context slice**: required on every decision kind. It lists memory ids,
  optional versions, content hashes, scores, and contiguous ranks in rank order,
  along with the assembled context as a content-addressed blob. The blob is
  `content_hash` plus `text` under full capture. This makes the reason for a
  decision replayable after the model has lost its context.
- **Identity**:
  - Trace level: harness name and version, agent id and role, tenant id,
    optional room id, and session id.
  - `llm` and `embedding` spans: model provider and model id.
  - Optional per-span `agent`: identifies sub-agents.
- **Capture**:
  - `capture.point` (`model_proxy`, `harness_hook`, `mcp_server`) records where
    Northsun captured the span on its own side.
  - `capture.mode` decides what survives. `full` keeps text and hash, and the
    hash must match the text. `hashed` and `withheld` keep only hashes.
  - `withheld` also requires `withheld_reason`.
- **Evals and outcomes**:
  - `evals` records `{evaluator, metric, score, threshold, direction, passed,
    receipt_id}`. `passed` must follow from score, threshold and direction.
  - `outcome_checks` (for example, `delivered_context_used`) records `true`,
    `false` or `"unknown"`. A decided result needs an `evidence_ref` URI.

## Querying

`parseBeaconTrace(input)` returns a `Result`: the typed trace, or a list of
`{rule, path, message}` issues. `rule` is an enumerated code (`orphan_span`,
`multiple_roots`, `missing_context_slice`, ..., or `schema` for structural
failures), so agents can branch on it without parsing messages.

`beaconTraceJsonSchema` is the draft 2020-12 structural contract for API and
MCP clients. Cross-span and cross-field rules (tree shape, rank order,
hash/text agreement, token totals, eval consistency) live only in the parser
because JSON Schema cannot express them.

## Open questions

- **Enum values are proposals.** Harness names, model providers, agent roles,
  harness events, withheld reasons and outcome checks are all draft lists.
  Extending one is a schema version bump.
- **Decision kinds.** `retrieve` is treated as a decision kind, because
  candidate selection is a decision Beacon must be able to replay.
  `harness_event` is not a decision kind.
- **No time containment check yet.** Child spans are not yet required to fall
  inside their parent's time window.
- **Content-addressed store not specified.** This sketch only fixes the
  address format (`sha256:<hex>`), not the store behind it.

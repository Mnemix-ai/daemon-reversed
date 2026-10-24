import { createHash } from "node:crypto";

import { z } from "zod";

import { type Result, err, ok } from "../../domain/result.js";

export const TRACE_SCHEMA_VERSION = "northsun.trace.v0.1";

const DATADOG_SPAN_KINDS = [
  "llm",
  "workflow",
  "agent",
  "tool",
  "task",
  "embedding",
  "retrieval",
] as const;

export const DECISION_SPAN_KINDS = [
  "infer",
  "retrieve",
  "rerank",
  "deliver",
  "reflect",
  "decay",
  "write",
] as const;

export const SPAN_KINDS = [
  ...DATADOG_SPAN_KINDS,
  "harness_event",
  ...DECISION_SPAN_KINDS,
] as const;

const MODEL_SPAN_KINDS: ReadonlySet<SpanKind> = new Set(["llm", "embedding"]);
const DECISION_KINDS: ReadonlySet<SpanKind> = new Set(DECISION_SPAN_KINDS);

const TRACE_RULES = [
  "schema",
  "duplicate_span_id",
  "missing_root",
  "multiple_roots",
  "non_agent_root",
  "orphan_span",
  "unreachable_span",
  "missing_context_slice",
  "context_rank_order",
  "harness_event_mismatch",
  "missing_model_identity",
  "status_error_mismatch",
  "capture_content_mismatch",
  "content_hash_mismatch",
  "token_count_mismatch",
  "eval_passed_mismatch",
  "outcome_evidence_missing",
] as const;

type SpanKind = (typeof SPAN_KINDS)[number];
type TraceRule = (typeof TRACE_RULES)[number];
type IssuePath = (string | number)[];

/** One machine-readable reason a trace document was rejected. */
export interface TraceIssue {
  readonly rule: TraceRule;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

const stableId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const snakeName = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/);
const reference = z.string().regex(/^[a-z][a-z0-9+.-]*:\S{1,512}$/);
const contentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const traceId = z.string().regex(/^[0-9a-f]{32}$/);
const spanId = z.string().regex(/^[0-9a-f]{16}$/);
const tokenCount = z.int().min(0);

/** Content is addressed by hash; `text` is present only under full capture. */
const capturedContent = z.strictObject({
  content_hash: contentHash,
  text: z.string().optional(),
});

const io = z.strictObject({
  value: capturedContent.optional(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: capturedContent,
      }),
    )
    .optional(),
  tool_calls: z
    .array(
      z.strictObject({
        tool_call_id: stableId,
        name: z.string().min(1).max(256),
        arguments: capturedContent,
      }),
    )
    .optional(),
  tool_results: z
    .array(
      z.strictObject({
        tool_call_id: stableId,
        result: capturedContent,
        is_error: z.boolean(),
      }),
    )
    .optional(),
});

const capture = z.strictObject({
  point: z.enum(["model_proxy", "harness_hook", "mcp_server"]),
  mode: z.enum(["full", "hashed", "withheld"]),
  withheld_reason: z.enum(["policy", "consent", "size_limit"]).optional(),
});

const modelIdentity = z.strictObject({
  provider: z.enum([
    "anthropic",
    "openai",
    "google",
    "mistral",
    "xai",
    "self_hosted",
  ]),
  model_id: z.string().min(1).max(128),
});

const agentIdentity = z.strictObject({
  agent_id: stableId,
  role: z.enum(["primary", "sub_agent", "reflector", "delivery"]),
});

const identity = z.strictObject({
  harness: z.strictObject({
    name: z.enum([
      "claude_code",
      "cursor",
      "codex",
      "claude_agent_sdk",
      "openai_agents_sdk",
      "custom",
    ]),
    version: z.string().min(1).max(64),
  }),
  agent: agentIdentity,
  tenant_id: stableId,
  room_id: stableId.optional(),
  session_id: stableId,
});

const contextSlice = z.strictObject({
  memories: z.array(
    z.strictObject({
      memory_id: stableId,
      version: z.int().min(1).optional(),
      content_hash: contentHash,
      score: z.number(),
      rank: z.int().min(1),
    }),
  ),
  assembled_context: capturedContent,
});

const evaluation = z.strictObject({
  evaluator: snakeName,
  metric: snakeName,
  score: z.number(),
  threshold: z.number(),
  direction: z.enum(["higher_is_better", "lower_is_better"]),
  passed: z.boolean(),
  receipt_id: stableId,
});

const outcomeCheck = z.strictObject({
  check: z.enum(["delivered_context_used"]),
  result: z.union([z.boolean(), z.literal("unknown")]),
  evidence_ref: reference.optional(),
});

const spanShape = z.strictObject({
  span_id: spanId,
  parent_span_id: spanId.nullable(),
  kind: z.enum(SPAN_KINDS),
  name: z.string().min(1).max(256),
  start_time: z.iso.datetime(),
  duration_ns: z.int().min(0),
  status: z.enum(["ok", "error"]),
  error: z
    .strictObject({
      type: z.string().min(1).max(256),
      message: z.string().max(4096),
      traceback: z.string().optional(),
    })
    .nullable(),
  harness_event: z
    .enum([
      "session_start",
      "user_prompt_submit",
      "pre_tool_use",
      "post_tool_use",
      "pre_compact",
      "stop",
      "subagent_stop",
      "session_end",
    ])
    .optional(),
  model: modelIdentity.optional(),
  agent: agentIdentity.optional(),
  capture,
  inputs: io.optional(),
  outputs: io.optional(),
  metadata: z.strictObject({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.int().min(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    seed: z.int().optional(),
    stop_sequences: z.array(z.string()).optional(),
  }),
  metrics: z.strictObject({
    input_tokens: tokenCount.optional(),
    output_tokens: tokenCount.optional(),
    cached_input_tokens: tokenCount.optional(),
    total_tokens: tokenCount.optional(),
  }),
  tags: z.record(z.string().regex(/^[a-z][a-z0-9_./-]{0,127}$/), z.string()),
  context_slice: contextSlice.optional(),
  evals: z.array(evaluation),
  outcome_checks: z.array(outcomeCheck),
});

type Span = z.infer<typeof spanShape>;
type Content = z.infer<typeof capturedContent>;
type Report = (rule: TraceRule, path: IssuePath, message: string) => void;

const sha256 = (text: string): string =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

const contentEntries = (span: Span): [IssuePath, Content][] => {
  const entries: [IssuePath, Content][] = [];
  for (const side of ["inputs", "outputs"] as const) {
    const value = span[side];
    if (value === undefined) continue;
    if (value.value) entries.push([[side, "value"], value.value]);
    value.messages?.forEach((message, index) =>
      entries.push([[side, "messages", index, "content"], message.content]),
    );
    value.tool_calls?.forEach((call, index) =>
      entries.push([[side, "tool_calls", index, "arguments"], call.arguments]),
    );
    value.tool_results?.forEach((result, index) =>
      entries.push([[side, "tool_results", index, "result"], result.result]),
    );
  }
  if (span.context_slice)
    entries.push([
      ["context_slice", "assembled_context"],
      span.context_slice.assembled_context,
    ]);
  return entries;
};

const checkCapture = (span: Span, report: Report): void => {
  const withheld = span.capture.mode === "withheld";
  if (withheld !== (span.capture.withheld_reason !== undefined))
    report(
      "capture_content_mismatch",
      ["capture", "withheld_reason"],
      "withheld_reason is required exactly when capture mode is withheld",
    );
  for (const [path, content] of contentEntries(span)) {
    if (span.capture.mode === "full" && content.text === undefined)
      report(
        "capture_content_mismatch",
        path,
        "full capture must keep content text",
      );
    if (span.capture.mode !== "full" && content.text !== undefined)
      report(
        "capture_content_mismatch",
        [...path, "text"],
        `${span.capture.mode} capture must keep only the content hash`,
      );
    if (
      content.text !== undefined &&
      sha256(content.text) !== content.content_hash
    )
      report(
        "content_hash_mismatch",
        [...path, "content_hash"],
        "content_hash must be the sha256 of the UTF-8 text",
      );
  }
};

const checkKindFields = (span: Span, report: Report): void => {
  if (DECISION_KINDS.has(span.kind) && span.context_slice === undefined)
    report(
      "missing_context_slice",
      ["context_slice"],
      `${span.kind} is a decision span and must record its context slice`,
    );
  if ((span.kind === "harness_event") !== (span.harness_event !== undefined))
    report(
      "harness_event_mismatch",
      ["harness_event"],
      "harness_event is required exactly on harness_event spans",
    );
  if (MODEL_SPAN_KINDS.has(span.kind) && span.model === undefined)
    report(
      "missing_model_identity",
      ["model"],
      `${span.kind} spans must identify the model provider and model id`,
    );
  if ((span.status === "error") !== (span.error !== null))
    report(
      "status_error_mismatch",
      ["error"],
      "error is required exactly when status is error",
    );
};

const checkContextSlice = (span: Span, report: Report): void => {
  const seen = new Set<string>();
  span.context_slice?.memories.forEach((memory, index) => {
    const path = ["context_slice", "memories", index];
    if (memory.rank !== index + 1)
      report(
        "context_rank_order",
        [...path, "rank"],
        "memories must be listed in rank order starting at 1",
      );
    if (seen.has(memory.memory_id))
      report(
        "context_rank_order",
        [...path, "memory_id"],
        "a memory may appear only once per context slice",
      );
    seen.add(memory.memory_id);
  });
};

const checkMetrics = (span: Span, report: Report): void => {
  const { input_tokens, output_tokens, cached_input_tokens, total_tokens } =
    span.metrics;
  if (
    total_tokens !== undefined &&
    total_tokens !== (input_tokens ?? 0) + (output_tokens ?? 0)
  )
    report(
      "token_count_mismatch",
      ["metrics", "total_tokens"],
      "total_tokens must equal input_tokens plus output_tokens",
    );
  if ((cached_input_tokens ?? 0) > (input_tokens ?? 0))
    report(
      "token_count_mismatch",
      ["metrics", "cached_input_tokens"],
      "cached_input_tokens cannot exceed input_tokens",
    );
};

const checkEvaluations = (span: Span, report: Report): void => {
  span.evals.forEach((evaluation, index) => {
    const passed =
      evaluation.direction === "higher_is_better"
        ? evaluation.score >= evaluation.threshold
        : evaluation.score <= evaluation.threshold;
    if (passed !== evaluation.passed)
      report(
        "eval_passed_mismatch",
        ["evals", index, "passed"],
        "passed must follow from score, threshold and direction",
      );
  });
  span.outcome_checks.forEach((check, index) => {
    if (check.result !== "unknown" && check.evidence_ref === undefined)
      report(
        "outcome_evidence_missing",
        ["outcome_checks", index, "evidence_ref"],
        "a decided outcome check must reference its evidence",
      );
  });
};

const reporter =
  (context: z.RefinementCtx, prefix: IssuePath = []): Report =>
  (rule, path, message) =>
    context.addIssue({
      code: "custom",
      path: [...prefix, ...path],
      message,
      params: { rule },
    });

const spanSchema = spanShape.superRefine((span, context) => {
  const report = reporter(context);
  checkKindFields(span, report);
  checkCapture(span, report);
  checkContextSlice(span, report);
  checkMetrics(span, report);
  checkEvaluations(span, report);
});

const checkTree = (spans: readonly Span[], report: Report): void => {
  const indexById = new Map<string, number>();
  spans.forEach((span, index) => {
    if (indexById.has(span.span_id))
      report("duplicate_span_id", [index, "span_id"], "span_id must be unique");
    else indexById.set(span.span_id, index);
  });
  const roots = spans.flatMap((span, index) =>
    span.parent_span_id === null ? [index] : [],
  );
  const [root, ...extraRoots] = roots;
  if (root === undefined) {
    report("missing_root", [], "a trace needs exactly one root span");
    return;
  }
  for (const index of extraRoots)
    report(
      "multiple_roots",
      [index, "parent_span_id"],
      "a trace has exactly one root span",
    );
  if (spans[root]?.kind !== "agent")
    report("non_agent_root", [root, "kind"], "the root span must be an agent");

  const children = new Map<string, number[]>();
  spans.forEach((span, index) => {
    if (span.parent_span_id === null) return;
    if (!indexById.has(span.parent_span_id))
      report(
        "orphan_span",
        [index, "parent_span_id"],
        "parent_span_id must reference a span in this trace",
      );
    const siblings = children.get(span.parent_span_id) ?? [];
    children.set(span.parent_span_id, [...siblings, index]);
  });

  const reached = new Set<number>(roots);
  const pending = [...roots];
  for (let index = pending.pop(); index !== undefined; index = pending.pop())
    for (const child of children.get(spans[index]?.span_id ?? "") ?? [])
      if (!reached.has(child)) {
        reached.add(child);
        pending.push(child);
      }
  spans.forEach((span, index) => {
    if (!reached.has(index) && indexById.has(span.parent_span_id ?? ""))
      report(
        "unreachable_span",
        [index, "parent_span_id"],
        "every span must descend from the root span",
      );
  });
};

const beaconTraceSchema = z
  .strictObject({
    schema_version: z.literal(TRACE_SCHEMA_VERSION),
    trace_id: traceId,
    origin: z.enum(["gargantua_run", "beacon_delivery"]),
    identity,
    spans: z.array(spanSchema).min(1),
  })
  .superRefine((trace, context) =>
    checkTree(trace.spans, reporter(context, ["spans"])),
  )
  .meta({
    title: "Northsun trace",
    description:
      "One Gargantua run or Beacon delivery decision. Tree, capture, ranking and consistency rules are enforced by parseBeaconTrace; this document carries the structural contract.",
  });

type BeaconTrace = z.infer<typeof beaconTraceSchema>;

/** Draft 2020-12 structural schema for API and MCP clients. */
export const beaconTraceJsonSchema = {
  ...z.toJSONSchema(beaconTraceSchema, { target: "draft-2020-12" }),
  $id: `urn:northsun:schema:${TRACE_SCHEMA_VERSION}`,
};

const isTraceRule = (value: unknown): value is TraceRule =>
  (TRACE_RULES as readonly unknown[]).includes(value);

const toTraceIssue = (issue: z.core.$ZodIssue): TraceIssue => {
  const rule =
    issue.code === "custom" && isTraceRule(issue.params?.rule)
      ? issue.params.rule
      : "schema";
  return {
    rule,
    path: issue.path.map((key) =>
      typeof key === "symbol" ? String(key) : key,
    ),
    message: issue.message,
  };
};

/** Parse an untrusted trace document into a validated trace or rule issues. */
export const parseBeaconTrace = (
  input: unknown,
): Result<BeaconTrace, readonly TraceIssue[]> => {
  const parsed = beaconTraceSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(parsed.error.issues.map(toTraceIssue));
};

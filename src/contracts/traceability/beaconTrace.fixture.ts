import { createHash } from "node:crypto";

/** Unvalidated trace document as an agent or capture point would submit it. */
export interface TraceDocument {
  schema_version: unknown;
  trace_id: unknown;
  origin: unknown;
  identity: Record<string, unknown>;
  spans: SpanDocument[];
}

export type SpanDocument = Record<string, unknown> & {
  span_id: string;
  parent_span_id: string | null;
  kind: string;
};

const SCHEMA_VERSION = "northsun.trace.v0.1";
const TRACE_START = Date.parse("2026-10-22T12:00:00.000Z");
const MS = 1_000_000;

export const sha256 = (text: string): string =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

const full = (text: string) => ({ content_hash: sha256(text), text });
const hashed = (text: string) => ({ content_hash: sha256(text) });
const at = (offsetMs: number): string =>
  new Date(TRACE_START + offsetMs).toISOString();

const MEMORIES = {
  style: ["mem_synthetic_style", 3, "Prefers small reviewed pull requests."],
  stack: ["mem_synthetic_stack", 1, "Project uses TypeScript with zod 4."],
  deploy: ["mem_synthetic_deploy", 7, "Deploys run from the main branch."],
  pets: ["mem_synthetic_pets", 2, "Has a synthetic cat named Vector."],
} as const;

const slice = (
  entries: ReadonlyArray<readonly [keyof typeof MEMORIES, number]>,
  assembled: string,
  captureFull = true,
) => ({
  memories: entries.map(([key, score], index) => {
    const [memoryId, version, body] = MEMORIES[key];
    return {
      memory_id: memoryId,
      version,
      content_hash: sha256(body),
      score,
      rank: index + 1,
    };
  }),
  assembled_context: captureFull ? full(assembled) : hashed(assembled),
});

const span = (fields: SpanDocument): SpanDocument => ({
  status: "ok",
  error: null,
  metadata: {},
  metrics: {},
  tags: {},
  evals: [],
  outcome_checks: [],
  ...fields,
});

const PROMPT = "Open a pull request for the schema change.";
const DELIVERED = [
  "- Prefers small reviewed pull requests.",
  "- Project uses TypeScript with zod 4.",
].join("\n");

const deliveryIntakeSpans = (): SpanDocument[] => [
  span({
    span_id: "a000000000000001",
    parent_span_id: null,
    kind: "agent",
    name: "beacon.delivery_decision",
    start_time: at(0),
    duration_ns: 182 * MS,
    capture: { point: "mcp_server", mode: "full" },
    inputs: { value: full(PROMPT) },
    outputs: { value: full("delivered 2 of 4 candidate memories") },
    tags: { "northsun.component": "beacon" },
  }),
  span({
    span_id: "a000000000000002",
    parent_span_id: "a000000000000001",
    kind: "harness_event",
    name: "claude_code.user_prompt_submit",
    start_time: at(0),
    duration_ns: 1 * MS,
    harness_event: "user_prompt_submit",
    capture: { point: "harness_hook", mode: "full" },
    inputs: { messages: [{ role: "user", content: full(PROMPT) }] },
  }),
  span({
    span_id: "a000000000000003",
    parent_span_id: "a000000000000001",
    kind: "infer",
    name: "beacon.infer_need",
    start_time: at(1),
    duration_ns: 41 * MS,
    capture: { point: "mcp_server", mode: "full" },
    inputs: { value: full(PROMPT) },
    outputs: {
      value: full(
        '{"context_needed":true,"latency_budget_ms":150,"importance":"high"}',
      ),
    },
    context_slice: slice(
      [["style", 0.62]],
      "- Prefers small reviewed pull requests.",
    ),
  }),
  span({
    span_id: "a000000000000004",
    parent_span_id: "a000000000000003",
    kind: "llm",
    name: "beacon.infer_need.classify",
    start_time: at(2),
    duration_ns: 38 * MS,
    model: { provider: "anthropic", model_id: "claude-haiku-4-5" },
    capture: { point: "model_proxy", mode: "hashed" },
    inputs: {
      messages: [
        { role: "system", content: hashed("Classify context need.") },
        { role: "user", content: hashed(PROMPT) },
      ],
    },
    outputs: { messages: [{ role: "assistant", content: hashed("high") }] },
    metadata: { temperature: 0, max_tokens: 64 },
    metrics: {
      input_tokens: 212,
      output_tokens: 9,
      cached_input_tokens: 180,
      total_tokens: 221,
    },
  }),
];

const deliveryRankingSpans = (): SpanDocument[] => [
  span({
    span_id: "a000000000000005",
    parent_span_id: "a000000000000001",
    kind: "retrieve",
    name: "beacon.retrieve_candidates",
    start_time: at(43),
    duration_ns: 58 * MS,
    capture: { point: "mcp_server", mode: "hashed" },
    inputs: { value: hashed(PROMPT) },
    context_slice: slice(
      [
        ["stack", 0.88],
        ["style", 0.81],
        ["deploy", 0.64],
        ["pets", 0.12],
      ],
      "candidate set",
      false,
    ),
  }),
  span({
    span_id: "a000000000000006",
    parent_span_id: "a000000000000005",
    kind: "embedding",
    name: "beacon.embed_query",
    start_time: at(44),
    duration_ns: 12 * MS,
    model: { provider: "openai", model_id: "text-embedding-3-small" },
    capture: {
      point: "model_proxy",
      mode: "withheld",
      withheld_reason: "policy",
    },
    inputs: { value: hashed(PROMPT) },
    metrics: { input_tokens: 11, total_tokens: 11 },
  }),
  span({
    span_id: "a000000000000007",
    parent_span_id: "a000000000000001",
    kind: "rerank",
    name: "beacon.rerank",
    start_time: at(102),
    duration_ns: 30 * MS,
    capture: { point: "mcp_server", mode: "hashed" },
    context_slice: slice(
      [
        ["style", 0.93],
        ["stack", 0.9],
        ["deploy", 0.41],
      ],
      "reranked set",
      false,
    ),
  }),
  span({
    span_id: "a000000000000008",
    parent_span_id: "a000000000000001",
    kind: "deliver",
    name: "beacon.deliver",
    start_time: at(133),
    duration_ns: 48 * MS,
    capture: { point: "mcp_server", mode: "full" },
    outputs: { value: full(DELIVERED) },
    context_slice: slice(
      [
        ["style", 0.93],
        ["stack", 0.9],
      ],
      DELIVERED,
    ),
    evals: [
      {
        evaluator: "jev",
        metric: "context_relevance",
        score: 0.91,
        threshold: 0.7,
        direction: "higher_is_better",
        passed: true,
        receipt_id: "rcpt_synthetic_0001",
      },
    ],
    outcome_checks: [{ check: "delivered_context_used", result: "unknown" }],
  }),
];

/** A Beacon delivery decision captured around one Claude Code prompt. */
export const syntheticBeaconDeliveryTrace = (): TraceDocument => ({
  schema_version: SCHEMA_VERSION,
  trace_id: "0af7651916cd43dd8448eb211c80319c",
  origin: "beacon_delivery",
  identity: {
    harness: { name: "claude_code", version: "2.1.0" },
    agent: { agent_id: "agent_synthetic_primary", role: "primary" },
    tenant_id: "tenant_synthetic_01",
    room_id: "room_synthetic_01",
    session_id: "session_synthetic_01",
  },
  spans: [...deliveryIntakeSpans(), ...deliveryRankingSpans()],
});

/** A Gargantua reflection run that writes one memory and decays another. */
export const syntheticGargantuaRunTrace = (): TraceDocument => ({
  schema_version: SCHEMA_VERSION,
  trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  origin: "gargantua_run",
  identity: {
    harness: { name: "claude_agent_sdk", version: "0.9.0" },
    agent: { agent_id: "agent_synthetic_reflector", role: "reflector" },
    tenant_id: "tenant_synthetic_01",
    session_id: "session_synthetic_02",
  },
  spans: [
    span({
      span_id: "b000000000000001",
      parent_span_id: null,
      kind: "agent",
      name: "gargantua.run",
      start_time: at(0),
      duration_ns: 90 * MS,
      capture: { point: "mcp_server", mode: "hashed" },
    }),
    span({
      span_id: "b000000000000002",
      parent_span_id: "b000000000000001",
      kind: "reflect",
      name: "gargantua.reflect",
      start_time: at(1),
      duration_ns: 40 * MS,
      capture: { point: "mcp_server", mode: "hashed" },
      context_slice: slice([["deploy", 0.7]], "reflection input", false),
    }),
    span({
      span_id: "b000000000000003",
      parent_span_id: "b000000000000002",
      kind: "write",
      name: "gargantua.write",
      start_time: at(42),
      duration_ns: 8 * MS,
      capture: { point: "mcp_server", mode: "hashed" },
      context_slice: slice([["stack", 1]], "written memory", false),
    }),
    span({
      span_id: "b000000000000004",
      parent_span_id: "b000000000000001",
      kind: "decay",
      name: "gargantua.decay",
      start_time: at(51),
      duration_ns: 20 * MS,
      capture: { point: "mcp_server", mode: "hashed" },
      context_slice: slice([["pets", 0.05]], "decayed memory", false),
    }),
  ],
});

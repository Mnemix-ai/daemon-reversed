import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  type SpanDocument,
  type TraceDocument,
  syntheticBeaconDeliveryTrace,
  syntheticGargantuaRunTrace,
} from "./beaconTrace.fixture.js";
import {
  DECISION_SPAN_KINDS,
  SPAN_KINDS,
  TRACE_SCHEMA_VERSION,
  beaconTraceJsonSchema,
  parseBeaconTrace,
} from "./beaconTraceSchema.js";

const violations = (input: unknown): string[] => {
  const result = parseBeaconTrace(input);
  return result.ok
    ? []
    : result.error.map((issue) => `${issue.rule}@${issue.path.join(".")}`);
};

const spanIndex = (trace: TraceDocument, kind: string): number => {
  const index = trace.spans.findIndex((span) => span.kind === kind);
  if (index < 0) throw new Error(`fixture has no ${kind} span`);
  return index;
};

const spanOf = (trace: TraceDocument, kind: string): SpanDocument =>
  trace.spans[spanIndex(trace, kind)] as SpanDocument;

describe("Beacon trace schema: accepted traces", () => {
  it("accepts the synthetic Beacon delivery trace", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const result = parseBeaconTrace(trace);

    expect(violations(trace)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(trace.spans.map((span) => span.kind)).toEqual(
      expect.arrayContaining([
        "agent",
        "harness_event",
        "infer",
        "retrieve",
        "rerank",
        "deliver",
      ]),
    );
  });

  it("accepts a valid Gargantua run tree", () => {
    expect(violations(syntheticGargantuaRunTrace())).toEqual([]);
  });

  it("pins the schema version and the fifteen span kinds", () => {
    expect(syntheticBeaconDeliveryTrace().schema_version).toBe(
      TRACE_SCHEMA_VERSION,
    );
    expect([...SPAN_KINDS].sort()).toEqual(
      [
        "llm",
        "workflow",
        "agent",
        "tool",
        "task",
        "embedding",
        "retrieval",
        "harness_event",
        "infer",
        "retrieve",
        "rerank",
        "deliver",
        "reflect",
        "decay",
        "write",
      ].sort(),
    );
  });
});

describe("Beacon trace schema: tree rules", () => {
  it("rejects an orphan span whose parent is not in the trace", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "rerank");
    spanOf(trace, "rerank").parent_span_id = "ffffffffffffffff";

    expect(violations(trace)).toContain(
      `orphan_span@spans.${String(index)}.parent_span_id`,
    );
  });

  it("rejects a second root span", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "deliver");
    spanOf(trace, "deliver").parent_span_id = null;

    expect(violations(trace)).toContain(
      `multiple_roots@spans.${String(index)}.parent_span_id`,
    );
  });

  it("rejects a root span that is not of kind agent", () => {
    const trace = syntheticBeaconDeliveryTrace();
    (trace.spans[0] as SpanDocument).kind = "workflow";

    expect(violations(trace)).toContain("non_agent_root@spans.0.kind");
  });

  it("rejects spans that form a cycle detached from the root", () => {
    const trace = syntheticBeaconDeliveryTrace();
    spanOf(trace, "rerank").parent_span_id = "a000000000000008";
    spanOf(trace, "deliver").parent_span_id = "a000000000000007";

    expect(violations(trace)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^unreachable_span@spans\.\d+\.parent_span_id$/),
      ]),
    );
  });
});

describe("Beacon trace schema: span rules", () => {
  it("rejects an unknown span kind", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "rerank");
    spanOf(trace, "rerank").kind = "guess";

    expect(violations(trace)).toContain(`schema@spans.${String(index)}.kind`);
  });

  it.each(["infer", "retrieve", "rerank", "deliver"])(
    "rejects a %s decision span without its context slice",
    (kind) => {
      expect(DECISION_SPAN_KINDS).toContain(kind);
      const trace = syntheticBeaconDeliveryTrace();
      const index = spanIndex(trace, kind);
      delete spanOf(trace, kind).context_slice;

      expect(violations(trace)).toContain(
        `missing_context_slice@spans.${String(index)}.context_slice`,
      );
    },
  );

  it("rejects a trace without harness identity", () => {
    const trace = syntheticBeaconDeliveryTrace();
    delete trace.identity.harness;

    expect(violations(trace)).toContain("schema@identity.harness");
  });

  it("rejects negative token counts", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "llm");
    spanOf(trace, "llm").metrics = {
      input_tokens: -5,
      output_tokens: 9,
      total_tokens: 4,
    };

    expect(violations(trace)).toContain(
      `schema@spans.${String(index)}.metrics.input_tokens`,
    );
  });

  it("rejects an eval score without a receipt id", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "deliver");
    spanOf(trace, "deliver").evals = [
      {
        evaluator: "jev",
        metric: "context_relevance",
        score: 0.91,
        threshold: 0.7,
        direction: "higher_is_better",
        passed: true,
      },
    ];

    expect(violations(trace)).toContain(
      `schema@spans.${String(index)}.evals.0.receipt_id`,
    );
  });

  it("rejects an invalid capture point", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "deliver");
    spanOf(trace, "deliver").capture = { point: "dashboard", mode: "full" };

    expect(violations(trace)).toContain(
      `schema@spans.${String(index)}.capture.point`,
    );
  });

  it("rejects content text kept on a withheld span", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const index = spanIndex(trace, "embedding");
    spanOf(trace, "embedding").inputs = {
      value: {
        content_hash: `sha256:${"0".repeat(64)}`,
        text: "leaked",
      },
    };

    expect(violations(trace)).toContain(
      `capture_content_mismatch@spans.${String(index)}.inputs.value.text`,
    );
  });

  it("rejects a context slice whose ranks are out of order", () => {
    const trace = syntheticBeaconDeliveryTrace();
    const deliver = spanOf(trace, "deliver");
    const index = spanIndex(trace, "deliver");
    const slice = deliver.context_slice as { memories: { rank: number }[] };
    (slice.memories[0] as { rank: number }).rank = 2;

    expect(violations(trace)).toContain(
      `context_rank_order@spans.${String(index)}.context_slice.memories.0.rank`,
    );
  });
});

describe("Beacon trace schema: exported JSON Schema", () => {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(beaconTraceJsonSchema);

  it("declares draft 2020-12 and accepts the synthetic fixtures", () => {
    expect(beaconTraceJsonSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(validate(syntheticBeaconDeliveryTrace())).toBe(true);
    expect(validate(syntheticGargantuaRunTrace())).toBe(true);
  });

  it("rejects an unknown span kind structurally", () => {
    const trace = syntheticBeaconDeliveryTrace();
    spanOf(trace, "rerank").kind = "guess";

    expect(validate(trace)).toBe(false);
  });
});

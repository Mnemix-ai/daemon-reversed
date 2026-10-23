import { z } from "zod";

import { type Result, ok } from "../../domain/result.js";

export const TRACE_SCHEMA_VERSION = "northsun.trace.v0.1";

export const SPAN_KINDS: readonly string[] = [];

export const DECISION_SPAN_KINDS: readonly string[] = [];

export interface TraceIssue {
  readonly rule: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

const beaconTraceSchema = z.unknown();

export const beaconTraceJsonSchema = z.toJSONSchema(beaconTraceSchema);

export const parseBeaconTrace = (
  input: unknown,
): Result<unknown, readonly TraceIssue[]> => ok(input);

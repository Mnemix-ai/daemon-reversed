// Wrap one CLI Evidence JSON record into a canonical bundle and export it.
// Usage: node scripts/export-evidence-record.mjs <record.json> <bundle.json>
import { readFile, writeFile } from "node:fs/promises";

import { createEvidenceBundle } from "../dist/domain/evidenceBundle.js";
import { parseEvidence } from "../dist/domain/evidence.js";

const [recordPath, bundlePath] = process.argv.slice(2);
if (recordPath === undefined || bundlePath === undefined) {
  process.stderr.write(
    "Usage: node scripts/export-evidence-record.mjs <record.json> <bundle.json>\n",
  );
  process.exit(1);
}

const record = parseEvidence(JSON.parse(await readFile(recordPath, "utf8")));
const bundle = createEvidenceBundle([record]);
await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
process.stdout.write(`${record.evidence_id}\n`);

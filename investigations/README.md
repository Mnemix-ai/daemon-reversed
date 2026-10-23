# Investigations

Use this directory when an agent studies a target and brings back evidence we can learn from.

Targets are software we own, open-source code, or applications we are licensed to analyse. Record the target's licence in every report. Do not investigate a target whose licence or ownership is unknown.

## Workflow

1. Name the target and the question. Create `investigations/<date>-<target-slug>/` using the UTC date and a short slug, and copy `investigations/TEMPLATE.md` to `report.md`.
2. Run the smallest REA workflow that can answer the question. Examples:
   - JavaScript or Electron directory or ASAR: `node scripts/rea.mjs analyze-javascript-application <path> --json`
   - Native binary with Ghidra: `node scripts/rea.mjs analyze <path> --provider ghidra --json`
   - ELF layout: `node scripts/rea.mjs inspect-binary-layout <path> --json`
   - APK classes: `node scripts/rea.mjs inspect-android-package <path> --json`
   - APK resources: `node scripts/rea.mjs decode-android-resources <path> --json`
   - WASM: `node scripts/rea.mjs inspect-wasm-artifact <path> --json`
   - .NET assembly: `node scripts/rea.mjs inspect-managed-artifact <path> --json`
   - HAR: `node scripts/rea.mjs inspect-web-network-capture <path> har --json`
   - Firmware regions: `node scripts/rea.mjs inspect-firmware-regions <path> --json`
3. Keep every Evidence ID. Save the CLI JSON, then export a canonical bundle:

```bash
node scripts/export-evidence-record.mjs record.json evidence-bundle.json
node scripts/rea.mjs evidence-export evidence-bundle.json evidence-bundle.canonical.json
```

4. Fill the report from the Evidence. Separate observations, inferences, and unknowns. Ideas we can adopt stay tied to an Evidence ID. Keep `evidence-bundle.canonical.json` as `rea evidence-export` wrote it.

The workstation image provides Ghidra 12.1.4, JADX, Apktool, Binwalk, Unblob, WABT 1.0.42, pwntools, mitmproxy, and radare2. `scripts/doctor.sh` checks them. Hopper and IDA are not installed.

One finished example is `investigations/2026-10-23-electron-api-demos/`. It studies the MIT-licensed Electron API Demos sources.

Project MCP configuration is `.cursor/mcp.json`. It launches the local build with `node scripts/rea.mjs mcp`. To register the user-level Cursor client without Hopper:

```bash
node scripts/rea.mjs setup --client cursor --yes
```

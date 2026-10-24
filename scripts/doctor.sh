#!/usr/bin/env bash
# Check each workstation engine, then run one small REA sample through it.
# Prints "<engine>: pass" or "<engine>: fail" and exits non-zero if any fail.
set -u

if [ -f /etc/profile.d/rea-workstation.sh ]; then
  # shellcheck disable=SC1091
  . /etc/profile.d/rea-workstation.sh
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REA=(node "${ROOT}/scripts/rea.mjs")
FAILED=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass() {
  printf '%s: pass (%s)\n' "$1" "$2"
}

fail() {
  printf '%s: fail (%s)\n' "$1" "$2"
  FAILED=1
}

first_line() {
  printf '%s\n' "$1" | head -n 1 | tr -d '\r'
}

check_version() {
  local name="$1"
  shift
  local output status=0
  output="$("$@" 2>&1)" || status=$?
  local line
  line="$(first_line "$output")"
  if [ "$status" -eq 0 ] && [ -n "$line" ]; then
    pass "$name" "$line"
    return 0
  fi
  fail "$name" "exit ${status} ${line}"
}

check_ghidra() {
  local props="${GHIDRA_INSTALL_DIR:-/opt/ghidra}/Ghidra/application.properties"
  local version=""
  if [ -f "$props" ]; then
    version="$(grep '^application.version=' "$props" | cut -d= -f2-)"
  fi
  if printf '%s' "$version" | grep -Eq '^12\.1\.'; then
    pass ghidra "application.version=${version}"
  else
    fail ghidra "expected Ghidra 12.1.x, found ${version:-missing}"
  fi
}

check_jadx() {
  local jar="${REA_JADX_MCP_JAR:-/opt/jadx/jadx-headless-mcp-0.7.1-all.jar}"
  local expected="6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75"
  local actual=""
  if [ -f "$jar" ]; then
    actual="$(sha256sum "$jar" | awk '{print $1}')"
  fi
  if [ "$actual" = "$expected" ]; then
    pass jadx "jadx-headless-mcp 0.7.1"
  else
    fail jadx "jar missing or checksum mismatch"
  fi
}

run_rea() {
  local name="$1"
  shift
  local out="${WORK}/${name}.json"
  local err="${WORK}/${name}.err"
  if "$@" >"$out" 2>"$err"; then
    if jq -e '(.evidence_id? | type == "string") or (.records[0].evidence_id? | type == "string")' "$out" >/dev/null 2>&1; then
      local id
      id="$(jq -r '.evidence_id // .records[0].evidence_id' "$out")"
      pass "$name" "evidence ${id}"
    else
      fail "$name" "no evidence id ($(head -c 180 "$out" | tr '\n' ' '))"
    fi
  else
    local status=$?
    fail "$name" "exit ${status} ($(tail -c 240 "$err" | tr '\n' ' '))"
  fi
}

check_version node node -v
check_version npm npm -v
check_version python python3 --version
check_version pip python3 -m pip --version
check_version openjdk java -version
check_ghidra
check_jadx
check_version apktool "${REA_APKTOOL_COMMAND:-apktool}" --version
check_version binwalk "${REA_BINWALK_COMMAND:-binwalk}" --version
check_version unblob "${REA_UNBLOB_COMMAND:-unblob}" --version
check_version wabt "${REA_WABT_BIN_DIRECTORY:-/opt/wabt/bin}/wasm-validate" --version
check_version pwntools "${REA_PWNTOOLS_PYTHON:-/opt/pwntools/bin/python}" -c 'import pwnlib; print("pwntools " + str(pwnlib.version))'
check_version mitmproxy "${REA_MITMDUMP_COMMAND:-mitmdump}" --version
check_version radare2 radare2 -v
check_version file file --version
check_version binutils objdump --version
check_version strings strings --version
check_version jq jq --version

cat > "${WORK}/hello.c" <<'EOF'
int answer(void) { return 42; }
int main(void) { return answer(); }
EOF
if gcc -o "${WORK}/hello.elf" "${WORK}/hello.c"; then
  pass sample-elf "${WORK}/hello.elf"
else
  fail sample-elf "gcc failed"
fi

cat > "${WORK}/hello.wat" <<'EOF'
(module (func (export "answer") (result i32) (i32.const 42)))
EOF
if "${REA_WABT_BIN_DIRECTORY:-/opt/wabt/bin}/wat2wasm" "${WORK}/hello.wat" -o "${WORK}/hello.wasm"; then
  pass sample-wasm "${WORK}/hello.wasm"
else
  fail sample-wasm "wat2wasm failed"
fi

printf 'hello firmware\n' | gzip > "${WORK}/firmware.gz"

mkdir -p "${WORK}/js-app"
cat > "${WORK}/js-app/package.json" <<'EOF'
{ "name": "rea-doctor-bundle", "version": "1.0.0", "private": true, "main": "main.js" }
EOF
cat > "${WORK}/js-app/main.js" <<'EOF'
const { app, BrowserWindow, ipcMain } = require("electron");
ipcMain.handle("notes:list", () => ["one"]);
app.whenReady().then(() => new BrowserWindow({ width: 400, height: 300 }));
EOF

cat > "${WORK}/sample.har" <<'EOF'
{
  "log": {
    "version": "1.2",
    "creator": { "name": "rea-workstation-doctor", "version": "1" },
    "entries": [
      {
        "startedDateTime": "2026-10-23T01:00:00.000Z",
        "time": 1,
        "request": {
          "method": "GET",
          "url": "https://example.test/health",
          "httpVersion": "HTTP/1.1",
          "cookies": [],
          "headers": [],
          "queryString": [],
          "headersSize": -1,
          "bodySize": 0
        },
        "response": {
          "status": 200,
          "statusText": "OK",
          "httpVersion": "HTTP/1.1",
          "cookies": [],
          "headers": [],
          "content": { "size": 2, "mimeType": "text/plain", "text": "ok" },
          "redirectURL": "",
          "headersSize": -1,
          "bodySize": 2
        },
        "cache": {},
        "timings": { "send": 0, "wait": 1, "receive": 0 }
      }
    ]
  }
}
EOF

r2_out="${WORK}/r2.txt"
if radare2 -q -c 'i' -c 'q' "${WORK}/hello.elf" >"$r2_out" 2>"${WORK}/r2.err"; then
  if grep -q 'elf' "$r2_out"; then
    pass radare2-sample "elf info"
  else
    fail radare2-sample "info listing had no elf marker"
  fi
else
  fail radare2-sample "radare2 exit $?"
fi

run_rea workflow-ghidra "${REA[@]}" analyze "${WORK}/hello.elf" --provider ghidra --json
run_rea workflow-pwntools "${REA[@]}" inspect-binary-layout "${WORK}/hello.elf" --json
run_rea workflow-jadx "${REA[@]}" inspect-android-package /opt/rea-samples/ApiDemos-debug.apk --json
run_rea workflow-apktool "${REA[@]}" decode-android-resources /opt/rea-samples/ApiDemos-debug.apk --json
run_rea workflow-binwalk "${REA[@]}" inspect-firmware-regions "${WORK}/firmware.gz" --json
run_rea workflow-unblob "${REA[@]}" extract-firmware "${WORK}/firmware.gz" "${WORK}/firmware-out" --json
run_rea workflow-wabt "${REA[@]}" inspect-wasm-artifact "${WORK}/hello.wasm" --json
run_rea workflow-dotnet "${REA[@]}" inspect-managed-artifact /opt/rea-samples/hello.dll --json
run_rea workflow-javascript "${REA[@]}" analyze-javascript-application "${WORK}/js-app" --json
run_rea workflow-har "${REA[@]}" inspect-web-network-capture "${WORK}/sample.har" har --json

if [ "$FAILED" -eq 0 ]; then
  printf 'result: pass\n'
  exit 0
fi
printf 'result: fail\n'
exit 1

#!/usr/bin/env bash
# Install the pinned reverse-engineering engines for the cloud workstation image.
# The script is idempotent. Re-running it keeps tools whose versions already match.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (Dockerfile RUN, or sudo)." >&2
  exit 1
fi

NODE_VERSION=24.18.0
GHIDRA_VERSION=12.1.4
GHIDRA_ZIP_NAME="ghidra_${GHIDRA_VERSION}_PUBLIC_20260921.zip"
GHIDRA_URL="https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/${GHIDRA_ZIP_NAME}"
# Official Ghidra 12.1.4 zip. REA admits 12.1.x and verifies 12.1.4.
# 12.2 is newer and is rejected by this REA release.
GHIDRA_SHA256="${GHIDRA_SHA256:-ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db}"
JADX_URL="https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar"
JADX_SHA256="6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75"
APKTOOL_URL="https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar"
APKTOOL_SHA256="${APKTOOL_SHA256:-dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423}"
WABT_URL="https://github.com/WebAssembly/wabt/releases/download/1.0.42/wabt-1.0.42-linux-x64.tar.gz"
APK_URL="https://github.com/appium/android-apidemos/releases/download/v6.0.18/ApiDemos-debug.apk"
APK_SHA256="a9eecf37b26cd084855c530db81c2bb1b91f4c1b095a04f47aa7c20e2791f686"
CACHE="${REA_ENGINE_CACHE:-/var/cache/rea-engines}"

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  xz-utils \
  unzip \
  build-essential \
  gcc \
  pkg-config \
  python3 \
  python3-pip \
  python3-venv \
  python3-dev \
  openjdk-21-jdk \
  file \
  binutils \
  jq \
  radare2 \
  sudo \
  libffi-dev \
  libssl-dev \
  zlib1g-dev \
  e2fsprogs \
  util-linux \
  mono-devel \
  p7zip-full \
  zstd \
  sleuthkit \
  cabextract \
  lz4 \
  lzop \
  device-tree-compiler \
  clang \
  liblzo2-dev \
  libucl-dev \
  liblz4-dev \
  libbz2-dev \
  libfontconfig1-dev \
  liblzma-dev \
  wget

mkdir -p "$CACHE" /opt/jadx /opt/rea-samples /usr/local/cargo/bin /usr/local/share /etc/profile.d

download() {
  local url="$1" dest="$2" sha="${3:-}"
  if [ -f "$dest" ]; then
    if [ -z "$sha" ] || [[ "$sha" == __* ]]; then
      return 0
    fi
    if echo "${sha}  ${dest}" | sha256sum -c -; then
      return 0
    fi
  fi
  curl -fL --retry 3 --retry-delay 2 -o "${dest}.partial" "$url"
  if [ -n "$sha" ] && [[ "$sha" != __* ]]; then
    echo "${sha}  ${dest}.partial" | sha256sum -c -
  fi
  mv "${dest}.partial" "$dest"
}

if ! /usr/local/bin/node -v 2>/dev/null | grep -qx "v${NODE_VERSION}"; then
  tmp="$(mktemp)"
  curl -fL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "$tmp"
  tar -xJf "$tmp" -C /usr/local --strip-components=1 --no-same-owner
  rm -f "$tmp"
fi
for tool in node npm npx corepack; do
  ln -sfn "/usr/local/bin/${tool}" "/usr/local/cargo/bin/${tool}"
done

java_home="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
ln -sfn "$java_home" /usr/lib/jvm/java-21

if [ ! -x /opt/ghidra/support/analyzeHeadless ]; then
  download "$GHIDRA_URL" "${CACHE}/${GHIDRA_ZIP_NAME}" "$GHIDRA_SHA256"
  rm -rf "/opt/ghidra_${GHIDRA_VERSION}_PUBLIC"
  unzip -q "${CACHE}/${GHIDRA_ZIP_NAME}" -d /opt
  ln -sfn "/opt/ghidra_${GHIDRA_VERSION}_PUBLIC" /opt/ghidra
  chmod -R a+rX "/opt/ghidra_${GHIDRA_VERSION}_PUBLIC"
fi

download "$JADX_URL" "${CACHE}/jadx-headless-mcp-0.7.1-all.jar" "$JADX_SHA256"
cp "${CACHE}/jadx-headless-mcp-0.7.1-all.jar" /opt/jadx/jadx-headless-mcp-0.7.1-all.jar
chmod a+r /opt/jadx/jadx-headless-mcp-0.7.1-all.jar

download "$APKTOOL_URL" "${CACHE}/apktool.jar" "$APKTOOL_SHA256"
cp "${CACHE}/apktool.jar" /usr/local/share/apktool.jar
chmod a+r /usr/local/share/apktool.jar
cat > /usr/local/bin/apktool <<'EOF'
#!/bin/sh
exec java -jar -Duser.language=en -Dfile.encoding=UTF8 /usr/local/share/apktool.jar "$@"
EOF
chmod 755 /usr/local/bin/apktool

if [ ! -x /opt/wabt/bin/wasm-validate ]; then
  download "$WABT_URL" "${CACHE}/wabt-1.0.42-linux-x64.tar.gz" ""
  curl -fsSL "${WABT_URL}.sha256" -o "${CACHE}/wabt-1.0.42-linux-x64.tar.gz.sha256"
  expected="$(awk '{print $1}' "${CACHE}/wabt-1.0.42-linux-x64.tar.gz.sha256")"
  echo "${expected}  ${CACHE}/wabt-1.0.42-linux-x64.tar.gz" | sha256sum -c -
  mkdir -p /opt/wabt
  tar -xzf "${CACHE}/wabt-1.0.42-linux-x64.tar.gz" -C /opt/wabt --strip-components=1
  chmod -R a+rX /opt/wabt
fi

download "$APK_URL" "${CACHE}/ApiDemos-debug.apk" "$APK_SHA256"
cp "${CACHE}/ApiDemos-debug.apk" /opt/rea-samples/ApiDemos-debug.apk
chmod a+r /opt/rea-samples/ApiDemos-debug.apk

if [ ! -f /opt/rea-samples/hello.dll ]; then
  cat > "${CACHE}/hello.il" <<'EOF'
.assembly extern mscorlib
{
  .publickeytoken = (B7 7A 5C 56 19 34 E0 89 )
  .ver 4:0:0:0
}
.assembly hello
{
  .ver 1:0:0:0
}
.module hello.dll
.class public auto ansi beforefieldinit Hello extends [mscorlib]System.Object
{
  .method public hidebysig static void Main() cil managed
  {
    .entrypoint
    ret
  }
}
EOF
  ilasm -dll -output="${CACHE}/hello.dll" "${CACHE}/hello.il"
  cp "${CACHE}/hello.dll" /opt/rea-samples/hello.dll
  chmod a+r /opt/rea-samples/hello.dll
fi

if ! /usr/local/bin/binwalk --version 2>/dev/null | grep -q '^binwalk 3\.1\.'; then
  export CARGO_HOME="${CACHE}/cargo"
  export RUSTUP_HOME="${CACHE}/rustup"
  if [ ! -x "${CARGO_HOME}/bin/cargo" ]; then
    curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  fi
  # shellcheck disable=SC1091
  . "${CARGO_HOME}/env"
  src="${CACHE}/binwalk-src"
  rm -rf "$src"
  git clone --depth 1 --branch v3.1.0 https://github.com/ReFirmLabs/binwalk.git "$src"
  (cd "$src" && cargo build --release --locked -j 2)
  install -m 755 "${src}/target/release/binwalk" /usr/local/bin/binwalk
  rm -rf "$src" "${CARGO_HOME}" "${RUSTUP_HOME}"
fi

make_venv() {
  local dest="$1"
  shift
  if [ ! -x "${dest}/bin/python" ]; then
    python3 -m venv "$dest"
  fi
  "${dest}/bin/pip" install "$@"
  chmod -R a+rX "$dest"
}

make_venv /opt/pwntools "pwntools==4.15.0" "pyelftools==0.33" "unicorn==2.1.2"
/opt/pwntools/bin/pip install "pyelftools==0.33" "unicorn==2.1.2"
make_venv /opt/unblob "unblob==26.6.4"
make_venv /opt/mitmproxy "mitmproxy==12.2.3"

cat > /etc/profile.d/rea-workstation.sh <<'EOF'
export GHIDRA_INSTALL_DIR=/opt/ghidra
export JAVA_HOME=/usr/lib/jvm/java-21
export REA_JADX_MCP_JAR=/opt/jadx/jadx-headless-mcp-0.7.1-all.jar
export REA_WABT_BIN_DIRECTORY=/opt/wabt/bin
export REA_PWNTOOLS_PYTHON=/opt/pwntools/bin/python
export REA_BINWALK_COMMAND=/usr/local/bin/binwalk
export REA_UNBLOB_COMMAND=/opt/unblob/bin/unblob
export REA_MITMDUMP_COMMAND=/opt/mitmproxy/bin/mitmdump
export REA_APKTOOL_COMMAND=/usr/local/bin/apktool
export PATH="/usr/local/bin:/opt/wabt/bin:${JAVA_HOME}/bin:${PATH}"
EOF
chmod 644 /etc/profile.d/rea-workstation.sh

apt-get purge -y mono-devel || true
apt-get autoremove -y
rm -rf /var/lib/apt/lists/*

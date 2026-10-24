FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    GHIDRA_INSTALL_DIR=/opt/ghidra \
    JAVA_HOME=/usr/lib/jvm/java-21 \
    REA_JADX_MCP_JAR=/opt/jadx/jadx-headless-mcp-0.7.1-all.jar \
    REA_WABT_BIN_DIRECTORY=/opt/wabt/bin \
    REA_PWNTOOLS_PYTHON=/opt/pwntools/bin/python \
    REA_BINWALK_COMMAND=/usr/local/bin/binwalk \
    REA_UNBLOB_COMMAND=/opt/unblob/bin/unblob \
    REA_MITMDUMP_COMMAND=/opt/mitmproxy/bin/mitmdump \
    REA_APKTOOL_COMMAND=/usr/local/bin/apktool \
    PATH=/usr/local/bin:/opt/wabt/bin:/usr/lib/jvm/java-21/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

COPY install-engines.sh /tmp/install-engines.sh
RUN bash /tmp/install-engines.sh && rm -f /tmp/install-engines.sh \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 440 /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /workspace

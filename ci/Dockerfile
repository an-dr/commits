# The one build environment for every platform, locally and in CI.
# docs/ci.md explains the choices; scripts/ci-docker.sh builds and runs it.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git xz-utils python3 \
      build-essential cmake ninja-build pkg-config \
      clang-19 lld-19 llvm-19 \
      libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      libasound2-dev libxss-dev libssl-dev \
 && curl -fsSL https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb -o /tmp/ms.deb \
 && dpkg -i /tmp/ms.deb && rm /tmp/ms.deb \
 && apt-get update && apt-get install -y --no-install-recommends powershell \
 && rm -rf /var/lib/apt/lists/*

# 22.12 exits silently inside componentize-js on Windows ARM64; 22.23.2 is
# the version every build has been verified with.
ARG NODE_VERSION=22.23.2
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
      | tar -xJ -C /usr/local --strip-components=1

# World-writable so the container can run as the caller's own user.
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
ARG CARGO_XWIN_VERSION=0.23.1
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
 && rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc \
 && curl -fsSL https://github.com/rust-cross/cargo-xwin/releases/download/v${CARGO_XWIN_VERSION}/cargo-xwin-v${CARGO_XWIN_VERSION}.x86_64-unknown-linux-musl.tar.gz \
      | tar -xz -C /opt/cargo/bin \
 && chmod -R a+rwX /opt/rustup /opt/cargo

# clang 19 for every C build; see docs/ci.md for why the wrapper exists.
RUN for tool in clang++ lld lld-link ld.lld llvm-lib llvm-ar llvm-rc llvm-dlltool; do \
      ln -s /usr/lib/llvm-19/bin/$tool /usr/local/bin/$tool; done
COPY clang-wrapper /usr/local/bin/clang
RUN chmod 755 /usr/local/bin/clang && ln -s /usr/local/bin/clang /usr/local/bin/clang-cl

# The repository is mounted from outside, owned by whoever cloned it.
RUN git config --system --add safe.directory '*'

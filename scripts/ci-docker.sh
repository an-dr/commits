#!/usr/bin/env bash
# Runs the CI job for one platform in the ci/Dockerfile image -- the same
# command GitHub Actions runs. See docs/ci.md.
#
#   scripts/ci-docker.sh <linux-x64|windows-x64|windows-arm64> [tag]
set -euo pipefail

platform=${1:?usage: scripts/ci-docker.sh <linux-x64|windows-x64|windows-arm64> [tag]}
tag=${2:-}
root=$(cd "$(dirname "$0")/.." && pwd)
cache=${COMMITS_CI_CACHE:-$HOME/.cache/commits-ci}
image=${COMMITS_CI_IMAGE:-commits-ci}
task_args=(--platform "$platform")
if [[ -n "$tag" ]]; then task_args+=(--tag "$tag"); fi

mkdir -p "$cache/cargo" "$cache/xwin" "$cache/home"
docker build --platform linux/amd64 -t "$image" "$root/ci"

# As the caller's own user, so nothing written into the checkout is left
# owned by root.
docker run --rm --platform linux/amd64 \
  --user "$(id -u):$(id -g)" \
  -v "$root:/work" -v "$cache:/cache" -w /work \
  -e HOME=/cache/home \
  -e CARGO_HOME=/cache/cargo \
  -e XWIN_CACHE_DIR=/cache/xwin \
  -e XWIN_ACCEPT_LICENSE=1 \
  -e CI="${CI:-}" \
  "$image" cargo xtask ci "${task_args[@]}"

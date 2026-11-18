#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${FRONT_REPO_ROOT:-${script_dir}/../../..}" && pwd)"
image="${AUTO_EVAL_IMAGE:-front-auto-eval:0.1.0}"
codex_version="${AUTO_EVAL_CODEX_VERSION:-0.147.0}"

if ! command -v docker >/dev/null 2>&1 && [[ -x "${HOME}/.docker/bin/docker" ]]; then
  export PATH="${HOME}/.docker/bin:${PATH}"
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found on PATH" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not available; start Docker Desktop or your Docker runtime" >&2
  exit 1
fi

build_args=(
  --build-arg "CODEX_VERSION=${codex_version}"
)
for proxy_name in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
  proxy_value="${!proxy_name-}"
  if [[ -n "${proxy_value}" ]]; then
    build_args+=(--build-arg "${proxy_name}=${proxy_value}")
  fi
done

docker build \
  "${build_args[@]}" \
  --file "${repo_root}/src/evaluation/Dockerfile" \
  --tag "${image}" \
  "${repo_root}"

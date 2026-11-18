#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${FRONT_REPO_ROOT:-${script_dir}/../../../..}" && pwd)"
image="${OPENHANDS_HARNESS_IMAGE:-front-openhands-harness:1.41.0}"
pypi_index_url="${FRONT_PYPI_INDEX_URL:-https://pypi.org/simple}"
playwright_version="$(
  tr -d '[:space:]' < "${repo_root}/src/generation/playwright-version.txt"
)"

if [[ ! "${playwright_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid Playwright version: ${playwright_version}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 && [[ -x "${HOME}/.docker/bin/docker" ]]; then
  export PATH="${HOME}/.docker/bin:${PATH}"
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found on PATH" >&2
  exit 1
fi

docker build \
  --build-arg "PLAYWRIGHT_VERSION=${playwright_version}" \
  --build-arg "UV_DEFAULT_INDEX=${pypi_index_url}" \
  --file "${repo_root}/src/generation/openhands/Dockerfile" \
  --tag "${image}" \
  "${repo_root}"

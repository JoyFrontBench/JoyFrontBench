#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${FRONT_REPO_ROOT:-${script_dir}/../../../..}" && pwd)"
env_file="${repo_root}/.env"
env_example="${repo_root}/.env.example"

if ! command -v docker >/dev/null 2>&1 && [[ -x "${HOME}/.docker/bin/docker" ]]; then
  export PATH="${HOME}/.docker/bin:${PATH}"
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found on PATH" >&2
  echo "Install Docker Desktop or another Docker-compatible runtime, then rerun this script." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not available; start Docker Desktop or your Docker runtime" >&2
  exit 1
fi
if [[ ! -f "${env_example}" ]]; then
  echo "missing environment template: ${env_example}" >&2
  exit 1
fi

created_env=false
if [[ ! -f "${env_file}" ]]; then
  cp "${env_example}" "${env_file}"
  created_env=true
fi

"${script_dir}/build-image.sh"

echo
echo "OpenCode harness image is ready."
if [[ "${created_env}" == "true" ]]; then
  echo "Created ${env_file} from .env.example."
fi
echo "Set OPENAI_API_KEY in .env; the remaining settings have defaults."
echo "Then run:"
echo "  ${script_dir}/run.sh run --task 001 --model your-model-id"

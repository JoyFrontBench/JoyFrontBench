#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${FRONT_REPO_ROOT:-${script_dir}/../../..}" && pwd)"
declare -A env_file_external=()
declare -A env_file_seen=()
env_file_keys=()

load_env_file() {
  local file="$1"
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line:0:1}" == "#" ]] && continue
    if [[ "${line}" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    if [[ "${line}" != *=* ]]; then
      echo "invalid .env line in ${file}: expected KEY=VALUE" >&2
      exit 2
    fi
    key="${line%%=*}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "invalid .env key in ${file}: ${key}" >&2
      exit 2
    fi
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    if [[ ${#value} -ge 2 && "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ ${#value} -ge 2 && "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    else
      value="${value%"${value##*[![:space:]]}"}"
    fi
    if [[ -z "${env_file_seen[${key}]+x}" ]]; then
      env_file_seen["${key}"]=1
      env_file_keys+=("${key}")
      if [[ -n "${!key+x}" ]]; then
        env_file_external["${key}"]=1
      fi
    fi
    if [[ -z "${env_file_external[${key}]+x}" ]]; then
      printf -v "${key}" '%s' "${value}"
      export "${key}"
    fi
  done < "${file}"
}

env_file_explicit=false
if [[ -n "${AUTO_EVAL_ENV_FILE+x}" ]]; then
  env_file_explicit=true
fi
if [[ "${env_file_explicit}" == "true" ]]; then
  env_file="${AUTO_EVAL_ENV_FILE}"
elif [[ -f "${repo_root}/.env" ]]; then
  env_file="${repo_root}/.env"
elif [[ -f "${repo_root}/src/evaluation/.env" ]]; then
  env_file="${repo_root}/src/evaluation/.env"
else
  env_file=""
fi
if [[ -n "${env_file}" ]]; then
  if [[ ! -f "${env_file}" ]]; then
    if [[ "${env_file_explicit}" == "true" ]]; then
      echo "AUTO_EVAL_ENV_FILE does not exist: ${env_file}" >&2
      exit 1
    fi
    env_file=""
  else
    env_file="$(cd -- "$(dirname -- "${env_file}")" && pwd)/$(basename -- "${env_file}")"
    load_env_file "${env_file}"
  fi
fi

image="${AUTO_EVAL_IMAGE:-front-auto-eval:0.1.0}"
output_root="${EVAL_OUTPUT_ROOT:-${repo_root}/eval-output}"
codex_home="${AUTO_EVAL_CODEX_HOME:-${CODEX_HOME:-${HOME}/.codex}}"
codex_workspace="${CODEX_WORKSPACE:-}"
codex_workspace_mode="${AUTO_EVAL_CODEX_WORKSPACE_MODE:-ro}"
benchmark_source="${EVAL_BENCHMARK_PATH:-}"
benchmark_root_source="${EVAL_BENCHMARK_ROOT:-}"
prompts_source="${EVAL_PROMPTS_PATH:-${repo_root}/data}"
runs_source="${EVAL_RUNS_ROOT:-}"
workspace_root_source="${EVAL_WORKSPACE_ROOT:-}"
references_source=""

usage() {
  cat <<'EOF'
Usage:
  ./src/evaluation/scripts/docker-run.sh eval --prompts /path/to/data --workspace /path/to/question --id frontenjoyai-029 [options]
  ./src/evaluation/scripts/docker-run.sh eval:pipeline --prompts /path/to/data --workspace /path/to/question --id frontenjoyai-029 [options]
  ./src/evaluation/scripts/docker-run.sh eval:batch --workspace-root /path/to/candidate [--jobs 4] [options]
  ./src/evaluation/scripts/docker-run.sh judge --prompts /path/to/data [options]
  ./src/evaluation/scripts/docker-run.sh judge:strict --prompts /path/to/data [options]
  ./src/evaluation/scripts/docker-run.sh score:final --prompts /path/to/data --runs-root /path/to/pipeline/runs [options]
  ./src/evaluation/scripts/docker-run.sh references:verify [--root /path/to/references]
  ./src/evaluation/scripts/docker-run.sh check
  ./src/evaluation/scripts/docker-run.sh test
  ./src/evaluation/scripts/docker-run.sh codex --workspace /path/to/workspace [codex options]

Environment:
  AUTO_EVAL_IMAGE     Override the Docker image name.
  AUTO_EVAL_ENV_FILE  Dotenv file loaded before startup. By default, use the
                      repository-root .env, then fall back to src/evaluation/.env.
                      Set to an empty value to disable dotenv loading.
  AUTO_EVAL_CODEX_VERSION
                      Override the Codex CLI version installed while building.
  AUTO_EVAL_SKIP_BUILD
                      Set to true to reuse an existing image.
  AUTO_EVAL_CODEX_HOME
                      Host Codex state directory mounted at /codex-home.
  AUTO_EVAL_CODEX_WORKSPACE_MODE
                      Set to rw for the direct codex command; default is ro.
  CODEX_REASONING_EFFORT
                      GPT-5.5 reasoning level: low, medium, high, or xhigh.
  CODEX_WORKSPACE     Default host workspace.
  EVAL_OUTPUT_ROOT    Host directory for reports, screenshots, and data.
  EVAL_PROMPTS_PATH   Default task/judge prompt repository.
  EVAL_BENCHMARK_PATH Default benchmark workspace for eval:pipeline.
  EVAL_WORKSPACE_ROOT Default candidate workspace root for eval:batch.
  EVAL_BENCHMARK_ROOT Default benchmark workspace root for eval:batch.
  EVAL_RUNS_ROOT      Default completed pipeline runs root for score:final.
  PLAYWRIGHT_PROXY    Optional browser proxy visible inside the container.
EOF
}

resolve_dir() {
  local candidate="$1"
  if [[ ! -d "${candidate}" ]]; then
    echo "input directory does not exist: ${candidate}" >&2
    exit 1
  fi
  (cd -- "${candidate}" && pwd)
}

resolve_existing() {
  local candidate="$1"
  if [[ ! -e "${candidate}" ]]; then
    echo "input path does not exist: ${candidate}" >&2
    exit 1
  fi
  local parent
  parent="$(cd -- "$(dirname -- "${candidate}")" && pwd)"
  printf '%s/%s\n' "${parent}" "$(basename -- "${candidate}")"
}

if [[ $# -eq 0 || "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

command_name="$1"
shift
case "${command_name}" in
  eval | eval:pipeline | eval:batch | judge | judge:strict | score:final | references:verify | verify:references | check | test | codex) ;;
  *)
    echo "unknown command: ${command_name}" >&2
    usage >&2
    exit 2
    ;;
esac
if [[ "${command_name}" == "eval" ]]; then
  command_name="eval:pipeline"
elif [[ "${command_name}" == "verify:references" ]]; then
  command_name="references:verify"
fi
if [[ "${command_name}" != "codex" ]]; then
  for argument in "$@"; do
    if [[ "${argument}" == "--help" || "${argument}" == "-h" ]]; then
      exec node "${script_dir}/cli.mjs" "${command_name}" --help
    fi
  done
fi
if [[ "${command_name}" == "eval:pipeline" && -z "${EVAL_OUTPUT_ROOT:-}" ]]; then
  output_root="${repo_root}/eval-output/pipeline/$(date '+%Y%m%d-%H%M%S')-$$"
elif [[ "${command_name}" == "eval:batch" && -z "${EVAL_OUTPUT_ROOT:-}" ]]; then
  output_root="${repo_root}/eval-output/batch/$(date '+%Y%m%d-%H%M%S')-$$"
elif [[ "${command_name}" == "score:final" && -z "${EVAL_OUTPUT_ROOT:-}" ]]; then
  output_root="${repo_root}/eval-output/final-score/$(date '+%Y%m%d-%H%M%S')-$$"
fi

forward_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || { echo "--root requires a path" >&2; exit 2; }
      references_source="$2"
      shift 2
      ;;
    --root=*)
      references_source="${1#*=}"
      shift
      ;;
    --prompts | --prompt-repository)
      [[ $# -ge 2 ]] || {
        echo "$1 requires a path" >&2
        exit 2
      }
      prompts_source="$2"
      shift 2
      ;;
    --prompts=* | --prompt-repository=*)
      prompts_source="${1#*=}"
      shift
      ;;
    --benchmark)
      [[ $# -ge 2 ]] || {
        echo "--benchmark requires a path" >&2
        exit 2
      }
      benchmark_source="$2"
      shift 2
      ;;
    --benchmark=*)
      benchmark_source="${1#--benchmark=}"
      shift
      ;;
    --benchmark-root)
      [[ $# -ge 2 ]] || {
        echo "--benchmark-root requires a path" >&2
        exit 2
      }
      benchmark_root_source="$2"
      shift 2
      ;;
    --benchmark-root=*)
      benchmark_root_source="${1#--benchmark-root=}"
      shift
      ;;
    --runs-root)
      [[ $# -ge 2 ]] || {
        echo "--runs-root requires a path" >&2
        exit 2
      }
      runs_source="$2"
      shift 2
      ;;
    --runs-root=*)
      runs_source="${1#--runs-root=}"
      shift
      ;;
    --output | --output-root)
      [[ $# -ge 2 ]] || {
        echo "$1 requires a path" >&2
        exit 2
      }
      output_root="$2"
      shift 2
      ;;
    --output=* | --output-root=*)
      output_root="${1#*=}"
      shift
      ;;
    --workspace)
      [[ $# -ge 2 ]] || {
        echo "--workspace requires a path" >&2
        exit 2
      }
      codex_workspace="$2"
      shift 2
      ;;
    --workspace=*)
      codex_workspace="${1#--workspace=}"
      shift
      ;;
    --workspace-root | --workspaces)
      [[ $# -ge 2 ]] || {
        echo "$1 requires a path" >&2
        exit 2
      }
      workspace_root_source="$2"
      shift 2
      ;;
    --workspace-root=* | --workspaces=*)
      workspace_root_source="${1#*=}"
      shift
      ;;
    --workspace-write)
      codex_workspace_mode="rw"
      shift
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

if [[ "${command_name}" == "eval:batch" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js >=18.19 is required for the batch scheduler" >&2
    exit 1
  fi
  prompts_source="$(resolve_dir "${prompts_source}")"
  workspace_root_source="$(resolve_dir "${workspace_root_source}")"
  if [[ -n "${benchmark_root_source}" ]]; then
    benchmark_root_source="$(resolve_dir "${benchmark_root_source}")"
  fi
fi

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
if [[ "${AUTO_EVAL_SKIP_BUILD:-false}" != "true" ]]; then
  "${script_dir}/docker-build.sh"
elif ! docker image inspect "${image}" >/dev/null 2>&1; then
  "${script_dir}/docker-build.sh"
fi

mkdir -p "${output_root}"
output_root="$(cd -- "${output_root}" && pwd)"
if [[ "${command_name}" == "eval:batch" ]]; then
  batch_args=(
    eval:batch "${forward_args[@]}"
    "--prompts=${prompts_source}"
    "--workspace-root=${workspace_root_source}"
    "--output-root=${output_root}"
    --executor=docker
  )
  if [[ -n "${benchmark_root_source}" ]]; then
    batch_args+=("--benchmark-root=${benchmark_root_source}")
  fi
  exec node "${script_dir}/cli.mjs" "${batch_args[@]}"
fi
mount_args=(--mount "type=bind,src=${output_root},dst=/output")
container_args=("${command_name}")

if [[ "${command_name}" == "codex" ]]; then
  if [[ -z "${codex_workspace}" ]]; then
    codex_workspace="${repo_root}"
  fi
  case "${codex_workspace_mode}" in
    ro | rw) ;;
    *)
      echo "AUTO_EVAL_CODEX_WORKSPACE_MODE must be ro or rw" >&2
      exit 2
      ;;
  esac
  codex_workspace="$(resolve_dir "${codex_workspace}")"
  mkdir -p "${codex_home}"
  codex_home="$(resolve_dir "${codex_home}")"
  workspace_mount="type=bind,src=${codex_workspace},dst=/workspace"
  if [[ "${codex_workspace_mode}" == "ro" ]]; then
    workspace_mount+=",readonly"
  fi
  mount_args+=(
    --mount "${workspace_mount}"
    --mount "type=bind,src=${codex_home},dst=/codex-home"
  )
elif [[ "${command_name}" == "eval:pipeline" ]]; then
  if [[ -z "${prompts_source}" || -z "${codex_workspace}" ]]; then
    echo "eval:pipeline requires --prompts and --workspace" >&2
    exit 2
  fi
  prompts_source="$(resolve_dir "${prompts_source}")"
  codex_workspace="$(resolve_dir "${codex_workspace}")"
  mkdir -p "${codex_home}"
  codex_home="$(resolve_dir "${codex_home}")"
  mount_args+=(
    --mount "type=bind,src=${prompts_source},dst=/input/prompts,readonly"
    --mount "type=bind,src=${codex_workspace},dst=/target,readonly"
    --mount "type=bind,src=${codex_home},dst=/codex-home"
  )
  container_args+=(--prompts=/input/prompts --workspace=/target --output-root=/output)
  if [[ -n "${benchmark_source}" ]]; then
    benchmark_source="$(resolve_existing "${benchmark_source}")"
    reference_directory="${benchmark_source}"
    [[ -d "${reference_directory}" ]] || reference_directory="$(dirname -- "${reference_directory}")"
    reference_root=""
    while [[ "${reference_directory}" != "/" ]]; do
      if [[ -f "${reference_directory}/manifest.json" ]] && \
        grep -Eq '"kind"[[:space:]]*:[[:space:]]*"frontend-visual-reference-set"' "${reference_directory}/manifest.json"; then
        reference_root="${reference_directory}"
        break
      fi
      reference_directory="$(dirname -- "${reference_directory}")"
    done
    if [[ -n "${reference_root}" ]]; then
      mount_args+=(--mount "type=bind,src=${reference_root},dst=/benchmark-set,readonly")
      if [[ "${benchmark_source}" == "${reference_root}" ]]; then
        container_args+=(--benchmark=/benchmark-set)
      else
        container_args+=("--benchmark=/benchmark-set/${benchmark_source#"${reference_root}/"}")
      fi
    else
      mount_args+=(--mount "type=bind,src=${benchmark_source},dst=/benchmark,readonly")
      container_args+=(--benchmark=/benchmark)
    fi
  fi
elif [[ "${command_name}" == "references:verify" ]]; then
  prompts_source="$(resolve_dir "${prompts_source}")"
  mount_args+=(--mount "type=bind,src=${prompts_source},dst=/input/prompts,readonly")
  container_args+=(--prompts=/input/prompts)
  if [[ -n "${references_source}" ]]; then
    references_source="$(resolve_dir "${references_source}")"
    mount_args+=(--mount "type=bind,src=${references_source},dst=/reference-set,readonly")
    container_args+=(--root=/reference-set)
  fi
elif [[ "${command_name}" == "judge" || "${command_name}" == "judge:strict" ]]; then
  if [[ -z "${prompts_source}" ]]; then
    echo "${command_name} requires --prompts" >&2
    exit 2
  fi
  prompts_source="$(resolve_dir "${prompts_source}")"
  mount_args+=(--mount "type=bind,src=${prompts_source},dst=/input/prompts,readonly")
  container_args+=(
    --prompts=/input/prompts
    --report-root=/output/reports
    --results=/output/reports/eval-summary-results.json
  )
elif [[ "${command_name}" == "score:final" ]]; then
  if [[ -z "${prompts_source}" || -z "${runs_source}" ]]; then
    echo "score:final requires --prompts and --runs-root" >&2
    exit 2
  fi
  prompts_source="$(resolve_dir "${prompts_source}")"
  runs_source="$(resolve_dir "${runs_source}")"
  mount_args+=(
    --mount "type=bind,src=${prompts_source},dst=/input/prompts,readonly"
    --mount "type=bind,src=${runs_source},dst=/input/runs,readonly"
  )
  container_args+=(
    --prompts=/input/prompts
    --runs-root=/input/runs
    --output-root=/output
  )
fi

if [[ ${#forward_args[@]} -gt 0 ]]; then
  container_args+=("${forward_args[@]}")
fi

env_args=()
[[ -n "${PLAYWRIGHT_PROXY:-}" ]] && env_args+=(--env PLAYWRIGHT_PROXY)
[[ -n "${HTTP_PROXY:-}" ]] && env_args+=(--env HTTP_PROXY)
[[ -n "${HTTPS_PROXY:-}" ]] && env_args+=(--env HTTPS_PROXY)
[[ -n "${NO_PROXY:-}" ]] && env_args+=(--env NO_PROXY)
[[ -n "${OPENAI_API_KEY:-}" ]] && env_args+=(--env OPENAI_API_KEY)
[[ -n "${CODEX_ACCESS_TOKEN:-}" ]] && env_args+=(--env CODEX_ACCESS_TOKEN)
[[ -n "${OPENAI_BASE_URL:-}" ]] && env_args+=(--env OPENAI_BASE_URL)
[[ -n "${EVAL_MODEL:-}" ]] && env_args+=(--env EVAL_MODEL)
[[ -n "${CODEX_PROVIDER:-}" ]] && env_args+=(--env CODEX_PROVIDER)
[[ -n "${CODEX_REASONING_EFFORT:-}" ]] && env_args+=(--env CODEX_REASONING_EFFORT)

dotenv_env_args=()
for env_name in "${env_file_keys[@]}"; do
  dotenv_env_args+=(--env "${env_name}")
done

docker_args=(
  run
  --rm
  --init
  --user "$(id -u):$(id -g)"
  --shm-size=2g
  --tmpfs /tmp:rw,exec,nosuid,size=2g
)
if [[ -n "${AUTO_EVAL_CONTAINER_NAME:-}" ]]; then
  docker_args+=(--name "${AUTO_EVAL_CONTAINER_NAME}")
fi
if [[ ${#dotenv_env_args[@]} -gt 0 ]]; then
  docker_args+=("${dotenv_env_args[@]}")
fi
if [[ "${command_name}" == "codex" ]]; then
  docker_args+=(--interactive --workdir /workspace)
  if [[ -t 0 && -t 1 ]]; then
    docker_args+=(--tty)
  fi
fi
docker_args+=("${mount_args[@]}")
if [[ ${#env_args[@]} -gt 0 ]]; then
  docker_args+=("${env_args[@]}")
fi
docker_args+=("${image}" "${container_args[@]}")

exec docker "${docker_args[@]}"

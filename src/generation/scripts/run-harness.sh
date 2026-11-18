#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${FRONT_REPO_ROOT:-${script_dir}/../../..}" && pwd)"
harness="$1"
shift
case "${harness}" in
  opencode) default_image=front-opencode-harness:1.18.16 ;;
  openhands) default_image=front-openhands-harness:1.41.0 ;;
  *) echo "Unknown harness: ${harness}" >&2; exit 2 ;;
esac
image_variable="${harness^^}_HARNESS_IMAGE"
runs_variable="${harness^^}_RUNS_ROOT"
build_variable="${harness^^}_SKIP_BUILD"
image="${!image_variable:-${default_image}}"
runs_root="${!runs_variable:-${repo_root}/runs/${harness}}"
tasks_root="${FRONT_TASKS_ROOT:-${repo_root}/data/tasks}"
pause_dir="${FRONT_HARNESS_PAUSE_DIR:-/tmp/front-harness-paused-models}"
base_env_file="${repo_root}/.env"
env_file="${FRONT_ENV_FILE:-${base_env_file}}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

validate_model() {
  [[ -n "${model}" && "${model}" != /* && "${model}" != *\\* &&
    "${model}" != *[[:space:][:cntrl:]]* ]] || die "invalid model ID: ${model}"
  case "/${model}/" in
    *'/./'*|*'/../'*|*'//'*) die "invalid model ID: ${model}" ;;
  esac
}

add_mount() {
  local source="src=$1" destination="dst=$2"
  if [[ "${source}" == *[\,\"]* ]]; then
    source="\"${source//\"/\"\"}\""
  fi
  if [[ "${destination}" == *[\,\"]* ]]; then
    destination="\"${destination//\"/\"\"}\""
  fi
  mount_args+=(--mount "type=bind,${source},${destination}${3:-}")
}

resolve_task() {
  local candidate task_name task_stem task_number
  local -a candidates=()
  if [[ "${task}" == /repo/data/tasks/* ]]; then
    task="${tasks_root}/${task#/repo/data/tasks/}"
  elif [[ "${task}" == '~/'* ]]; then
    task="${HOME}/${task:2}"
  fi
  candidates=("${task}" "${repo_root}/${task}" "${tasks_root}/${task}")
  [[ "${task##*/}" == *.* ]] || candidates+=("${tasks_root}/${task}.md")
  task_file=""
  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}" ]]; then
      task_file="${candidate}"
      break
    fi
  done
  if [[ -z "${task_file}" ]]; then
    candidates=()
    for candidate in "${tasks_root}/${task}"-*.md; do
      [[ ! -f "${candidate}" ]] || candidates+=("${candidate}")
    done
    if [[ "${task}" =~ ^((joyfrontbench|frontenjoyai)-)?([0-9]{3})$ ]]; then
      task_number="${BASH_REMATCH[3]}"
      for candidate in "${tasks_root}/joyfrontbench-${task_number}.md" \
        "${tasks_root}/frontenjoyai-${task_number}.md"; do
        [[ ! -f "${candidate}" ]] || candidates+=("${candidate}")
      done
    fi
    [[ ${#candidates[@]} -le 1 ]] || die "ambiguous task reference: ${task}"
    [[ ${#candidates[@]} -eq 1 ]] || die "task not found: ${task}"
    task_file="${candidates[0]}"
  fi
  task_file="$(realpath -- "${task_file}")"
  [[ "${task_file}" == "${tasks_root}/"* ]] || die "task must be inside ${tasks_root}"
  task_name="${task_file##*/}"
  task_stem="${task_name%.*}"
  task_stem="${task_stem:-${task_name}}"
  if [[ "${task_stem}" =~ ^(joyfrontbench|frontenjoyai)-([0-9]{3})$ ]]; then
    task_id="${BASH_REMATCH[2]}"
  elif [[ "${task_stem}" =~ ^([0-9]{3}) ]]; then
    task_id="${BASH_REMATCH[1]}"
  else
    task_id="$(printf '%s' "${task_stem}" | LC_ALL=C sed -E 's/[^a-zA-Z0-9._-]+/-/g; s/^-+//; s/-+$//')"
    task_id="${task_id:-task}"
  fi
  [[ "${task_id}" != . && "${task_id}" != .. ]] || die "unsafe task filename"
}

[[ -z "${FRONT_ENV_FILE:-}" || -f "${env_file}" ]] || die "Environment file not found: ${env_file}"
[[ -d "${tasks_root}" ]] || die "missing task directory: ${tasks_root}"
tasks_root="$(cd -- "${tasks_root}" && pwd -P)"
[[ $# -gt 0 ]] || set -- --help
container_args=("$@")
command="$1"
model=""
task=""
run_id=""
source_run=""
help=false
while [[ $# -gt 0 ]]; do
  option="${1%%=*}"
  case "${option}" in
    --model) variable=model ;;
    --task) variable=task ;;
    --run-id) variable=run_id ;;
    --source-run) variable=source_run ;;
    --help|-h) help=true; shift; continue ;;
    *) shift; continue ;;
  esac
  if [[ "$1" == *=* ]]; then
    value="${1#*=}"
    shift
  else
    [[ $# -ge 2 && "$2" != --* ]] || die "${option} requires a value"
    value="$2"
    shift 2
  fi
  [[ -n "${value}" ]] || die "${option} requires a value"
  printf -v "${variable}" '%s' "${value}"
done

run_dir=""
mount_args=()
add_mount "${tasks_root}" /repo/data/tasks ,readonly
if [[ "${help}" == false && ( "${command}" == run || "${command}" == resume ) ]]; then
  runs_root="$(realpath -m -- "${runs_root}")"
  if [[ "${command}" == run ]]; then
    validate_model
    [[ -n "${task}" ]] || die "--task is required"
    resolve_task
    run_id="${run_id:-$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')}"
    relative_run="${model}/${task_id}/${run_id}"
    container_args+=(--task "/repo/data/tasks/${task_file#"${tasks_root}/"}" --run-id "${run_id}")
  else
    case "${source_run}" in
      /runs/*) relative_run="${source_run#/runs/}" ;;
      "${runs_root}/"*) relative_run="${source_run#"${runs_root}/"}" ;;
      /*) die "source run must be inside ${runs_root}" ;;
      *) relative_run="${source_run}" ;;
    esac
    [[ "${relative_run}" == */*/* ]] || die "source run must identify one model/task/run"
    run_id="${relative_run##*/}"
    run_parent="${relative_run%/*}"
    task_id="${run_parent##*/}"
    model="${run_parent%/*}"
    validate_model
    [[ "${task_id}" =~ ^[A-Za-z0-9._-]+$ && "${task_id}" != . && "${task_id}" != .. ]] ||
      die "invalid task directory: ${task_id}"
    container_args+=(--source-run "/runs/${relative_run}")
  fi
  [[ "${run_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || die "invalid run ID: ${run_id}"
  run_dir="${runs_root}/${relative_run}"
  [[ "$(realpath -m -- "${run_dir}")" == "${run_dir}" ]] || die "run path must not contain symlinks"
  if [[ "${command}" == resume ]]; then
    [[ -f "${run_dir}/metadata.json" ]] || die "missing run metadata: ${run_dir}"
  else
    [[ ! -e "${run_dir}" && ! -L "${run_dir}" ]] || die "run directory already exists: ${run_dir}"
  fi
  container_args+=(--runs-root /runs)
  add_mount "${run_dir}" "/runs/${relative_run}"
fi

worker_pause_file=""
if [[ -n "${model}" && "${run_id}" =~ -w([0-9]+)- ]]; then
  worker_pause_file="${pause_dir}/${model}-w${BASH_REMATCH[1]}"
fi
while [[ "${help}" == false && -n "${run_dir}" ]]; do
  pause_file=""
  if [[ -e "${pause_dir}/${model}" ]]; then
    pause_file="${pause_dir}/${model}"
  elif [[ -n "${worker_pause_file}" && -e "${worker_pause_file}" ]]; then
    pause_file="${worker_pause_file}"
  fi
  [[ -n "${pause_file}" ]] || break
  echo "model ${model} is paused by ${pause_file}" >&2
  sleep 30
done

if ! command -v docker >/dev/null 2>&1 && [[ -x "${HOME}/.docker/bin/docker" ]]; then
  export PATH="${HOME}/.docker/bin:${PATH}"
fi
command -v docker >/dev/null 2>&1 || die "docker is required but was not found on PATH"
docker info >/dev/null 2>&1 || die "docker daemon is not available"
if [[ "${!build_variable:-false}" != true ]] || ! docker image inspect "${image}" >/dev/null 2>&1; then
  "${script_dir}/../${harness}/scripts/build-image.sh"
fi

env_args=()
[[ ! -f "${base_env_file}" ]] || env_args+=(--env-file "${base_env_file}")
if [[ "${env_file}" != "${base_env_file}" && -f "${env_file}" ]]; then
  env_args+=(--env-file "${env_file}")
fi
for variable in \
  OPENAI_API_KEY OPENAI_BASE_URL MODEL_WIRE_API MODEL_MAX_TOKENS \
  MODEL_CONTEXT_TOKENS MODEL_REASONING_EFFORT \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY \
  http_proxy https_proxy all_proxy no_proxy; do
  [[ -z "${!variable:-}" ]] || env_args+=(--env "${variable}")
done

if [[ -n "${run_dir}" ]]; then
  env_args+=(--env "FRONT_RUN_DIR=/runs/${relative_run}")
  if [[ "${command}" == run ]]; then
    mkdir -p -- "$(dirname -- "${run_dir}")"
    mkdir -- "${run_dir}"
    trap 'rmdir -- "${run_dir}" 2>/dev/null || true' EXIT
  fi
fi

docker run --rm --init \
  --user "$(id -u):$(id -g)" \
  --shm-size=2g \
  --tmpfs /tmp:rw,exec,nosuid,size=4g \
  "${mount_args[@]}" \
  "${env_args[@]}" \
  --env FRONT_REPO_ROOT=/repo \
  --env HOME=/tmp \
  "${image}" \
  "${container_args[@]}"

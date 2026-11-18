#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${FRONT_REPO_ROOT:-${script_dir}/../..}" && pwd)"

harness=""
harnesses_csv=""
task=""
tasks_csv=""
model_id=""
models_csv=""
context_tokens=""
max_output_tokens=""
reasoning_effort=""
wire_api=""
max_steps=""
timeout_seconds=""
run_id=""
jobs=1
tasks_root="${FRONT_TASKS_ROOT:-${repo_root}/data/tasks}"
runs_root=""
dry_run=false
skip_build=false
fail_fast=false

usage() {
  cat <<'EOF'
Generate frontend tasks with OpenCode or OpenHands, without judging.

Usage:
  ./src/scripts/run-benchmark.sh \
    --harness opencode --model your-model-id --task 001 [options]
  ./src/scripts/run-benchmark.sh \
    --harnesses opencode,openhands --models model-a,model-b --tasks all [options]

Selection (choose one option from each pair):
  --harness NAME          opencode or openhands
  --harnesses LIST        Comma-separated harnesses, in execution order
  --model NAME            One upstream model ID; no registration required
  --models LIST           Comma-separated model IDs (fallback: MODELS)
  --task ID_OR_PATH       One task ID or Markdown path inside the task directory
  --tasks LIST            Comma-separated task IDs, or all

Options:
  --context-tokens N      Override the context token budget
  --max-output-tokens N   Override output tokens per model call
  --reasoning-effort NAME Override reasoning effort
  --wire-api NAME         chat.completions, responses, or anthropic.messages
  --max-steps N           OpenCode steps or OpenHands iterations
  --timeout-seconds N     Optional wall-clock timeout per harness run
  --jobs N                Maximum concurrent models (default: 1)
  --run-id ID             Shared run ID; reuse it to skip/resume existing runs
  --tasks-root PATH       Task directory (default: data/tasks)
  --runs-root PATH        Output root (default: runs); contains <harness>/...
  --dry-run               Prepare new runs without model calls; never resume
  --skip-build            Reuse existing harness images
  --fail-fast             Stop scheduling after a failure; active runs finish
  -h, --help              Show this help

Each model runs its selected harnesses and tasks sequentially. Different models
can run concurrently with --jobs. Completed runs are skipped; incomplete runs
are resumed in place. Dry-run artifacts require a new run ID for a real run.
To resume a batch, reuse its --runs-root and --run-id.

Omitted generation options use the shared defaults in
src/generation/common/src/front_generation/defaults.py, with optional environment
overrides. Resumes keep saved settings unless explicitly overridden. Step counts
are harness-native, not equivalent model-call or tool-call counts.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

parse_csv() {
  local input="$1" value existing duplicate
  local -a raw_values=()
  [[ "${input}" != *$'\n'* && "${input}" != *$'\r'* ]] || die "lists must use one line"
  IFS=',' read -r -a raw_values <<< "${input}"
  parsed_values=()
  for value in "${raw_values[@]}"; do
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    [[ -n "${value}" ]] || continue
    duplicate=false
    for existing in "${parsed_values[@]}"; do
      [[ "${existing}" != "${value}" ]] || duplicate=true
    done
    [[ "${duplicate}" == "true" ]] || parsed_values+=("${value}")
  done
}

while [[ $# -gt 0 ]]; do
  option="${1%%=*}"
  case "${option}" in
    --harness) variable=harness ;;
    --harnesses) variable=harnesses_csv ;;
    --task) variable=task ;;
    --tasks) variable=tasks_csv ;;
    --model) variable=model_id ;;
    --models) variable=models_csv ;;
    --context-tokens) variable=context_tokens ;;
    --max-output-tokens) variable=max_output_tokens ;;
    --reasoning-effort|--effort) variable=reasoning_effort ;;
    --wire-api) variable=wire_api ;;
    --max-steps) variable=max_steps ;;
    --timeout-seconds) variable=timeout_seconds ;;
    --jobs) variable=jobs ;;
    --run-id) variable=run_id ;;
    --tasks-root) variable=tasks_root ;;
    --runs-root) variable=runs_root ;;
    --dry-run|--skip-build|--fail-fast)
      [[ "$1" == "${option}" ]] || die "${option} does not take a value"
      variable="${option#--}"
      printf -v "${variable//-/_}" '%s' true
      shift
      continue
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
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

if [[ -n "${harness}" ]]; then
  [[ -z "${harnesses_csv}" ]] || die "use either --harness or --harnesses, not both"
  case "${harness}" in
    opencode|openhands) ;;
    *) die "--harness must be opencode or openhands" ;;
  esac
  harnesses_csv="${harness}"
fi
[[ -n "${harnesses_csv}" ]] || die "--harness or --harnesses is required"
parse_csv "${harnesses_csv}"
harnesses=("${parsed_values[@]}")
[[ ${#harnesses[@]} -gt 0 ]] || die "no harnesses selected"
for harness in "${harnesses[@]}"; do
  case "${harness}" in
    opencode|openhands) ;;
    *) die "unsupported harness: ${harness}" ;;
  esac
done

if [[ -n "${model_id}" ]]; then
  [[ -z "${models_csv}" ]] || die "use either --model or --models, not both"
  models=("${model_id}")
else
  parse_csv "${models_csv:-${MODELS:-}}"
  models=("${parsed_values[@]}")
fi
[[ ${#models[@]} -gt 0 ]] || die "--model or --models is required"
for model in "${models[@]}"; do
  [[ ! "${model}" =~ [[:space:][:cntrl:]] && "${model}" != *\\* ]] ||
    die "invalid model ID: ${model}"
  case "/${model}/" in
    *//*|*/./*|*/../*) die "unsafe model ID: ${model}" ;;
  esac
done

[[ -z "${task}" || -z "${tasks_csv}" ]] || die "use either --task or --tasks, not both"
[[ -n "${task}${tasks_csv}" ]] || die "--task or --tasks is required"
for option in context_tokens max_output_tokens max_steps timeout_seconds jobs; do
  [[ -z "${!option}" || "${!option}" =~ ^[1-9][0-9]*$ ]] ||
    die "--${option//_/-} must be a positive integer"
done
case "${wire_api}" in
  ""|chat.completions|responses|anthropic.messages) ;;
  *) die "--wire-api must be chat.completions, responses, or anthropic.messages" ;;
esac
run_id="${run_id:-benchmark-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ ${#run_id} -le 128 ]] || die "--run-id must be at most 128 characters"
[[ "${run_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
  die "--run-id must use ASCII letters, digits, dots, dashes, or underscores"

shopt -s nullglob
tasks=()
task_arguments=()

add_numbered_task() {
  local number="${1#frontenjoyai-}" existing task_file
  number="${number#joyfrontbench-}"
  local -a matches=()
  [[ "${number}" =~ ^[0-9]{3}$ ]] || die "invalid task ID: $1"
  for existing in "${tasks[@]}"; do
    [[ "${existing}" != "${number}" ]] || return 0
  done
  for task_file in "${tasks_root}/joyfrontbench-${number}.md" \
    "${tasks_root}/frontenjoyai-${number}.md" \
    "${tasks_root}/${number}.md" "${tasks_root}/${number}-"*.md; do
    [[ ! -f "${task_file}" ]] || matches+=("${task_file}")
  done
  [[ ${#matches[@]} -gt 0 ]] || die "task not found: ${number}"
  [[ ${#matches[@]} -eq 1 ]] || die "ambiguous task ID: ${number}"
  tasks+=("${number}")
  task_arguments+=("${number}")
}

[[ -d "${tasks_root}" ]] || die "task directory does not exist: ${tasks_root}"
tasks_root="$(cd -- "${tasks_root}" && pwd -P)"
if [[ -n "${task}" && ! "${task}" =~ ^((joyfrontbench|frontenjoyai)-)?[0-9]{3}$ ]]; then
  task_file=""
  for candidate in "${task}" "${repo_root}/${task}" "${tasks_root}/${task}" \
    "${tasks_root}/${task}.md"; do
    if [[ -f "${candidate}" ]]; then
      task_file="${candidate}"
      break
    fi
  done
  [[ -n "${task_file}" ]] || die "task not found: ${task}"
  task_file="$(cd -- "$(dirname -- "${task_file}")" && pwd -P)/${task_file##*/}"
  [[ "${task_file}" == "${tasks_root}/"* ]] ||
    die "task path must be inside --tasks-root: ${task_file}"
  task_filename="${task_file##*/}"
  [[ "${task_filename}" == *.md ]] || die "task path must be a Markdown file"
  task_stem="${task_filename%.md}"
  [[ -n "${task_stem}" ]] || task_stem="${task_filename}"
  if [[ "${task_stem}" =~ ^(joyfrontbench|frontenjoyai)-([0-9]{3})$ ]]; then
    task_key="${BASH_REMATCH[2]}"
  elif [[ "${task_stem}" =~ ^([0-9]{3}) ]]; then
    task_key="${BASH_REMATCH[1]}"
  else
    task_key="$(printf '%s' "${task_stem}" | LC_ALL=C sed -E 's/[^a-zA-Z0-9._-]+/-/g; s/^-+//; s/-+$//')"
    task_key="${task_key:-task}"
  fi
  [[ "${task_key}" != . && "${task_key}" != .. ]] || die "unsafe task filename"
  tasks+=("${task_key}")
  task_arguments+=("/repo/data/tasks/${task_file#"${tasks_root}/"}")
else
  if [[ "${tasks_csv}" == "all" ]]; then
    discovered=()
    for task_file in "${tasks_root}"/joyfrontbench-[0-9][0-9][0-9].md \
      "${tasks_root}"/frontenjoyai-[0-9][0-9][0-9].md \
      "${tasks_root}"/[0-9][0-9][0-9].md "${tasks_root}"/[0-9][0-9][0-9]-*.md; do
      [[ -f "${task_file}" ]] || continue
      task_name="${task_file##*/}"
      task_name="${task_name#joyfrontbench-}"
      task_name="${task_name#frontenjoyai-}"
      discovered+=("${task_name:0:3}")
    done
    [[ ${#discovered[@]} -gt 0 ]] || die "no tasks selected"
    while IFS= read -r number; do
      add_numbered_task "${number}"
    done < <(printf '%s\n' "${discovered[@]}" | LC_ALL=C sort -u)
  else
    parse_csv "${task:-${tasks_csv}}"
    for reference in "${parsed_values[@]}"; do
      add_numbered_task "${reference}"
    done
  fi
fi
[[ ${#tasks[@]} -gt 0 ]] || die "no tasks selected"

command -v jq >/dev/null 2>&1 || die "jq is required"
command -v pgrep >/dev/null 2>&1 || die "pgrep is required"
for harness in "${harnesses[@]}"; do
  for script in run.sh build-image.sh; do
    [[ -x "${repo_root}/src/generation/${harness}/scripts/${script}" ]] ||
      die "missing executable harness script: ${harness}/scripts/${script}"
  done
done

custom_runs_root=false
[[ -z "${runs_root}" ]] || custom_runs_root=true
runs_root="${runs_root:-${repo_root}/runs}"
mkdir -p "${runs_root}"
runs_root="$(cd -- "${runs_root}" && pwd)"

harness_paths() {
  case "$1" in
    opencode) skip_build_env=OPENCODE_SKIP_BUILD; runs_root_env=OPENCODE_RUNS_ROOT ;;
    openhands) skip_build_env=OPENHANDS_SKIP_BUILD; runs_root_env=OPENHANDS_RUNS_ROOT ;;
  esac
  harness_runs_root="${runs_root}/$1"
  if [[ "${custom_runs_root}" == "false" ]]; then
    harness_runs_root="${!runs_root_env:-${harness_runs_root}}"
  fi
  [[ "${harness_runs_root}" == /* ]] || harness_runs_root="${PWD}/${harness_runs_root}"
}

generation_args=()
for option in context_tokens max_output_tokens reasoning_effort wire_api timeout_seconds; do
  [[ -z "${!option}" ]] || generation_args+=("--${option//_/-}" "${!option}")
done
worker_limit="${#models[@]}"
if [[ ${#jobs} -lt ${#worker_limit} ]] ||
  { [[ ${#jobs} -eq ${#worker_limit} ]] && [[ "${jobs}" < "${worker_limit}" ]]; }; then
  worker_limit="${jobs}"
fi
total_runs="$((${#models[@]} * ${#harnesses[@]} * ${#tasks[@]}))"
printf 'Run ID: %s\nTasks: %d\nModels: %s\nHarnesses: %s\n' \
  "${run_id}" "${#tasks[@]}" "$(IFS=,; printf '%s' "${models[*]}")" \
  "$(IFS=,; printf '%s' "${harnesses[*]}")"
printf 'Concurrent models: %d\nTotal runs: %d\nOutput: %s\n' "${worker_limit}" "${total_runs}" "${runs_root}"
for option in context_tokens max_output_tokens reasoning_effort wire_api max_steps; do
  printf '%s: %s\n' "${option//_/-}" "${!option:-environment/shared default (saved on resume)}"
done
for harness in "${harnesses[@]}"; do
  harness_paths "${harness}"
  mkdir -p "${harness_runs_root}"
  if [[ "${skip_build}" == "false" ]]; then
    printf '\nBuilding %s harness image once...\n' "${harness}"
    "${repo_root}/src/generation/${harness}/scripts/build-image.sh"
  fi
done

batch_dir="${runs_root}/batches/${run_id}"
mkdir -p "${batch_dir}"
summary_file="${batch_dir}/summary.tsv"
if [[ ! -s "${summary_file}" ]]; then
  printf 'timestamp\tharness\tmodel\ttask\tstatus\texit_code\trun_dir\n' > "${summary_file}"
fi
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/front-benchmark.XXXXXX")"
worker_pids=()
active_indices=()

record_result() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${harness}" "${model}" "${task}" \
    "$1" "$2" "${run_dir}" >> "${worker_summary}"
}

run_one() {
  local harness="$1" model="$2" task="${tasks[$3]}"
  local skip_build_env runs_root_env harness_runs_root run_dir metadata_file status exit_code
  local action=run
  local -a command=()
  harness_paths "${harness}"
  run_dir="${harness_runs_root}/${model}/${task}/${run_id}"
  metadata_file="${run_dir}/metadata.json"
  if [[ -f "${metadata_file}" ]]; then
    if ! status="$(jq -er '.status | select(type == "string" and length > 0)' "${metadata_file}" 2>/dev/null)"; then
      printf 'error: invalid run metadata: %s\n' "${metadata_file}" >&2
      record_result invalid-metadata 1
      return 1
    fi
    if [[ "${status}" == completed || ( "${status}" == dry-run && "${dry_run}" == true ) ]]; then
      printf '\nSkip %s %s task %s (%s)\n' "${harness}" "${model}" "${task}" "${status}"
      record_result "skipped-${status}" 0
      return
    fi
    if [[ "${status}" == dry-run ]]; then
      printf 'error: %s contains dry-run artifacts; use a new --run-id for a real run\n' "${run_dir}" >&2
      record_result dry-run-needs-new-id 1
      return 1
    fi
    if [[ "${dry_run}" == true ]]; then
      printf '\nWould resume %s %s task %s (%s); no model call\n' "${harness}" "${model}" "${task}" "${status}"
      record_result would-resume 0
      return
    fi
    action=resume
  elif [[ -e "${run_dir}" || -L "${run_dir}" ]]; then
    printf 'error: existing run has no metadata: %s\n' "${run_dir}" >&2
    record_result invalid-existing-run 1
    return 1
  fi

  printf '\n%s %s with %s on task %s\n' "${action}" "${model}" "${harness}" "${task}"
  command=("${repo_root}/src/generation/${harness}/scripts/run.sh" "${action}")
  if [[ "${action}" == run ]]; then
    command+=(--task "${task_arguments[$3]}" --model "${model}" --run-id "${run_id}")
    [[ "${dry_run}" == false ]] || command+=(--dry-run)
  else
    command+=(--source-run "${model}/${task}/${run_id}")
  fi
  command+=("${generation_args[@]}")
  if [[ -n "${max_steps}" ]]; then
    if [[ "${harness}" == openhands ]]; then
      command+=(--max-iterations "${max_steps}")
    else
      command+=(--max-steps "${max_steps}")
    fi
  fi
  if env FRONT_TASKS_ROOT="${tasks_root}" "${runs_root_env}=${harness_runs_root}" \
    "${skip_build_env}=true" "${command[@]}"; then
    exit_code=0
    status=completed
    [[ "${dry_run}" == false ]] || status=dry-run
  else
    exit_code=$?
    status=failed
  fi
  if [[ -f "${metadata_file}" ]]; then
    status="$(jq -er '.status | select(type == "string" and length > 0)' "${metadata_file}" 2>/dev/null)" || status=invalid-metadata
  fi
  if [[ "${exit_code}" -eq 0 && "${status}" != completed && "${status}" != dry-run ]]; then
    exit_code=1
  fi
  record_result "${status}" "${exit_code}" || return 1
  return "${exit_code}"
}

run_model_worker() {
  trap - EXIT INT TERM
  local model="$1" worker_summary="$2" harness task_index
  local failed=0
  for harness in "${harnesses[@]}"; do
    for task_index in "${!tasks[@]}"; do
      [[ ! -e "${state_dir}/stop" ]] || return "${failed}"
      if run_one "${harness}" "${model}" "${task_index}"; then
        :
      else
        failed=1
        if [[ "${fail_fast}" == true ]]; then
          touch "${state_dir}/stop"
          return 1
        fi
      fi
    done
  done
  return "${failed}"
}

terminate_process_tree() {
  local parent_pid="$1" child_pid child_pids
  child_pids="$(pgrep -P "${parent_pid}" 2>/dev/null || true)"
  for child_pid in ${child_pids}; do
    terminate_process_tree "${child_pid}"
  done
  kill -TERM "${parent_pid}" 2>/dev/null || true
}

stop_workers() {
  local exit_code="$1" worker_index
  trap '' INT TERM
  for worker_index in "${active_indices[@]}"; do
    terminate_process_tree "${worker_pids[$worker_index]}"
  done
  for worker_index in "${active_indices[@]}"; do
    wait "${worker_pids[$worker_index]}" 2>/dev/null || true
  done
  exit "${exit_code}"
}

finish() {
  local exit_code="$1"
  local -a parts=("${state_dir}"/model-*.tsv)
  trap - EXIT
  if [[ ${#parts[@]} -gt 0 ]]; then
    if cat "${parts[@]}" > "${state_dir}/summary.tsv" &&
      cat "${state_dir}/summary.tsv" >> "${summary_file}"; then
      awk -F '\t' -v total="${total_runs}" '
        $6 != 0 { failed++; next }
        $5 ~ /^(skipped-|would-resume$)/ { skipped++; next }
        { passed++ }
        END {
          printf "\nGeneration summary\n  Passed: %d\n  Failed: %d\n", passed, failed
          printf "  Skipped existing: %d\n  Not started: %d\n", skipped, total - NR
        }
      ' "${state_dir}/summary.tsv"
    else
      printf 'error: could not write batch summary: %s\n' "${summary_file}" >&2
      [[ "${exit_code}" -ne 0 ]] || exit_code=1
    fi
  fi
  printf '  Summary: %s\n' "${summary_file}"
  rm -r -- "${state_dir}"
  exit "${exit_code}"
}

trap 'finish "$?"' EXIT
trap 'stop_workers 130' INT
trap 'stop_workers 143' TERM

next_model=0
overall_status=0
while [[ "${next_model}" -lt "${#models[@]}" || ${#active_indices[@]} -gt 0 ]]; do
  if [[ -e "${state_dir}/stop" ]]; then
    next_model="${#models[@]}"
  fi
  while [[ "${next_model}" -lt "${#models[@]}" && ${#active_indices[@]} -lt "${worker_limit}" ]]; do
    worker_summary="${state_dir}/model-${next_model}.tsv"
    : > "${worker_summary}"
    run_model_worker "${models[$next_model]}" "${worker_summary}" &
    worker_pids[$next_model]=$!
    active_indices+=("${next_model}")
    next_model=$((next_model + 1))
  done
  remaining_indices=()
  for worker_index in "${active_indices[@]}"; do
    if kill -0 "${worker_pids[$worker_index]}" 2>/dev/null; then
      remaining_indices+=("${worker_index}")
    elif wait "${worker_pids[$worker_index]}"; then
      :
    else
      overall_status=1
      [[ "${fail_fast}" == false ]] || touch "${state_dir}/stop"
    fi
  done
  active_indices=("${remaining_indices[@]}")
  [[ ${#active_indices[@]} -eq 0 ]] || sleep 0.1
done
exit "${overall_status}"

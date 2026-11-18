from __future__ import annotations

import fcntl
import json
import multiprocessing
import os
import re
import signal
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from multiprocessing.process import BaseProcess
from pathlib import Path
from typing import Any

from front_generation.defaults import DEFAULT_MAX_STEPS
from front_generation.locking import RUN_LOCK_PROTOCOL, is_supported_lock_protocol
from front_generation.models import scrub_api_key_environment
from front_generation.paths import create_run_directory
from front_generation.tasks import resolve_task, task_key

from front_openhands.models import ModelConfig, load_model, restore_model

DEFAULT_PLAYWRIGHT_VERSION = "1.58.1"
WORKER_STOP_GRACE_SECONDS = 5


@dataclass(frozen=True)
class PreparedRun:
    repo_root: Path
    run_dir: Path
    workspace: Path
    persistence_dir: Path
    task_path: Path
    prompt: str
    model: ModelConfig
    metadata: dict[str, Any]


class RunInterrupted(KeyboardInterrupt):
    def __init__(self, signum: int) -> None:
        self.signum = signum
        super().__init__(f"OpenHands interrupted by {signal.Signals(signum).name}")


@contextmanager
def _run_lock(run_dir: Path):
    with (run_dir / ".run.lock").open("a+b") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError(f"OpenHands run is already active: {run_dir}") from exc
        yield lock_file


@contextmanager
def _run_signals():
    if threading.current_thread() is not threading.main_thread():
        yield
        return

    interrupted = False

    def handle_signal(signum: int, frame: Any) -> None:
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise RunInterrupted(signum)

    previous_handlers = {
        signum: signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        for signum in previous_handlers:
            signal.signal(signum, handle_signal)
        yield
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def prepare_run(
    repo_root: Path,
    *,
    task_reference: str,
    model_name: str,
    runs_root: Path | None = None,
    run_id: str | None = None,
    max_iterations: int = DEFAULT_MAX_STEPS,
    environment: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
) -> PreparedRun:
    if max_iterations < 1:
        raise ValueError("max_iterations must be at least 1")

    task_path = resolve_task(repo_root, task_reference)
    task_prompt = task_path.read_text(encoding="utf-8")
    prompt = _build_agent_prompt(task_prompt)
    model = load_model(
        repo_root,
        model_name,
        environment=environment,
        reasoning_effort=reasoning_effort,
    )
    effective_run_id = run_id or _default_run_id()
    _validate_run_id(effective_run_id)

    root = (runs_root or repo_root / "runs" / "openhands").resolve()
    run_dir = root / model.name / task_key(task_path) / effective_run_id
    create_run_directory(run_dir)

    workspace = run_dir / "workspace"
    persistence_dir = run_dir / "conversation"
    workspace.mkdir(parents=True)
    persistence_dir.mkdir()
    (run_dir / "prompt.md").write_text(prompt, encoding="utf-8")
    (run_dir / "task.md").write_text(task_prompt, encoding="utf-8")

    metadata = {
        "schemaVersion": 2,
        "status": "prepared",
        "engine": {
            "name": "openhands-sdk",
            "version": _package_version("openhands-sdk"),
            "toolsVersion": _package_version("openhands-tools"),
        },
        "model": model.public_metadata(),
        "task": {
            "id": task_key(task_path),
            "path": _display_path(task_path, repo_root),
        },
        "run": {
            "id": effective_run_id,
            "createdAt": _now(),
            "runDir": _display_path(run_dir, repo_root),
            "workspace": _display_path(workspace, repo_root),
            "maxIterations": max_iterations,
        },
        "runtime": {
            "playwrightVersion": _playwright_version(),
            "playwrightBrowsersPath": os.environ.get(
                "PLAYWRIGHT_BROWSERS_PATH",
                "/ms-playwright",
            ),
        },
    }
    prepared = PreparedRun(
        repo_root=repo_root,
        run_dir=run_dir,
        workspace=workspace,
        persistence_dir=persistence_dir,
        task_path=task_path,
        prompt=prompt,
        model=model,
        metadata=metadata,
    )
    write_metadata(prepared)
    return prepared


def mark_dry_run(prepared: PreparedRun) -> dict[str, Any]:
    prepared.metadata["status"] = "dry-run"
    prepared.metadata["completedAt"] = _now()
    write_metadata(prepared)
    return prepared.metadata


def prepare_resume_run(
    repo_root: Path,
    *,
    source_run: Path,
    runs_root: Path | None = None,
    max_iterations: int | None = None,
    environment: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
) -> tuple[PreparedRun, uuid.UUID, int]:
    root = (runs_root or repo_root / "runs" / "openhands").resolve()
    run_dir = (
        source_run.resolve()
        if source_run.is_absolute()
        else (root / source_run).resolve()
    )
    if run_dir != root and root not in run_dir.parents:
        raise ValueError(f"Source run must be inside {root}: {run_dir}")

    with _run_lock(run_dir):
        return _prepare_resume_run(
            repo_root,
            run_dir=run_dir,
            max_iterations=max_iterations,
            environment=environment,
            reasoning_effort=reasoning_effort,
        )


def _prepare_resume_run(
    repo_root: Path,
    *,
    run_dir: Path,
    max_iterations: int | None,
    environment: dict[str, str] | None,
    reasoning_effort: str | None,
) -> tuple[PreparedRun, uuid.UUID, int]:

    metadata_path = run_dir / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Missing source metadata: {metadata_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid source metadata JSON: {metadata_path}") from exc
    if metadata.get("schemaVersion") != 2:
        raise ValueError(f"Unsupported source metadata schema: {metadata_path}")
    if metadata.get("engine", {}).get("name") != "openhands-sdk":
        raise ValueError(f"Source run is not an OpenHands run: {run_dir}")

    previous_status = str(metadata.get("status", ""))
    if previous_status == "running":
        if not is_supported_lock_protocol(metadata.get("run", {}).get("lockProtocol")):
            raise ValueError(
                'Cannot safely resume a legacy run with status "running": '
                "no process lock was recorded. Verify that its processes have "
                "stopped before marking it interrupted."
            )
    elif previous_status in {"prepared", "completed", "dry-run"}:
        raise ValueError(
            f'Cannot resume OpenHands run with status "{previous_status}"'
        )

    _metadata_string(metadata, "model", "alias")
    source_task = _metadata_string(metadata, "task", "path")
    model = restore_model(
        repo_root,
        metadata["model"],
        environment=environment,
        reasoning_effort=reasoning_effort,
    )
    task_path = (repo_root / Path(source_task).expanduser()).resolve()
    task_text = task_path.read_text(encoding="utf-8")
    prompt = (run_dir / "prompt.md").read_text(encoding="utf-8")
    task_snapshot = run_dir / "task.md"
    task_matches = (
        task_snapshot.read_text(encoding="utf-8") == task_text
        if task_snapshot.exists()
        else prompt == _build_agent_prompt(task_text)
    )
    if not task_matches:
        raise ValueError(f"Task changed since source run: {task_path}")
    metadata["task"] = {
        "id": _metadata_string(metadata, "task", "id"),
        "path": source_task,
    }

    workspace = run_dir / "workspace"
    persistence_dir = run_dir / "conversation"
    if not workspace.is_dir():
        raise FileNotFoundError(f"Missing source workspace: {workspace}")
    if not persistence_dir.is_dir():
        raise FileNotFoundError(
            f"Missing source conversation directory: {persistence_dir}"
        )

    conversation_id = _conversation_id(persistence_dir)
    run_metadata = metadata.get("run")
    if not isinstance(run_metadata, dict):
        raise ValueError(f"Invalid source run metadata: {metadata_path}")
    source_limit = int(run_metadata.get("maxIterations", DEFAULT_MAX_STEPS))
    total_limit = max_iterations if max_iterations is not None else source_limit
    if total_limit < 1:
        raise ValueError("max_iterations must be at least 1")
    used_iterations = _completed_llm_iterations(persistence_dir)
    remaining_iterations = total_limit - used_iterations
    if remaining_iterations < 1:
        raise ValueError(
            "OpenHands run has no iteration budget remaining: "
            f"used {used_iterations} of {total_limit}"
        )

    resume = metadata.setdefault("resume", {})
    if not isinstance(resume, dict):
        raise ValueError(f"Invalid source resume metadata: {metadata_path}")
    attempts = resume.setdefault("attempts", [])
    if not isinstance(attempts, list):
        raise ValueError(f"Invalid source resume attempts: {metadata_path}")
    attempts.append(
        {
            "preparedAt": _now(),
            "previousStatus": previous_status,
            "previousError": metadata.get("error"),
            "previousCompletedAt": metadata.get("completedAt"),
            "previousDurationSeconds": metadata.get("durationSeconds"),
            "previousTimeoutSeconds": run_metadata.get("timeoutSeconds"),
            "previousModel": metadata["model"],
            "model": model.public_metadata(),
            "recoveredStaleRun": previous_status == "running",
            "usedIterations": used_iterations,
            "remainingIterations": remaining_iterations,
        }
    )
    resume["conversationId"] = str(conversation_id)
    resume["count"] = len(attempts)
    resume["mode"] = "in-place"
    metadata["model"] = model.public_metadata()
    run_metadata["maxIterations"] = total_limit

    prepared = PreparedRun(
        repo_root=repo_root,
        run_dir=run_dir,
        workspace=workspace,
        persistence_dir=persistence_dir,
        task_path=task_path,
        prompt=prompt,
        model=model,
        metadata=metadata,
    )
    write_metadata(prepared)
    return prepared, conversation_id, remaining_iterations


def execute_run(
    prepared: PreparedRun,
    *,
    max_iterations: int,
    conversation_id: uuid.UUID | None = None,
    send_prompt: bool = True,
    timeout_seconds: int | None = None,
) -> dict[str, Any]:
    if timeout_seconds is not None and timeout_seconds < 1:
        raise ValueError("timeout_seconds must be at least 1")
    if max_iterations < 1:
        raise ValueError("max_iterations must be at least 1")

    with _run_lock(prepared.run_dir) as lock_file:
        persisted = json.loads(
            (prepared.run_dir / "metadata.json").read_text(encoding="utf-8")
        )
        if persisted != prepared.metadata:
            raise ValueError("Run changed since preparation; prepare it again")
        with _run_signals():
            return _execute_run(
                prepared,
                lock_fd=lock_file.fileno(),
                max_iterations=max_iterations,
                conversation_id=conversation_id,
                send_prompt=send_prompt,
                timeout_seconds=timeout_seconds,
            )


def _execute_run(
    prepared: PreparedRun,
    *,
    lock_fd: int,
    max_iterations: int,
    conversation_id: uuid.UUID | None,
    send_prompt: bool,
    timeout_seconds: int | None,
) -> dict[str, Any]:
    started = time.monotonic()
    prepared.metadata["status"] = "running"
    prepared.metadata["startedAt"] = _now()
    prepared.metadata.pop("completedAt", None)
    prepared.metadata.pop("durationSeconds", None)
    prepared.metadata.pop("error", None)
    prepared.metadata.pop("cleanupError", None)
    prepared.metadata.pop("executionStatus", None)
    prepared.metadata["run"]["lockProtocol"] = RUN_LOCK_PROTOCOL
    prepared.metadata["run"].pop("timeoutSeconds", None)
    if timeout_seconds is not None:
        prepared.metadata["run"]["timeoutSeconds"] = timeout_seconds
    attempt = _active_resume_attempt(prepared, send_prompt)
    if attempt is not None:
        attempt["startedAt"] = prepared.metadata["startedAt"]
        attempt["status"] = "running"
        attempt["timeoutSeconds"] = timeout_seconds
    worker: BaseProcess | None = None
    try:
        write_metadata(prepared)
        worker = multiprocessing.get_context("fork").Process(
            target=_run_worker,
            kwargs={
                "prepared": prepared,
                "lock_fd": lock_fd,
                "max_iterations": max_iterations,
                "conversation_id": conversation_id,
                "send_prompt": send_prompt,
            },
            name="front-openhands-worker",
        )
        try:
            worker.start()
            timeout = (
                max(0, timeout_seconds - (time.monotonic() - started))
                if timeout_seconds is not None
                else None
            )
            worker.join(timeout)
            timed_out = worker.is_alive()
        finally:
            if worker.pid is not None:
                _stop_worker(worker)
                for temporary in prepared.run_dir.glob(".metadata-*.tmp"):
                    temporary.unlink(missing_ok=True)
        _refresh_metadata(prepared)
        if timed_out:
            prepared.metadata["status"] = "timed-out"
            prepared.metadata["error"] = {
                "type": "TimeoutExpired",
                "message": f"OpenHands exceeded {timeout_seconds} seconds",
            }
        elif worker.exitcode != 0 or prepared.metadata["status"] == "running":
            prepared.metadata["status"] = "failed"
            prepared.metadata.setdefault("error", {
                "type": "WorkerProcessError",
                "message": f"OpenHands worker exited with code {worker.exitcode}",
            })
    except KeyboardInterrupt as exc:
        _refresh_metadata(prepared)
        prepared.metadata["status"] = "interrupted"
        prepared.metadata["error"] = _error_metadata(exc, prepared.model)
        raise
    except Exception as exc:
        _refresh_metadata(prepared)
        prepared.metadata["status"] = "failed"
        prepared.metadata["error"] = _error_metadata(exc, prepared.model)
        raise
    finally:
        prepared.metadata["completedAt"] = _now()
        prepared.metadata["durationSeconds"] = round(time.monotonic() - started, 3)
        attempt = _active_resume_attempt(prepared, send_prompt)
        if attempt is not None:
            for field in ("status", "completedAt", "durationSeconds"):
                attempt[field] = prepared.metadata[field]
            for field in ("error", "cleanupError"):
                if field in prepared.metadata:
                    attempt[field] = prepared.metadata[field]
        write_metadata(prepared)
        if worker is not None and (worker.pid is None or not worker.is_alive()):
            worker.close()

    return prepared.metadata


def _run_worker(
    *,
    prepared: PreparedRun,
    lock_fd: int,
    max_iterations: int,
    conversation_id: uuid.UUID | None,
    send_prompt: bool,
) -> None:
    os.setsid()
    with os.fdopen(os.dup(lock_fd), "rb"), _run_signals():
        _execute_conversation(
            prepared,
            max_iterations=max_iterations,
            conversation_id=conversation_id,
            send_prompt=send_prompt,
        )


def _signal_worker(worker: BaseProcess, signum: int) -> None:
    try:
        os.killpg(worker.pid, signum)
    except ProcessLookupError:
        if worker.is_alive():
            os.kill(worker.pid, signum)


def _stop_worker(worker: BaseProcess) -> None:
    if worker.is_alive():
        _signal_worker(worker, signal.SIGTERM)
        worker.join(WORKER_STOP_GRACE_SECONDS)
    _signal_worker(worker, signal.SIGKILL)
    worker.join(WORKER_STOP_GRACE_SECONDS)
    if worker.is_alive():
        raise RuntimeError("OpenHands worker did not exit after SIGKILL")


def _refresh_metadata(prepared: PreparedRun) -> None:
    metadata = json.loads(
        (prepared.run_dir / "metadata.json").read_text(encoding="utf-8")
    )
    prepared.metadata.clear()
    prepared.metadata.update(metadata)


def _active_resume_attempt(
    prepared: PreparedRun, send_prompt: bool,
) -> dict[str, Any] | None:
    if send_prompt:
        return None
    attempts = prepared.metadata.get("resume", {}).get("attempts", [])
    return attempts[-1] if attempts else None


def _error_metadata(exc: BaseException, model: ModelConfig) -> dict[str, str]:
    message = str(exc) or type(exc).__name__
    if model.api_key:
        message = message.replace(model.api_key, "[REDACTED]")
    return {"type": type(exc).__name__, "message": message[:2000]}


def _execute_conversation(
    prepared: PreparedRun,
    *,
    max_iterations: int,
    conversation_id: uuid.UUID | None,
    send_prompt: bool,
) -> None:
    conversation = None
    try:
        from openhands.sdk import Agent, Conversation, Tool
        from openhands.tools.file_editor import FileEditorTool
        from openhands.tools.task_tracker import TaskTrackerTool
        from openhands.tools.terminal import TerminalTool

        from front_openhands.llm import build_llm

        llm = build_llm(prepared.model)
        scrub_api_key_environment(prepared.model.api_key_env)
        agent = Agent(
            llm=llm,
            tools=[
                Tool(name=TerminalTool.name),
                Tool(name=FileEditorTool.name),
                Tool(name=TaskTrackerTool.name),
            ],
        )
        conversation = Conversation(
            agent=agent,
            workspace=prepared.workspace,
            persistence_dir=prepared.persistence_dir,
            conversation_id=conversation_id or uuid.uuid4(),
            max_iteration_per_run=max_iterations,
            visualizer=None,
            delete_on_close=False,
            tags={
                "harness": "front",
                "model": prepared.model.name,
                "task": task_key(prepared.task_path),
            },
        )
        if send_prompt:
            conversation.send_message(prepared.prompt)
        else:
            _restore_pending_actions(conversation.state)
        conversation.run()
        execution_status = conversation.state.execution_status.value
        prepared.metadata["executionStatus"] = execution_status
        prepared.metadata["status"] = (
            "completed" if execution_status == "finished" else execution_status
        )
        if llm.metrics is not None:
            prepared.metadata["metrics"] = llm.metrics.model_dump(mode="json")
        if prepared.metadata["status"] == "completed":
            _validate_completed_run(prepared)
    except (Exception, KeyboardInterrupt) as exc:
        prepared.metadata["status"] = (
            "interrupted" if isinstance(exc, KeyboardInterrupt) else "failed"
        )
        prepared.metadata["error"] = _error_metadata(exc, prepared.model)
    finally:
        write_metadata(prepared)
        try:
            if conversation is not None:
                conversation.close()
        except (Exception, KeyboardInterrupt) as exc:
            error = _error_metadata(exc, prepared.model)
            prepared.metadata["cleanupError"] = error
            if prepared.metadata["status"] not in {"failed", "interrupted"}:
                prepared.metadata["status"] = (
                    "interrupted" if isinstance(exc, KeyboardInterrupt) else "failed"
                )
                prepared.metadata["error"] = error
        finally:
            write_metadata(prepared)


def _restore_pending_actions(state: Any) -> None:
    events = state.active_branch()
    pending = state.get_unmatched_actions(events)
    if not pending:
        return

    response_ids = {action.llm_response_id for action in pending}
    start = next(
        index for index, event in enumerate(events)
        if getattr(event, "llm_response_id", None) in response_ids
    )
    suffix = events[start:]
    suffix_ids = {event.id for event in suffix}
    view = state.view
    view.events = [event for event in view.events if event.id not in suffix_ids]
    for event in suffix:
        view.append_event(event)


def _validate_completed_run(prepared: PreparedRun) -> None:
    workspace_files = 0
    for _, directories, files in os.walk(prepared.workspace):
        directories[:] = [
            directory
            for directory in directories
            if directory not in {".git", "node_modules"}
        ]
        workspace_files += len(files)
    prepared.metadata["validation"] = {"workspaceFiles": workspace_files}
    if workspace_files > 0:
        return

    prepared.metadata["status"] = "failed"
    prepared.metadata["error"] = {
        "type": "IncompleteAgentRun",
        "message": "OpenHands finished without workspace output",
    }


def write_metadata(prepared: PreparedRun) -> None:
    path = prepared.run_dir / "metadata.json"
    descriptor, name = tempfile.mkstemp(
        prefix=".metadata-", suffix=".tmp", dir=prepared.run_dir,
    )
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(prepared.metadata, output, ensure_ascii=False, indent=2)
            output.write("\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _build_agent_prompt(task_prompt: str) -> str:
    return f"{_playwright_runtime_instructions()}\n\n{task_prompt}"


def _playwright_runtime_instructions(version: str | None = None) -> str:
    resolved = version or _playwright_version()
    return f"""\
Playwright runtime contract:
- This container provides Playwright {resolved} with matching browsers in
  $PLAYWRIGHT_BROWSERS_PATH.
- Any direct dependency on @playwright/test, playwright, or playwright-core
  must use the exact version {resolved}. Do not use ^, ~, latest, or another
  version.
- Do not run `playwright install` or download another browser bundle.
- After dependency installation, run `front-playwright-check .`. For WebGL or
  canvas-heavy browser suites in this shared container, use one worker.

The benchmark task follows verbatim:"""


def _playwright_version() -> str:
    value = os.environ.get(
        "FRONT_PLAYWRIGHT_VERSION",
        DEFAULT_PLAYWRIGHT_VERSION,
    )
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise ValueError(f"Invalid FRONT_PLAYWRIGHT_VERSION: {value}")
    return value


def _validate_run_id(run_id: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", run_id):
        raise ValueError(
            "run_id must use 1-128 ASCII letters, digits, dots, dashes, or underscores"
        )


def _metadata_string(metadata: dict[str, Any], *path: str) -> str:
    value: Any = metadata
    for segment in path:
        if not isinstance(value, dict):
            value = None
            break
        value = value.get(segment)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing source metadata field: {'.'.join(path)}")
    return value


def _conversation_id(persistence_dir: Path) -> uuid.UUID:
    candidates = sorted(persistence_dir.glob("*/base_state.json"))
    if len(candidates) != 1:
        raise ValueError(
            "Expected exactly one persisted OpenHands conversation in "
            f"{persistence_dir}; found {len(candidates)}"
        )
    base_state = json.loads(candidates[0].read_text(encoding="utf-8"))
    try:
        conversation_id = uuid.UUID(str(base_state["id"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(
            f"Invalid conversation ID in {candidates[0]}"
        ) from exc
    if candidates[0].parent.name != conversation_id.hex:
        raise ValueError(
            "Conversation directory does not match persisted ID: "
            f"{candidates[0].parent}"
        )
    return conversation_id


def _completed_llm_iterations(persistence_dir: Path) -> int:
    response_ids: set[str] = set()
    for event_path in persistence_dir.glob("*/events/event-*.json"):
        event = json.loads(event_path.read_text(encoding="utf-8"))
        response_id = event.get("llm_response_id")
        if event.get("source") == "agent" and isinstance(response_id, str):
            response_ids.add(response_id)
    return len(response_ids)


def _default_run_id() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{timestamp}-{uuid.uuid4().hex[:8]}"


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "not-installed"


def _display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root.resolve()))
    except ValueError:
        return str(path.resolve())

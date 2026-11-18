from __future__ import annotations

import fcntl
import http.client
import http.server
import json
import os
import re
import signal
import ssl
import subprocess
import tempfile
import threading
import time
import uuid
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import urlsplit
from urllib.request import getproxies, proxy_bypass

from front_generation.defaults import DEFAULT_MAX_STEPS, reasoning_defaults
from front_generation.locking import RUN_LOCK_PROTOCOL, is_supported_lock_protocol
from front_generation.models import scrub_api_key_environment
from front_generation.paths import create_run_directory
from front_generation.tasks import resolve_task, task_key

from front_opencode import OPENCODE_VERSION
from front_opencode.config import build_opencode_config
from front_opencode.models import ModelConfig, load_model, restore_model

DEFAULT_PLAYWRIGHT_VERSION = "1.58.1"
RESUME_CONTINUATION_MESSAGE = "Continue."

AGENT_EXECUTION_INSTRUCTIONS = """\
Execution protocol for this coding-agent workspace:
- Treat the current working directory as the delivery root. Create package.json
  and the application files directly here; do not create a wrapper directory.
- Use the native OpenCode tools exposed to you for every filesystem or command
  action. Your first implementation action must be a real bash tool call that
  runs `pwd && ls -la` (a todo tool call may precede it).
- Never emit pseudo-tool markup such as <write_file>, <path>, or <content>.
  Do not paste complete project files into assistant prose instead of invoking
  tools.
- Continue through implementation and verification. Run dependency install,
  tests, typecheck or lint, and the production build with native tool calls.
- Keep progress prose brief and use tool calls to perform the actual work.
"""


@dataclass(frozen=True)
class PreparedRun:
    repo_root: Path
    run_dir: Path
    workspace: Path
    conversation_dir: Path
    config_dir: Path
    task_path: Path
    prompt: str
    model: ModelConfig
    max_steps: int
    opencode_config: dict[str, Any]
    metadata: dict[str, Any]


class RunInterrupted(KeyboardInterrupt):
    def __init__(self, signum: int) -> None:
        self.signum = signum
        super().__init__(f"OpenCode interrupted by {signal.Signals(signum).name}")


class UpstreamAPIError(RuntimeError):
    pass


class UpstreamRetryExhausted(UpstreamAPIError):
    pass


@dataclass
class _ProxyState:
    error: UpstreamAPIError | None = None


@contextmanager
def _run_lock(run_dir: Path):
    with (run_dir / ".run.lock").open("a+b") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError(f"OpenCode run is already active: {run_dir}") from exc
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
    max_steps: int = DEFAULT_MAX_STEPS,
    environment: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
) -> PreparedRun:
    if max_steps < 1:
        raise ValueError("max_steps must be at least 1")

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

    root = (runs_root or repo_root / "runs" / "opencode").resolve()
    run_dir = root / model.name / task_key(task_path) / effective_run_id
    create_run_directory(run_dir)

    workspace = run_dir / "workspace"
    conversation_dir = run_dir / "conversation"
    config_dir = run_dir / "config"
    workspace.mkdir(parents=True)
    conversation_dir.mkdir()
    config_dir.mkdir()
    (run_dir / "prompt.md").write_text(prompt, encoding="utf-8")
    (run_dir / "task.md").write_text(task_prompt, encoding="utf-8")

    opencode_config = build_opencode_config(model, max_steps=max_steps)
    _write_json(config_dir / "opencode.json", opencode_config)

    metadata = {
        "schemaVersion": 2,
        "status": "prepared",
        "engine": {
            "name": "opencode",
            "version": OPENCODE_VERSION,
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
            "conversation": _display_path(conversation_dir, repo_root),
            "maxSteps": max_steps,
        },
        "configuration": {
            "path": _display_path(config_dir / "opencode.json", repo_root),
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
        conversation_dir=conversation_dir,
        config_dir=config_dir,
        task_path=task_path,
        prompt=prompt,
        model=model,
        max_steps=max_steps,
        opencode_config=opencode_config,
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
    max_steps: int | None = None,
    environment: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
) -> tuple[PreparedRun, str, int]:
    root = (runs_root or repo_root / "runs" / "opencode").resolve()
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
            max_steps=max_steps,
            environment=environment,
            reasoning_effort=reasoning_effort,
        )


def _prepare_resume_run(
    repo_root: Path,
    *,
    run_dir: Path,
    max_steps: int | None,
    environment: dict[str, str] | None,
    reasoning_effort: str | None,
) -> tuple[PreparedRun, str, int]:
    metadata_path = run_dir / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Missing source metadata: {metadata_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid source metadata JSON: {metadata_path}") from exc
    if metadata.get("schemaVersion") != 2:
        raise ValueError(f"Unsupported source metadata schema: {metadata_path}")
    if metadata.get("engine", {}).get("name") != "opencode":
        raise ValueError(f"Source run is not an OpenCode run: {run_dir}")

    previous_status = str(metadata.get("status", ""))
    if previous_status == "running":
        if not is_supported_lock_protocol(metadata.get("run", {}).get("lockProtocol")):
            raise ValueError(
                'Cannot safely resume a legacy run with status "running": '
                "no process lock was recorded. Verify that its processes have "
                "stopped before marking it interrupted."
            )
    elif previous_status not in {"failed", "timed-out", "interrupted"}:
        raise ValueError(
            f'Cannot resume OpenCode run with status "{previous_status}"'
        )

    _metadata_string(metadata, "model", "alias")
    source_task = _metadata_string(metadata, "task", "path")
    model = restore_model(
        repo_root,
        metadata["model"],
        environment=environment,
        reasoning_effort=reasoning_effort,
    )

    task_path = (repo_root / source_task).resolve()
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
    conversation_dir = run_dir / "conversation"
    config_dir = run_dir / "config"
    events_path = run_dir / "events.jsonl"
    if not workspace.is_dir():
        raise FileNotFoundError(f"Missing source workspace: {workspace}")
    if not conversation_dir.is_dir():
        raise FileNotFoundError(
            f"Missing source conversation directory: {conversation_dir}"
        )
    if not config_dir.is_dir():
        raise FileNotFoundError(f"Missing source config directory: {config_dir}")

    session_id = _single_session_id(events_path)
    run_metadata = metadata.get("run")
    if not isinstance(run_metadata, dict):
        raise ValueError(f"Invalid source run metadata: {metadata_path}")
    source_limit = int(run_metadata.get("maxSteps", DEFAULT_MAX_STEPS))
    total_limit = max_steps if max_steps is not None else source_limit
    if total_limit < 1:
        raise ValueError("max_steps must be at least 1")
    used_steps = _completed_agent_steps(events_path)
    remaining_steps = total_limit - used_steps
    if remaining_steps < 1:
        raise ValueError(
            "OpenCode run has no step budget remaining: "
            f"used {used_steps} of {total_limit}"
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
            "previousModel": metadata["model"],
            "model": model.public_metadata(),
            "recoveredStaleRun": previous_status == "running",
            "usedSteps": used_steps,
            "remainingSteps": remaining_steps,
        }
    )
    resume["sessionId"] = session_id
    resume["count"] = len(attempts)
    resume["mode"] = "in-place"
    metadata["model"] = model.public_metadata()
    run_metadata["maxSteps"] = total_limit

    opencode_config = build_opencode_config(model, max_steps=remaining_steps)
    prepared = PreparedRun(
        repo_root=repo_root,
        run_dir=run_dir,
        workspace=workspace,
        conversation_dir=conversation_dir,
        config_dir=config_dir,
        task_path=task_path,
        prompt=prompt,
        model=model,
        max_steps=remaining_steps,
        opencode_config=opencode_config,
        metadata=metadata,
    )
    write_metadata(prepared)
    return prepared, session_id, remaining_steps


def execute_run(
    prepared: PreparedRun,
    *,
    timeout_seconds: int | None = None,
    opencode_binary: str = "opencode",
    session_id: str | None = None,
    send_prompt: bool = True,
    append_events: bool = False,
) -> dict[str, Any]:
    if timeout_seconds is not None and timeout_seconds < 1:
        raise ValueError("timeout_seconds must be at least 1")

    with _run_lock(prepared.run_dir) as lock_file:
        persisted = json.loads(
            (prepared.run_dir / "metadata.json").read_text(encoding="utf-8")
        )
        if persisted != prepared.metadata:
            raise ValueError("Run changed since preparation; prepare it again")
        with _run_signals():
            return _execute_run(
                prepared,
                lock_file=lock_file,
                timeout_seconds=timeout_seconds,
                opencode_binary=opencode_binary,
                session_id=session_id,
                send_prompt=send_prompt,
                append_events=append_events,
            )


def _execute_run(
    prepared: PreparedRun,
    *,
    lock_file: BinaryIO,
    timeout_seconds: int | None,
    opencode_binary: str,
    session_id: str | None,
    send_prompt: bool,
    append_events: bool,
) -> dict[str, Any]:
    started = time.monotonic()
    events_path = prepared.run_dir / "events.jsonl"
    stderr_path = prepared.run_dir / "stderr.log"
    events_before = _event_line_count(events_path) if append_events else 0
    process: subprocess.Popen[str] | None = None
    proxy_state = _ProxyState()

    resume_attempt = _active_resume_attempt(prepared.metadata)

    try:
        prepared.metadata["status"] = "running"
        prepared.metadata["startedAt"] = _now()
        prepared.metadata.pop("completedAt", None)
        prepared.metadata.pop("durationSeconds", None)
        prepared.metadata.pop("error", None)
        prepared.metadata["run"]["lockProtocol"] = RUN_LOCK_PROTOCOL
        if timeout_seconds is not None:
            prepared.metadata["run"]["timeoutSeconds"] = timeout_seconds
        if resume_attempt is not None:
            resume_attempt["startedAt"] = prepared.metadata["startedAt"]
        write_metadata(prepared)
        _validate_runnable_model(prepared.model)
        runtime_env = _runtime_environment(prepared)
        scrub_api_key_environment(prepared.model.api_key_env)

        with (
            _api_proxy(prepared.model, state=proxy_state) as proxy_base,
            tempfile.TemporaryDirectory(prefix="front-opencode-config-") as temp,
        ):
            temp_dir = Path(temp)
            runtime_config_path = temp_dir / "opencode.json"
            runtime_config = build_opencode_config(
                prepared.model,
                max_steps=prepared.max_steps,
                credential_reference="front-harness-proxy",
                api_base=proxy_base,
            )
            _write_private_json(runtime_config_path, runtime_config)
            runtime_env["OPENCODE_CONFIG"] = str(runtime_config_path)

            command = [opencode_binary, "--pure", "run"]
            if session_id is not None:
                command.extend(["--session", session_id])
            command.extend(
                [
                    "--model",
                    prepared.model.opencode_model,
                    "--agent",
                    "build",
                    "--format",
                    "json",
                    "--auto",
                ]
            )
            if session_id is None:
                command.extend(
                    [
                        "--title",
                        (
                            f"front {prepared.model.name} "
                            f"{task_key(prepared.task_path)} "
                            f"{prepared.metadata['run']['id']}"
                        ),
                    ]
                )
            command.extend(["--dir", str(prepared.workspace)])
            prepared.metadata["run"]["command"] = command[1:]
            write_metadata(prepared)

            output_mode = "a" if append_events else "w"
            with (
                events_path.open(output_mode, encoding="utf-8") as events_handle,
                stderr_path.open(output_mode, encoding="utf-8") as stderr_handle,
            ):
                process = subprocess.Popen(
                    command,
                    cwd=prepared.workspace,
                    env=runtime_env,
                    stdin=subprocess.PIPE,
                    stdout=events_handle,
                    stderr=stderr_handle,
                    text=True,
                    start_new_session=True,
                    pass_fds=(lock_file.fileno(),),
                )
                try:
                    _communicate_run(
                        process,
                        proxy_state=proxy_state,
                        prompt=(
                            prepared.prompt
                            if send_prompt
                            else RESUME_CONTINUATION_MESSAGE
                        ),
                        timeout_seconds=timeout_seconds,
                    )
                except subprocess.TimeoutExpired:
                    _stop_process(process)
                    prepared.metadata["status"] = "timed-out"
                    prepared.metadata["error"] = {
                        "type": "TimeoutExpired",
                        "message": (f"OpenCode exceeded {timeout_seconds} seconds"),
                    }
                except KeyboardInterrupt as exc:
                    prepared.metadata["status"] = "interrupted"
                    write_metadata(prepared)
                    _stop_process(process, getattr(exc, "signum", signal.SIGINT))
                    raise

            if prepared.metadata["status"] == "running":
                return_code = process.returncode
                prepared.metadata["run"]["exitCode"] = return_code
                if return_code == 0:
                    prepared.metadata["status"] = "completed"
                else:
                    prepared.metadata["status"] = "failed"
                    prepared.metadata["error"] = {
                        "type": "OpenCodeExitError",
                        "message": _failure_message(stderr_path, return_code),
                    }
    except KeyboardInterrupt as exc:
        prepared.metadata["status"] = "interrupted"
        prepared.metadata["error"] = {
            "type": type(exc).__name__,
            "message": str(exc) or "OpenCode interrupted by SIGINT",
        }
        write_metadata(prepared)
        if process is not None and process.poll() is None:
            _stop_process(process, getattr(exc, "signum", signal.SIGINT))
        raise
    except Exception as exc:
        if process is not None and process.poll() is None:
            _stop_process(process)
        prepared.metadata["status"] = "failed"
        prepared.metadata["error"] = {
            "type": type(exc).__name__,
            "message": str(exc)[:2000],
        }
    finally:
        if process is not None:
            prepared.metadata["run"]["exitCode"] = process.poll()
        _add_event_summary(prepared, events_path)
        if prepared.metadata["status"] == "completed" and append_events:
            _validate_resume_progress(prepared, events_path, events_before)
        if prepared.metadata["status"] == "completed":
            _validate_completed_run(prepared, events_path)
        prepared.metadata["completedAt"] = _now()
        prepared.metadata["durationSeconds"] = round(time.monotonic() - started, 3)
        if resume_attempt is not None:
            resume_attempt["completedAt"] = prepared.metadata["completedAt"]
            resume_attempt["durationSeconds"] = prepared.metadata["durationSeconds"]
            resume_attempt["status"] = prepared.metadata["status"]
            if "error" in prepared.metadata:
                resume_attempt["error"] = prepared.metadata["error"]
        write_metadata(prepared)

    return prepared.metadata


def write_metadata(prepared: PreparedRun) -> None:
    path = prepared.run_dir / "metadata.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(prepared.metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _build_agent_prompt(task_prompt: str) -> str:
    return (
        f"{AGENT_EXECUTION_INSTRUCTIONS}\n"
        f"{_playwright_runtime_instructions()}\n\n"
        "The benchmark task follows verbatim:\n"
        f"{task_prompt}"
    )


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
  canvas-heavy browser suites in this shared container, use one worker."""


def _playwright_version() -> str:
    value = os.environ.get(
        "FRONT_PLAYWRIGHT_VERSION",
        DEFAULT_PLAYWRIGHT_VERSION,
    )
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise ValueError(f"Invalid FRONT_PLAYWRIGHT_VERSION: {value}")
    return value


def _runtime_environment(prepared: PreparedRun) -> dict[str, str]:
    roots = {
        "XDG_DATA_HOME": prepared.conversation_dir / "data",
        "XDG_CACHE_HOME": prepared.conversation_dir / "cache",
        "XDG_CONFIG_HOME": prepared.conversation_dir / "config-home",
        "XDG_STATE_HOME": prepared.conversation_dir / "state",
        "HOME": prepared.conversation_dir / "home",
        "TMPDIR": prepared.conversation_dir / "tmp",
    }
    for path in roots.values():
        path.mkdir(parents=True, exist_ok=True)
    extensions = prepared.conversation_dir / "extensions"
    extensions.mkdir(exist_ok=True)

    environment = dict(os.environ)
    environment.pop(prepared.model.api_key_env, None)
    environment.update({key: str(value) for key, value in roots.items()})
    environment["OPENCODE_CONFIG_DIR"] = str(extensions)
    environment["NO_COLOR"] = "1"
    return environment


def _validate_runnable_model(model: ModelConfig) -> None:
    if not model.enabled:
        raise ValueError(
            f"{model.name} is disabled. Set {model.enabled_env}=true "
            "in the repository .env."
        )
    if not model.api_key:
        raise ValueError(
            f"Missing API key for {model.name}. Configure "
            f"{model.api_key_env} in the repository .env."
        )


@contextmanager
def _api_proxy(model: ModelConfig, *, state: _ProxyState | None = None):
    target = urlsplit(model.api_base)
    if target.scheme not in {"http", "https"} or not target.hostname:
        raise ValueError(f"Unsupported API base URL: {model.api_base}")

    base_path = target.path.rstrip("/")
    allowed_path = f"{base_path}{model.wire_path}" or model.wire_path
    handler = _proxy_handler(
        target=target,
        allowed_path=allowed_path,
        api_key=model.api_key,
        auth_type=model.auth_type,
        request_id_header=model.request_id_header,
        wire_api=model.wire_api,
        reasoning_effort=(
            model.reasoning_effort.selected if model.reasoning_effort else None
        ),
        max_tokens_field=model.request.max_tokens_field,
        initial_tool_choice=model.initial_tool_choice,
        flatten_text_content=model.compatibility.get("flattenTextContent", False),
        normalize_chat_tool_ids=model.wire_api == "chat.completions",
        normalize_anthropic_cost_events=model.compatibility.get(
            "normalizeAnthropicCostEvents", False
        ),
        retry_modelservice_errors=model.compatibility.get(
            "retryModelServiceErrors", False
        ),
        upstream_retries=model.retries,
        timeout_seconds=max(1, model.timeout_ms // 1000),
        state=state if state is not None else _ProxyState(),
    )
    server = _ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(
        target=server.serve_forever,
        name="front-opencode-api-proxy",
        daemon=True,
    )
    thread.start()
    try:
        port = server.server_address[1]
        provider_path = base_path
        if model.wire_api == "anthropic.messages":
            wire_prefix, _, _ = model.wire_path.rpartition("/")
            provider_path = f"{provider_path}{wire_prefix}"
        yield f"http://127.0.0.1:{port}{provider_path}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class _ThreadingHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True


def _upstream_connection(
    target,
    request_path: str,
    timeout_seconds: int,
) -> tuple[http.client.HTTPConnection, str]:
    proxies = getproxies()
    proxy_url = None
    if not proxy_bypass(target.hostname):
        proxy_url = proxies.get(target.scheme) or proxies.get("all")

    if not proxy_url:
        connection_type = (
            http.client.HTTPSConnection
            if target.scheme == "https"
            else http.client.HTTPConnection
        )
        connection_kwargs: dict[str, Any] = {
            "host": target.hostname,
            "port": target.port,
            "timeout": timeout_seconds,
        }
        if target.scheme == "https":
            connection_kwargs["context"] = ssl.create_default_context()
        return connection_type(**connection_kwargs), request_path

    if "://" not in proxy_url:
        proxy_url = f"http://{proxy_url}"
    proxy = urlsplit(proxy_url)
    if proxy.scheme != "http" or not proxy.hostname:
        raise ValueError(f"Unsupported upstream proxy URL: {proxy_url}")

    proxy_port = proxy.port or 80
    if target.scheme == "https":
        connection = http.client.HTTPSConnection(
            proxy.hostname,
            proxy_port,
            timeout=timeout_seconds,
            context=ssl.create_default_context(),
        )
        connection.set_tunnel(target.hostname, target.port or 443)
        return connection, request_path

    connection = http.client.HTTPConnection(
        proxy.hostname,
        proxy_port,
        timeout=timeout_seconds,
    )
    return connection, f"{target.scheme}://{target.netloc}{request_path}"


def _proxy_handler(
    *,
    target,
    allowed_path: str,
    api_key: str,
    auth_type: str,
    request_id_header: str | None,
    wire_api: str,
    max_tokens_field: str,
    initial_tool_choice: str | None,
    flatten_text_content: bool,
    normalize_chat_tool_ids: bool,
    normalize_anthropic_cost_events: bool,
    retry_modelservice_errors: bool,
    upstream_retries: int,
    timeout_seconds: int,
    state: _ProxyState,
    reasoning_effort: str | None = None,
):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def do_POST(self) -> None:
            request_url = urlsplit(self.path)
            if request_url.path != allowed_path:
                self.send_error(404)
                return
            if state.error is not None:
                self.send_error(502, "Model API request aborted")
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            request_body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")
            if request_body and "application/json" in content_type:
                request_body = _rewrite_request_body(
                    request_body,
                    max_tokens_field=max_tokens_field,
                    wire_api=wire_api,
                    reasoning_effort=reasoning_effort,
                    initial_tool_choice=initial_tool_choice,
                    flatten_text_content=flatten_text_content,
                )

            excluded_headers = {
                "authorization",
                "api-key",
                "x-api-key",
                "anthropic-version",
                "accept-encoding",
                "connection",
                "content-length",
                "host",
                "proxy-connection",
                "transfer-encoding",
            }
            if request_id_header:
                excluded_headers.add(request_id_header.lower())
            headers = {
                key: value
                for key, value in self.headers.items()
                if key.lower() not in excluded_headers
            }
            if auth_type == "x-api-key":
                headers["x-api-key"] = api_key
            else:
                headers["Authorization"] = f"Bearer {api_key}"
            if request_id_header:
                headers[request_id_header] = f"front-{uuid.uuid4().hex}"
            if wire_api == "anthropic.messages":
                headers["anthropic-version"] = self.headers.get(
                    "anthropic-version",
                    "2023-06-01",
                )
            headers["Accept-Encoding"] = "identity"
            headers["Content-Length"] = str(len(request_body))

            attempt = 0
            while True:
                if state.error is not None:
                    self.send_error(502, "Model API request aborted")
                    return
                connection: http.client.HTTPConnection | None = None
                response_started = False
                try:
                    connection, request_path = _upstream_connection(
                        target,
                        self.path,
                        timeout_seconds,
                    )
                    connection.request(
                        "POST",
                        request_path,
                        body=request_body,
                        headers=headers,
                    )
                    response = connection.getresponse()
                    buffered_body: bytes | None = None
                    if response.status >= 400:
                        buffered_body = response.read()
                        retryable = (
                            (response.status != 400 or retry_modelservice_errors)
                            and _is_retryable_modelservice_response(
                                response.status,
                                buffered_body,
                            )
                        )
                        if retryable and attempt < upstream_retries:
                            attempt += 1
                            connection.close()
                            time.sleep(_upstream_retry_delay(attempt))
                            continue
                        error_type = (
                            UpstreamRetryExhausted if retryable else UpstreamAPIError
                        )
                        state.error = error_type(
                            f"Model API returned HTTP {response.status} "
                            f"after {attempt} retries"
                        )

                    response_started = True
                    self.send_response(response.status, response.reason)
                    for key, value in response.getheaders():
                        if key.lower() in {
                            "connection",
                            "content-length",
                            "transfer-encoding",
                        }:
                            continue
                        self.send_header(key, value)
                    self.send_header("Connection", "close")
                    self.end_headers()
                    if buffered_body is not None:
                        self.wfile.write(buffered_body)
                        self.wfile.flush()
                        return

                    response_content_type = response.getheader(
                        "Content-Type",
                        "",
                    ).lower()
                    if (
                        normalize_anthropic_cost_events
                        and "text/event-stream" in response_content_type
                    ):
                        _forward_anthropic_sse(response, self.wfile)
                    elif (
                        normalize_chat_tool_ids
                        and "text/event-stream" in response_content_type
                    ):
                        _forward_chat_completion_sse(response, self.wfile)
                    else:
                        reader = getattr(response, "read1", response.read)
                        while chunk := reader(64 * 1024):
                            self.wfile.write(chunk)
                            self.wfile.flush()
                    return
                except Exception as exc:
                    if response_started:
                        state.error = UpstreamAPIError(
                            "Model API response interrupted after forwarding began "
                            f"({type(exc).__name__})"
                        )
                        return
                    if (
                        isinstance(exc, (OSError, http.client.HTTPException))
                        and attempt < upstream_retries
                    ):
                        attempt += 1
                        if connection is not None:
                            connection.close()
                        time.sleep(_upstream_retry_delay(attempt))
                        continue
                    state.error = UpstreamRetryExhausted(
                        f"Model API connection failed after {attempt} retries "
                        f"({type(exc).__name__})"
                    )
                    if not self.wfile.closed:
                        self.send_error(502, "Model API request failed")
                    return
                finally:
                    if connection is not None:
                        connection.close()
                    self.close_connection = True

        def log_message(self, format: str, *args: Any) -> None:
            return

    return Handler


def _is_retryable_modelservice_response(status: int, body: bytes) -> bool:
    if status in {408, 425, 429, 500, 502, 503, 504}:
        return True
    if status != 400:
        return False

    text = body.decode("utf-8", errors="replace").lower()
    return (
        "failed_response" in text
        and "provider_error" in text
        and "request is invalid" in text
    )


def _upstream_retry_delay(attempt: int) -> int:
    return min(30 * 2 ** max(0, attempt - 1), 120)


def _forward_anthropic_sse(
    response: http.client.HTTPResponse,
    output: BinaryIO,
) -> None:
    frame: list[bytes] = []
    while line := response.readline():
        frame.append(line)
        if line not in {b"\n", b"\r\n"}:
            continue
        if not _is_cost_only_sse_frame(frame):
            output.write(b"".join(frame))
            output.flush()
        frame = []
    if frame and not _is_cost_only_sse_frame(frame):
        output.write(b"".join(frame))
        output.flush()


def _is_cost_only_sse_frame(frame: list[bytes]) -> bool:
    payloads = []
    for line in frame:
        stripped = line.strip()
        if stripped.startswith(b"data:"):
            payloads.append(stripped[len(b"data:") :].strip())
    if len(payloads) != 1:
        return False
    try:
        event = json.loads(payloads[0])
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(event, dict) or not event:
        return False
    return all(
        isinstance(key, str) and key.startswith("cost_usd_")
        for key in event
    )


def _forward_chat_completion_sse(
    response: http.client.HTTPResponse,
    output: BinaryIO,
) -> None:
    tool_call_ids: dict[tuple[int, int], str] = {}
    while line := response.readline():
        output.write(_rewrite_chat_completion_sse_line(line, tool_call_ids))
        output.flush()


def _rewrite_chat_completion_sse_line(
    line: bytes,
    tool_call_ids: dict[tuple[int, int], str],
) -> bytes:
    if line.endswith(b"\r\n"):
        newline = b"\r\n"
    elif line.endswith(b"\n"):
        newline = b"\n"
    else:
        newline = b""
    body = line[: -len(newline)] if newline else line
    marker = body.find(b"data:")
    if marker < 0:
        return line

    payload = body[marker + len(b"data:") :].strip()
    if not payload or payload == b"[DONE]":
        return line
    try:
        event = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return line
    if not isinstance(event, dict):
        return line

    changed = _normalize_stream_tool_call_ids(event, tool_call_ids)
    if not changed:
        return line
    serialized = json.dumps(
        event,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return body[:marker] + b"data: " + serialized + newline


def _normalize_stream_tool_call_ids(
    event: dict[str, Any],
    tool_call_ids: dict[tuple[int, int], str],
) -> bool:
    choices = event.get("choices")
    if not isinstance(choices, list):
        return False

    changed = False
    for choice_position, choice in enumerate(choices):
        if not isinstance(choice, dict):
            continue
        delta = choice.get("delta")
        if not isinstance(delta, dict):
            continue
        tool_calls = delta.get("tool_calls")
        if not isinstance(tool_calls, list):
            continue

        for call_position, tool_call in enumerate(tool_calls):
            if not isinstance(tool_call, dict):
                continue
            index = tool_call.get("index")
            call_index = (
                index
                if isinstance(index, int) and not isinstance(index, bool)
                else call_position
            )
            key = (choice_position, call_index)
            if key not in tool_call_ids:
                upstream_id = tool_call.get("id")
                if isinstance(upstream_id, str) and upstream_id:
                    tool_call_ids[key] = upstream_id
                elif upstream_id is not None:
                    tool_call_ids[key] = str(upstream_id)
                else:
                    tool_call_ids[key] = f"call_front_{uuid.uuid4().hex}"

            normalized_id = tool_call_ids[key]
            if tool_call.get("id") != normalized_id:
                tool_call["id"] = normalized_id
                changed = True

    return changed


def _rewrite_request_body(
    content: bytes,
    *,
    max_tokens_field: str,
    initial_tool_choice: str | None = None,
    flatten_text_content: bool = False,
    wire_api: str = "chat.completions",
    reasoning_effort: str | None = None,
) -> bytes:
    try:
        body = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return content
    if not isinstance(body, dict):
        return content

    if reasoning_effort is not None:
        request_path = reasoning_defaults(wire_api)["requestPath"]
        target = body
        for segment in request_path[:-1]:
            if not isinstance(target.get(segment), dict):
                target[segment] = {}
            target = target[segment]
        target[request_path[-1]] = reasoning_effort
        if wire_api == "anthropic.messages":
            thinking = body.get("thinking")
            if not isinstance(thinking, dict) or thinking.get("type") != "adaptive":
                body["thinking"] = {"type": "adaptive"}

    token_fields = (
        "max_tokens",
        "max_completion_tokens",
        "max_output_tokens",
    )
    if max_tokens_field in body:
        for field in token_fields:
            if field != max_tokens_field:
                body.pop(field, None)
    else:
        for field in token_fields:
            if field in body:
                body[max_tokens_field] = body.pop(field)
                break
    tool_choice = body.get("tool_choice")
    if (
        initial_tool_choice
        and (tool_choice is None or tool_choice == "auto")
        and _is_initial_tool_request(body)
    ):
        body["tool_choice"] = initial_tool_choice
    if flatten_text_content:
        _flatten_text_message_content(body)
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _flatten_text_message_content(body: dict[str, Any]) -> None:
    messages = body.get("messages")
    if not isinstance(messages, list):
        return

    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue

        text_parts: list[str] = []
        for part in content:
            if (
                not isinstance(part, dict)
                or part.get("type") != "text"
                or not isinstance(part.get("text"), str)
            ):
                break
            text_parts.append(part["text"])
        else:
            message["content"] = "".join(text_parts)


def _is_initial_tool_request(body: dict[str, Any]) -> bool:
    tools = body.get("tools")
    messages = body.get("messages")
    if not isinstance(tools, list) or not tools:
        return False
    if not isinstance(messages, list) or not messages:
        return False

    for message in messages:
        if not isinstance(message, dict):
            continue
        if message.get("role") == "tool":
            return False
        if message.get("role") == "assistant" and (
            message.get("tool_calls") or message.get("function_call")
        ):
            return False
    return True


def _communicate_run(
    process: subprocess.Popen[str],
    *,
    proxy_state: _ProxyState,
    prompt: str,
    timeout_seconds: int | None,
) -> None:
    deadline = (
        time.monotonic() + timeout_seconds if timeout_seconds is not None else None
    )
    pending_input: str | None = prompt
    while True:
        if proxy_state.error is not None:
            raise proxy_state.error
        remaining = deadline - time.monotonic() if deadline is not None else 0.25
        if remaining <= 0:
            raise subprocess.TimeoutExpired(process.args, timeout_seconds)
        try:
            process.communicate(input=pending_input, timeout=min(0.25, remaining))
        except subprocess.TimeoutExpired:
            pending_input = None
            continue
        if proxy_state.error is not None:
            raise proxy_state.error
        return


def _stop_process(
    process: subprocess.Popen[str], stop_signal: int = signal.SIGTERM,
) -> None:
    try:
        os.killpg(process.pid, stop_signal)
    except ProcessLookupError:
        pass
    try:
        process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()


def _add_event_summary(prepared: PreparedRun, events_path: Path) -> None:
    if not events_path.is_file():
        return

    counts: Counter[str] = Counter()
    session_ids: set[str] = set()
    with events_path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                counts["invalid"] += 1
                continue
            event_type = str(event.get("type", "unknown"))
            counts[event_type] += 1
            session_id = event.get("sessionID")
            if isinstance(session_id, str) and session_id:
                session_ids.add(session_id)

    prepared.metadata["events"] = {
        "path": _display_path(events_path, prepared.repo_root),
        "counts": dict(sorted(counts.items())),
    }
    if len(session_ids) == 1:
        prepared.metadata["engine"]["sessionId"] = next(iter(session_ids))
    elif session_ids:
        prepared.metadata["engine"]["sessionIds"] = sorted(session_ids)


def _single_session_id(events_path: Path) -> str:
    if not events_path.is_file():
        raise FileNotFoundError(f"Missing source events: {events_path}")
    session_ids: set[str] = set()
    with events_path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            session_id = event.get("sessionID")
            if isinstance(session_id, str) and session_id:
                session_ids.add(session_id)
    if len(session_ids) != 1:
        raise ValueError(
            f"Expected exactly one OpenCode session in {events_path}; "
            f"found {len(session_ids)}"
        )
    return next(iter(session_ids))


def _completed_agent_steps(events_path: Path) -> int:
    message_ids: set[str] = set()
    anonymous_steps = 0
    with events_path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "step_finish":
                continue
            part = event.get("part")
            message_id = part.get("messageID") if isinstance(part, dict) else None
            if isinstance(message_id, str) and message_id:
                message_ids.add(message_id)
            else:
                anonymous_steps += 1
    return len(message_ids) + anonymous_steps


def _active_resume_attempt(
    metadata: dict[str, Any],
) -> dict[str, Any] | None:
    resume = metadata.get("resume")
    if not isinstance(resume, dict):
        return None
    attempts = resume.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        return None
    attempt = attempts[-1]
    return attempt if isinstance(attempt, dict) else None


def _validate_completed_run(prepared: PreparedRun, events_path: Path) -> None:
    counts = prepared.metadata.get("events", {}).get("counts", {})
    tool_uses = int(counts.get("tool_use", 0))
    workspace_files = sum(
        1
        for path in prepared.workspace.rglob("*")
        if path.is_file()
        and not {".git", "node_modules"}.intersection(
            path.relative_to(prepared.workspace).parts
        )
    )
    validation = prepared.metadata.setdefault("validation", {})
    if not isinstance(validation, dict):
        validation = {}
        prepared.metadata["validation"] = validation
    validation.update(
        {
            "toolUses": tool_uses,
            "workspaceFiles": workspace_files,
        }
    )
    if _last_step_finish_reason(events_path) == "length":
        validation["finishReason"] = "length"
        prepared.metadata["status"] = "failed"
        prepared.metadata["error"] = {
            "type": "OutputLengthExceeded",
            "message": (
                "OpenCode model response reached the output token limit "
                "before completing the task"
            ),
        }
        return
    if tool_uses > 0 and workspace_files > 0:
        return

    prepared.metadata["status"] = "failed"
    prepared.metadata["error"] = {
        "type": "IncompleteAgentRun",
        "message": (
            "OpenCode exited successfully without both tool use and "
            "workspace output"
        ),
    }


def _last_step_finish_reason(events_path: Path) -> str | None:
    reason: str | None = None
    if not events_path.is_file():
        return reason
    with events_path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "step_finish":
                continue
            part = event.get("part")
            candidate = part.get("reason") if isinstance(part, dict) else None
            if isinstance(candidate, str) and candidate:
                reason = candidate
    return reason


def _validate_resume_progress(
    prepared: PreparedRun,
    events_path: Path,
    events_before: int,
) -> None:
    events_added = max(0, _event_line_count(events_path) - events_before)
    validation = prepared.metadata.setdefault("validation", {})
    if not isinstance(validation, dict):
        validation = {}
        prepared.metadata["validation"] = validation
    validation["resumeEventsAdded"] = events_added
    if events_added > 0:
        return

    prepared.metadata["status"] = "failed"
    prepared.metadata["error"] = {
        "type": "IncompleteResume",
        "message": "OpenCode resumed session exited without appending events",
    }


def _event_line_count(path: Path) -> int:
    if not path.is_file():
        return 0
    with path.open(encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def _failure_message(stderr_path: Path, return_code: int | None) -> str:
    if stderr_path.is_file():
        content = stderr_path.read_text(encoding="utf-8", errors="replace").strip()
        if content:
            return content[-2000:]
    return f"OpenCode exited with status {return_code}"


def _write_json(path: Path, content: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(content, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_private_json(path: Path, content: dict[str, Any]) -> None:
    _write_private_text(
        path,
        json.dumps(content, ensure_ascii=False, indent=2) + "\n",
    )


def _write_private_text(path: Path, content: str) -> None:
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(content)


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


def _default_run_id() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{timestamp}-{uuid.uuid4().hex[:8]}"


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root.resolve()))
    except ValueError:
        return str(path.resolve())

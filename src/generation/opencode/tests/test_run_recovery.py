import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import Mock

import pytest

from front_opencode import runner
from front_opencode.runner import (
    RUN_LOCK_PROTOCOL,
    PreparedRun,
    RunInterrupted,
    _run_lock,
    execute_run,
    prepare_resume_run,
    prepare_run,
    write_metadata,
)


@pytest.fixture
def interrupted_run(tmp_path: Path) -> PreparedRun:
    repo_root = tmp_path / "repo"
    tasks = repo_root / "data" / "tasks"
    tasks.mkdir(parents=True)
    (tasks / "joyfrontbench-001.md").write_text("A test task.\n", encoding="utf-8")
    prepared = prepare_run(
        repo_root,
        task_reference="001",
        model_name="test-model",
        run_id="source",
        max_steps=3,
        environment={
            "OPENAI_API_KEY": "old-secret",
            "OPENAI_BASE_URL": "https://original.example/v1",
            "MODEL_WIRE_API": "responses",
            "MODEL_MAX_TOKENS": "4096",
        },
    )
    (prepared.run_dir / "events.jsonl").write_text(
        json.dumps({"type": "step_finish", "sessionID": "ses_test"}) + "\n",
        encoding="utf-8",
    )
    prepared.metadata["status"] = "interrupted"
    write_metadata(prepared)
    return prepared


def test_resume_preserves_settings_and_records_model_history(interrupted_run) -> None:
    source = interrupted_run
    original_model = source.metadata["model"]

    resumed, session_id, remaining_steps = prepare_resume_run(
        source.repo_root,
        source_run=source.run_dir,
        environment={"OPENAI_API_KEY": "new-secret"},
    )

    assert session_id == "ses_test"
    assert remaining_steps == 2
    assert resumed.model.api_key == "new-secret"
    assert resumed.model.public_metadata() == original_model
    attempt = resumed.metadata["resume"]["attempts"][0]
    assert attempt["previousModel"] == original_model
    assert attempt["model"] == original_model
    assert "secret" not in (source.run_dir / "metadata.json").read_text()


def test_resume_records_explicit_parameter_changes(interrupted_run) -> None:
    source = interrupted_run
    resumed, _, _ = prepare_resume_run(
        source.repo_root,
        source_run=source.run_dir,
        environment={"OPENAI_API_KEY": "new-secret", "MODEL_MAX_TOKENS": "8192"},
        reasoning_effort="high",
    )

    attempt = resumed.metadata["resume"]["attempts"][0]
    assert attempt["previousModel"]["request"]["maxTokens"] == 4096
    assert attempt["model"]["request"]["maxTokens"] == 8192
    assert attempt["model"]["reasoningEffort"]["selected"] == "high"
    assert resumed.model.wire_api == "responses"


def test_resume_resolves_recorded_task_against_its_repository(
    interrupted_run,
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = interrupted_run
    other_repo = tmp_path / "other"
    other_task = other_repo / source.metadata["task"]["path"]
    other_task.parent.mkdir(parents=True)
    other_task.write_text("A different task.\n", encoding="utf-8")
    monkeypatch.chdir(other_repo)

    resumed, _, _ = prepare_resume_run(
        source.repo_root,
        source_run=source.run_dir,
        environment={},
    )

    assert resumed.task_path == source.task_path


def test_resume_rejects_actual_task_changes(interrupted_run) -> None:
    source = interrupted_run
    source.task_path.write_text("Changed task.\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Task changed"):
        prepare_resume_run(source.repo_root, source_run=source.run_dir, environment={})


@pytest.mark.parametrize("revision", [None, 1])
def test_resume_does_not_modify_an_active_run(interrupted_run, revision) -> None:
    source = interrupted_run
    source.metadata["status"] = "running"
    source.metadata["run"]["lockProtocol"] = (
        RUN_LOCK_PROTOCOL if revision is None else f"{RUN_LOCK_PROTOCOL}-v{revision}"
    )
    write_metadata(source)
    metadata_path = source.run_dir / "metadata.json"
    before = metadata_path.read_bytes()

    with _run_lock(source.run_dir), pytest.raises(ValueError, match="already active"):
        prepare_resume_run(source.repo_root, source_run=source.run_dir, environment={})

    assert metadata_path.read_bytes() == before


@pytest.mark.parametrize("revision", [None, 1])
def test_resume_recovers_stale_lock_aware_runs(interrupted_run, revision) -> None:
    source = interrupted_run
    source.metadata["status"] = "running"
    source.metadata["run"]["lockProtocol"] = (
        RUN_LOCK_PROTOCOL if revision is None else f"{RUN_LOCK_PROTOCOL}-v{revision}"
    )
    write_metadata(source)

    resumed, _, _ = prepare_resume_run(
        source.repo_root,
        source_run=source.run_dir,
        environment={},
    )

    attempt = resumed.metadata["resume"]["attempts"][0]
    assert attempt["previousStatus"] == "running"
    assert attempt["recoveredStaleRun"] is True


@pytest.mark.parametrize("revision", [None, 2])
def test_resume_does_not_assume_legacy_running_records_are_stale(
    interrupted_run, revision,
) -> None:
    source = interrupted_run
    source.metadata["status"] = "running"
    if revision is not None:
        source.metadata["run"]["lockProtocol"] = f"{RUN_LOCK_PROTOCOL}-v{revision}"
    write_metadata(source)

    with pytest.raises(ValueError, match="Cannot safely resume a legacy run"):
        prepare_resume_run(source.repo_root, source_run=source.run_dir, environment={})


def test_execute_rejects_a_superseded_resume_preparation(interrupted_run) -> None:
    source = interrupted_run
    resumed, _, _ = prepare_resume_run(
        source.repo_root,
        source_run=source.run_dir,
        environment={},
    )
    prepare_resume_run(source.repo_root, source_run=source.run_dir, environment={})
    metadata_path = source.run_dir / "metadata.json"
    before = metadata_path.read_bytes()

    with pytest.raises(ValueError, match="Run changed since preparation"):
        execute_run(resumed, opencode_binary="must-not-execute")

    assert metadata_path.read_bytes() == before


def test_interruption_during_setup_is_persisted(interrupted_run, monkeypatch) -> None:
    source = interrupted_run
    previous_handler = signal.getsignal(signal.SIGTERM)

    def interrupt(prepared):
        raise KeyboardInterrupt

    monkeypatch.setattr(runner, "_runtime_environment", interrupt)
    with pytest.raises(KeyboardInterrupt):
        execute_run(source)

    metadata = json.loads((source.run_dir / "metadata.json").read_text())
    assert metadata["status"] == "interrupted"
    assert metadata["completedAt"]
    assert signal.getsignal(signal.SIGTERM) == previous_handler
    with _run_lock(source.run_dir):
        pass


def test_interruption_is_persisted_before_waiting_for_shutdown(
    interrupted_run, monkeypatch
) -> None:
    source = interrupted_run
    process = Mock()
    process.poll.return_value = 0
    observed_statuses = []

    def interrupt(*args, **kwargs):
        raise RunInterrupted(signal.SIGTERM)

    def stop(*args):
        metadata = json.loads((source.run_dir / "metadata.json").read_text())
        observed_statuses.append(metadata["status"])

    monkeypatch.setattr(runner.subprocess, "Popen", Mock(return_value=process))
    monkeypatch.setattr(runner, "_communicate_run", interrupt)
    monkeypatch.setattr(runner, "_stop_process", stop)

    with pytest.raises(RunInterrupted):
        execute_run(source)

    assert observed_statuses == ["interrupted"]


@pytest.fixture
def blocking_run(interrupted_run, tmp_path: Path, request):
    repo_root = interrupted_run.repo_root
    binaries = tmp_path / "bin"
    binaries.mkdir()
    executable = binaries / "opencode"
    executable.write_text(
        f"#!{sys.executable}\n"
        "import json, os, pathlib, time\n"
        "event = {'type': 'step_finish', 'sessionID': 'ses_signal'}\n"
        "print(json.dumps(event), flush=True)\n"
        "pathlib.Path('../child-ready').write_text(str(os.getpid()))\n"
        "time.sleep(60)\n",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    run_dir = repo_root / "runs" / "opencode" / "test-model" / "001" / "signal-run"
    source_root = Path(__file__).resolve().parents[2]
    environment = {
        **os.environ,
        "PATH": f"{binaries}:{os.environ.get('PATH', '')}",
        "PYTHONPATH": os.pathsep.join([
            str(source_root / "common" / "src"),
            str(source_root / "opencode" / "src"),
        ]),
        "PYTHONDONTWRITEBYTECODE": "1",
        "TMPDIR": str(tmp_path),
        "FRONT_ENV_FILE": "",
        "OPENAI_API_KEY": "test-key",
        "OPENAI_BASE_URL": "https://api.example/v1",
        "MODEL_WIRE_API": "chat.completions",
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "front_opencode",
            "--repo-root",
            str(repo_root),
            "run",
            "--task",
            "001",
            "--model",
            "test-model",
            "--run-id",
            "signal-run",
            "--max-steps",
            "3",
            "--timeout-seconds",
            str(getattr(request, "param", 30)),
        ],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    child_pid = None
    try:
        deadline = time.monotonic() + 15
        ready = run_dir / "child-ready"
        while not ready.exists():
            if process.poll() is not None:
                pytest.fail(f"Fake executor failed: {process.communicate()}")
            if time.monotonic() > deadline:
                pytest.fail("Fake executor did not start")
            time.sleep(0.02)
        child_pid = int(ready.read_text())
        yield process, repo_root, run_dir, child_pid
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=15)
        if child_pid is not None:
            try:
                os.killpg(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
def test_signals_persist_resumable_state_and_cli_exit_code(
    blocking_run, signum
) -> None:
    process, repo_root, run_dir, _ = blocking_run
    process.send_signal(signum)
    _, stderr = process.communicate(timeout=15)

    assert process.returncode == 128 + signum, stderr
    metadata = json.loads((run_dir / "metadata.json").read_text())
    assert metadata["status"] == "interrupted"
    assert signal.Signals(signum).name in metadata["error"]["message"]
    assert metadata["completedAt"]
    resumed, session_id, remaining_steps = prepare_resume_run(
        repo_root,
        source_run=run_dir,
        environment={},
    )
    assert resumed.run_dir == run_dir
    assert session_id == "ses_signal"
    assert remaining_steps == 2


@pytest.mark.parametrize("blocking_run", [1], indirect=True)
def test_wall_clock_timeout_remains_resumable(blocking_run) -> None:
    process, repo_root, run_dir, _ = blocking_run
    process.communicate(timeout=10)

    assert process.returncode == 1
    metadata = json.loads((run_dir / "metadata.json").read_text())
    assert metadata["status"] == "timed-out"
    assert metadata["error"]["type"] == "TimeoutExpired"
    assert metadata["run"]["exitCode"] is not None
    _, session_id, remaining_steps = prepare_resume_run(
        repo_root,
        source_run=run_dir,
        environment={},
    )
    assert session_id == "ses_signal"
    assert remaining_steps == 2


def test_orphaned_executor_keeps_lock_until_it_stops(blocking_run) -> None:
    process, repo_root, run_dir, child_pid = blocking_run
    process.kill()
    process.communicate(timeout=10)

    with pytest.raises(ValueError, match="already active"):
        prepare_resume_run(repo_root, source_run=run_dir, environment={})

    os.killpg(child_pid, signal.SIGKILL)
    deadline = time.monotonic() + 5
    while True:
        try:
            resumed, _, _ = prepare_resume_run(
                repo_root,
                source_run=run_dir,
                environment={},
            )
            break
        except ValueError as exc:
            if "already active" not in str(exc) or time.monotonic() > deadline:
                raise
            time.sleep(0.02)
    assert resumed.metadata["resume"]["attempts"][0]["recoveredStaleRun"] is True

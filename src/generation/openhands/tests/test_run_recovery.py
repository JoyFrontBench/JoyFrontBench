import json
import multiprocessing
import os
import signal
import sys
import time
import uuid
from dataclasses import replace
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from front_openhands import runner
from front_openhands.runner import (
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
def source_run(tmp_path: Path) -> PreparedRun:
    repo_root = tmp_path / "repo"
    tasks = repo_root / "data" / "tasks"
    tasks.mkdir(parents=True)
    (tasks / "joyfrontbench-001.md").write_text("A test task.\n", encoding="utf-8")
    prepared = prepare_run(
        repo_root,
        task_reference="001",
        model_name="test-model",
        run_id="source",
        max_iterations=3,
        environment={
            "OPENAI_API_KEY": "old-secret",
            "OPENAI_BASE_URL": "https://original.example/v1",
            "MODEL_WIRE_API": "responses",
            "MODEL_MAX_TOKENS": "4096",
        },
    )
    conversation_id = uuid.uuid4()
    conversation_dir = prepared.persistence_dir / conversation_id.hex
    events = conversation_dir / "events"
    events.mkdir(parents=True)
    (conversation_dir / "base_state.json").write_text(
        json.dumps({"id": str(conversation_id)}), encoding="utf-8",
    )
    (events / "event-00000-test.json").write_text(
        json.dumps({"source": "agent", "llm_response_id": "response-1"}),
        encoding="utf-8",
    )
    prepared.metadata["status"] = "interrupted"
    write_metadata(prepared)
    return prepared


@pytest.fixture
def fake_sdk(monkeypatch):
    monkeypatch.setattr(runner, "WORKER_STOP_GRACE_SECONDS", 0.1)

    def install(mode="completed", signum=signal.SIGINT):
        class FakeConversation:
            def __init__(self, **options):
                self.workspace = options["workspace"]
                self.run_dir = self.workspace.parent
                self.state = SimpleNamespace(
                    execution_status=SimpleNamespace(value="finished"),
                    active_branch=lambda: [],
                    get_unmatched_actions=lambda events: [],
                )
                (self.run_dir / "worker.pid").write_text(str(os.getpid()))
                (self.run_dir / "sdk-input.json").write_text(json.dumps({
                    "conversationId": str(options["conversation_id"]),
                    "iterations": options["max_iteration_per_run"],
                    "model": options["agent"].llm.model.public_metadata(),
                }))
                if mode == "init-hang":
                    self.block()

            def send_message(self, prompt):
                (self.run_dir / "sent-prompt.md").write_text(prompt)

            def run(self):
                if mode in {"signal", "signal-close-hang"}:
                    os.kill(os.getppid(), signum)
                    time.sleep(60)
                if mode == "run-hang":
                    self.block()
                if mode in {"failed", "failed-close"}:
                    raise ValueError("original error containing old-secret")
                if mode == "interrupted":
                    raise KeyboardInterrupt("interrupted fixture")
                if mode == "exit":
                    os._exit(7)
                if mode != "empty":
                    (self.workspace / "index.html").write_text("<p>Test output</p>")

            def close(self):
                if mode in {"failed-close", "close-failed"}:
                    raise RuntimeError("cleanup failure")
                if mode in {"close-hang", "signal-close-hang"}:
                    self.block()
                (self.run_dir / "closed").touch()

            def block(self):
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                (self.run_dir / "blocked").touch()
                time.sleep(60)

        modules = {
            name: ModuleType(name)
            for name in (
                "openhands", "openhands.sdk", "openhands.tools",
                "openhands.tools.file_editor", "openhands.tools.task_tracker",
                "openhands.tools.terminal", "front_openhands.llm",
            )
        }
        modules["openhands.sdk"].Agent = SimpleNamespace
        modules["openhands.sdk"].Tool = SimpleNamespace
        modules["openhands.sdk"].Conversation = FakeConversation
        for module, tool in (
            ("file_editor", "FileEditorTool"),
            ("task_tracker", "TaskTrackerTool"),
            ("terminal", "TerminalTool"),
        ):
            setattr(
                modules[f"openhands.tools.{module}"], tool, SimpleNamespace(name=tool),
            )
        modules["front_openhands.llm"].build_llm = lambda model: SimpleNamespace(
            metrics=None, model=model,
        )
        for name, module in modules.items():
            monkeypatch.setitem(sys.modules, name, module)

    return install


def resume(source, **overrides):
    return prepare_resume_run(
        source.repo_root, source_run=source.run_dir,
        environment={"OPENAI_API_KEY": "new-secret", **overrides},
    )


def test_write_metadata_keeps_interleaved_temporary_files_separate(
    source_run, monkeypatch,
) -> None:
    metadata_path = source_run.run_dir / "metadata.json"
    before = metadata_path.read_bytes()
    original_files = set(source_run.run_dir.iterdir())
    other = replace(source_run, metadata={**source_run.metadata, "status": "running"})
    original_replace = Path.replace
    temporary_paths = []

    def interleave(temporary, target):
        temporary_paths.append(temporary)
        assert temporary.parent == metadata_path.parent
        if len(temporary_paths) == 1:
            assert metadata_path.read_bytes() == before
            write_metadata(other)
            assert json.loads(metadata_path.read_text()) == other.metadata
        return original_replace(temporary, target)

    monkeypatch.setattr(Path, "replace", interleave)

    write_metadata(source_run)

    assert len(temporary_paths) == len(set(temporary_paths)) == 2
    assert json.loads(metadata_path.read_text()) == source_run.metadata
    assert set(source_run.run_dir.iterdir()) == original_files


@pytest.mark.parametrize("error_type", [OSError, KeyboardInterrupt])
def test_write_metadata_preserves_previous_file_and_cleans_up_on_failure(
    source_run, monkeypatch, error_type,
) -> None:
    metadata_path = source_run.run_dir / "metadata.json"
    before = metadata_path.read_bytes()
    original_files = set(source_run.run_dir.iterdir())
    error = error_type("metadata commit interrupted")

    def fail_to_replace(temporary, target):
        assert json.loads(temporary.read_text()) == source_run.metadata
        assert metadata_path.read_bytes() == before
        raise error

    monkeypatch.setattr(Path, "replace", fail_to_replace)
    source_run.metadata["status"] = "running"

    with pytest.raises(error_type) as raised:
        write_metadata(source_run)

    assert raised.value is error
    assert metadata_path.read_bytes() == before
    assert set(source_run.run_dir.iterdir()) == original_files


def test_write_metadata_cleans_up_after_serialization_failure(source_run) -> None:
    metadata_path = source_run.run_dir / "metadata.json"
    before = metadata_path.read_bytes()
    original_files = set(source_run.run_dir.iterdir())
    source_run.metadata["invalid"] = object()

    with pytest.raises(TypeError):
        write_metadata(source_run)

    assert metadata_path.read_bytes() == before
    assert set(source_run.run_dir.iterdir()) == original_files


def test_resume_inherits_parameters_and_records_history(source_run) -> None:
    original = source_run.model.public_metadata()

    prepared, _, remaining = resume(source_run)

    assert prepared.model.public_metadata() == original
    assert prepared.model.api_key == "new-secret"
    assert remaining == 2
    attempt = prepared.metadata["resume"]["attempts"][-1]
    assert attempt["previousModel"] == original
    assert attempt["model"] == original
    assert "secret" not in (source_run.run_dir / "metadata.json").read_text()


def test_resume_records_explicit_parameter_changes(source_run) -> None:
    prepared, _, _ = resume(source_run, MODEL_MAX_TOKENS="8192")

    attempt = prepared.metadata["resume"]["attempts"][-1]
    assert attempt["previousModel"]["request"]["maxTokens"] == 4096
    assert attempt["model"]["request"]["maxTokens"] == 8192
    assert prepared.model.wire_api == "responses"


def test_resume_anchors_saved_task_to_its_repository(
    source_run, tmp_path: Path, monkeypatch,
) -> None:
    other_repo = tmp_path / "other-repo"
    other_task = other_repo / source_run.metadata["task"]["path"]
    other_task.parent.mkdir(parents=True)
    other_task.write_text("Different task.\n")
    monkeypatch.chdir(other_repo)

    prepared, _, _ = resume(source_run)

    assert prepared.task_path == source_run.task_path


def test_resume_rejects_actual_task_changes(source_run) -> None:
    source_run.task_path.write_text("Changed task.\n")

    with pytest.raises(ValueError, match="Task changed"):
        resume(source_run)


@pytest.mark.parametrize("revision", [None, 1])
def test_resume_rejects_active_runs_without_modifying_metadata(
    source_run, revision,
) -> None:
    source_run.metadata["status"] = "running"
    source_run.metadata["run"]["lockProtocol"] = (
        RUN_LOCK_PROTOCOL if revision is None else f"{RUN_LOCK_PROTOCOL}-v{revision}"
    )
    write_metadata(source_run)
    metadata_path = source_run.run_dir / "metadata.json"
    before = metadata_path.read_bytes()

    with (
        _run_lock(source_run.run_dir),
        pytest.raises(ValueError, match="already active"),
    ):
        resume(source_run)

    assert metadata_path.read_bytes() == before


@pytest.mark.parametrize("revision", [None, 1])
def test_resume_recovers_unlocked_running_records(source_run, revision) -> None:
    source_run.metadata["status"] = "running"
    source_run.metadata["run"]["lockProtocol"] = (
        RUN_LOCK_PROTOCOL if revision is None else f"{RUN_LOCK_PROTOCOL}-v{revision}"
    )
    write_metadata(source_run)

    prepared, _, _ = resume(source_run)

    attempt = prepared.metadata["resume"]["attempts"][-1]
    assert attempt["previousStatus"] == "running"
    assert attempt["recoveredStaleRun"] is True


@pytest.mark.parametrize("revision", [None, 2])
def test_resume_does_not_guess_if_a_legacy_run_is_stale(source_run, revision) -> None:
    source_run.metadata["status"] = "running"
    if revision is not None:
        source_run.metadata["run"]["lockProtocol"] = f"{RUN_LOCK_PROTOCOL}-v{revision}"
    write_metadata(source_run)

    with pytest.raises(ValueError, match="Cannot safely resume a legacy run"):
        resume(source_run)


def test_execute_rejects_active_runs(source_run) -> None:
    with (
        _run_lock(source_run.run_dir),
        pytest.raises(ValueError, match="already active"),
    ):
        execute_run(source_run, max_iterations=3)


def test_execute_rejects_superseded_preparations(source_run) -> None:
    prepared, _, remaining = resume(source_run)
    resume(source_run)
    metadata_path = source_run.run_dir / "metadata.json"
    before = metadata_path.read_bytes()

    with pytest.raises(ValueError, match="Run changed since preparation"):
        execute_run(prepared, max_iterations=remaining)

    assert metadata_path.read_bytes() == before


@pytest.mark.parametrize("timeout_seconds", [None, 2])
def test_execute_completes_and_closes_worker(source_run, fake_sdk, timeout_seconds):
    fake_sdk()

    metadata = execute_run(
        source_run, max_iterations=3, timeout_seconds=timeout_seconds,
    )

    assert metadata["status"] == "completed"
    assert metadata["durationSeconds"] >= 0
    assert (source_run.run_dir / "closed").exists()
    assert (source_run.run_dir / "sent-prompt.md").exists()
    assert json.loads((source_run.run_dir / "metadata.json").read_text()) == metadata
    worker_pid = int((source_run.run_dir / "worker.pid").read_text())
    assert worker_pid != os.getpid()
    with pytest.raises(ProcessLookupError):
        os.kill(worker_pid, 0)
    with _run_lock(source_run.run_dir):
        pass


def test_execute_preserves_empty_workspace_validation(source_run, fake_sdk) -> None:
    fake_sdk("empty")

    metadata = execute_run(source_run, max_iterations=3)

    assert metadata["status"] == "failed"
    assert metadata["error"]["type"] == "IncompleteAgentRun"


def test_resume_passes_restored_parameters_to_sdk_and_finishes_attempt(
    source_run, fake_sdk,
) -> None:
    fake_sdk()
    source_run.metadata["run"]["timeoutSeconds"] = 10
    write_metadata(source_run)
    prepared, conversation_id, remaining = resume(source_run)

    metadata = execute_run(
        prepared, max_iterations=remaining, conversation_id=conversation_id,
        send_prompt=False,
    )

    inputs = json.loads((source_run.run_dir / "sdk-input.json").read_text())
    assert inputs["conversationId"] == str(conversation_id)
    assert inputs["iterations"] == remaining
    assert inputs["model"] == prepared.model.public_metadata()
    assert not (source_run.run_dir / "sent-prompt.md").exists()
    attempt = metadata["resume"]["attempts"][-1]
    assert attempt["status"] == "completed"
    assert attempt["startedAt"] == metadata["startedAt"]
    assert attempt["completedAt"] == metadata["completedAt"]
    assert attempt["durationSeconds"] == metadata["durationSeconds"]
    assert attempt["previousTimeoutSeconds"] == 10
    assert attempt["timeoutSeconds"] is None
    assert "timeoutSeconds" not in metadata["run"]


def test_keyboard_interrupt_is_persisted_and_can_resume(source_run, fake_sdk) -> None:
    fake_sdk("interrupted")

    metadata = execute_run(source_run, max_iterations=3)

    assert metadata["status"] == "interrupted"
    assert metadata["error"]["type"] == "KeyboardInterrupt"
    assert (source_run.run_dir / "closed").exists()
    prepared, _, _ = resume(source_run)
    attempt = prepared.metadata["resume"]["attempts"][-1]
    assert attempt["previousStatus"] == "interrupted"


@pytest.mark.parametrize("mode", ["failed-close", "close-failed"])
def test_cleanup_failure_is_persisted_without_masking_original_error(
    source_run, fake_sdk, mode,
) -> None:
    fake_sdk(mode)

    metadata = execute_run(source_run, max_iterations=3)

    assert metadata["status"] == "failed"
    expected_type = "ValueError" if mode == "failed-close" else "RuntimeError"
    assert metadata["error"]["type"] == expected_type
    assert metadata["cleanupError"]["message"] == "cleanup failure"
    assert "old-secret" not in json.dumps(metadata)
    assert metadata["completedAt"]
    resume(source_run)


@pytest.mark.parametrize("mode", ["init-hang", "run-hang", "close-hang"])
def test_timeout_kills_noncooperative_initialization_run_and_cleanup(
    source_run, fake_sdk, mode,
) -> None:
    fake_sdk(mode)
    started = time.monotonic()

    metadata = execute_run(source_run, max_iterations=3, timeout_seconds=1)

    assert 1 <= time.monotonic() - started < 5
    assert metadata["status"] == "timed-out"
    assert metadata["error"]["type"] == "TimeoutExpired"
    assert metadata["completedAt"]
    worker_pid = int((source_run.run_dir / "worker.pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(worker_pid, 0)
    resume(source_run)


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
@pytest.mark.parametrize("mode", ["signal", "signal-close-hang"])
def test_parent_signals_stop_worker_and_restore_handlers(
    source_run, fake_sdk, monkeypatch, signum, mode,
):
    fake_sdk(mode, signum=signum)
    previous = {
        number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)
    }
    parent_pid = os.getpid()
    original_write = runner.write_metadata
    final_statuses = []

    def write_after_worker_exit(prepared):
        if os.getpid() == parent_pid and prepared.metadata.get("completedAt"):
            worker_pid = int((prepared.run_dir / "worker.pid").read_text())
            with pytest.raises(ProcessLookupError):
                os.kill(worker_pid, 0)
            final_statuses.append(prepared.metadata["status"])
        original_write(prepared)

    monkeypatch.setattr(runner, "write_metadata", write_after_worker_exit)

    with pytest.raises(RunInterrupted) as raised:
        execute_run(source_run, max_iterations=3)

    assert raised.value.signum == signum
    assert final_statuses == ["interrupted"]
    metadata = json.loads((source_run.run_dir / "metadata.json").read_text())
    assert metadata["status"] == "interrupted"
    assert metadata["error"]["type"] == "RunInterrupted"
    assert signal.Signals(signum).name in metadata["error"]["message"]
    assert metadata["completedAt"]
    assert not list(source_run.run_dir.glob(".metadata-*.tmp"))
    for number, handler in previous.items():
        assert signal.getsignal(number) == handler
    worker_pid = int((source_run.run_dir / "worker.pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(worker_pid, 0)
    resumed, conversation_id, remaining = resume(source_run)
    final_statuses.clear()
    fake_sdk()

    result = execute_run(
        resumed, max_iterations=remaining, conversation_id=conversation_id,
        send_prompt=False,
    )

    assert result["status"] == "completed"
    assert result["resume"]["attempts"][-1]["status"] == "completed"
    assert "error" not in result
    assert final_statuses == ["completed"]
    assert json.loads((source_run.run_dir / "metadata.json").read_text()) == result
    assert not list(source_run.run_dir.glob(".metadata-*.tmp"))


def test_parent_cleans_up_temporary_metadata_after_killing_writer(
    source_run, fake_sdk, monkeypatch,
) -> None:
    fake_sdk()
    parent_pid = os.getpid()
    original_dump = json.dump

    def block_worker_write(*args, **kwargs):
        if os.getpid() != parent_pid:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            os.kill(parent_pid, signal.SIGTERM)
            time.sleep(60)
        return original_dump(*args, **kwargs)

    monkeypatch.setattr(runner.json, "dump", block_worker_write)

    with pytest.raises(RunInterrupted) as raised:
        execute_run(source_run, max_iterations=3)

    assert raised.value.signum == signal.SIGTERM
    metadata = json.loads((source_run.run_dir / "metadata.json").read_text())
    assert metadata["status"] == "interrupted"
    assert metadata["completedAt"]
    assert not list(source_run.run_dir.glob(".metadata-*.tmp"))
    worker_pid = int((source_run.run_dir / "worker.pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(worker_pid, 0)


def test_unexpected_worker_exit_is_not_left_running(source_run, fake_sdk) -> None:
    fake_sdk("exit")

    metadata = execute_run(source_run, max_iterations=3)

    assert metadata["status"] == "failed"
    assert metadata["error"]["type"] == "WorkerProcessError"
    assert "7" in metadata["error"]["message"]


@pytest.mark.parametrize(
    ("error_type", "status"),
    [(RuntimeError, "failed"), (KeyboardInterrupt, "interrupted")],
)
def test_worker_setup_failure_is_persisted(source_run, monkeypatch, error_type, status):
    def fail_to_create_worker(*args, **kwargs):
        raise error_type("worker setup failed")

    monkeypatch.setattr(runner.multiprocessing, "get_context", fail_to_create_worker)

    with pytest.raises(error_type, match="worker setup failed"):
        execute_run(source_run, max_iterations=3)

    metadata = json.loads((source_run.run_dir / "metadata.json").read_text())
    assert metadata["status"] == status
    assert metadata["error"]["type"] == error_type.__name__
    assert metadata["completedAt"]


def test_worker_keeps_lock_if_supervisor_is_killed(source_run, fake_sdk) -> None:
    fake_sdk("run-hang")
    supervisor = multiprocessing.get_context("fork").Process(
        target=execute_run, args=(source_run,), kwargs={"max_iterations": 3},
    )
    worker_pid = None
    supervisor.start()
    try:
        deadline = time.monotonic() + 5
        while not (source_run.run_dir / "blocked").exists():
            assert time.monotonic() < deadline, "Worker did not start"
            time.sleep(0.01)
        worker_pid = int((source_run.run_dir / "worker.pid").read_text())
        supervisor.kill()
        supervisor.join(5)
        assert not supervisor.is_alive()

        with pytest.raises(ValueError, match="already active"):
            resume(source_run)
    finally:
        if worker_pid is None and (source_run.run_dir / "worker.pid").exists():
            worker_pid = int((source_run.run_dir / "worker.pid").read_text())
        if worker_pid is not None:
            try:
                os.killpg(worker_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if supervisor.is_alive():
            supervisor.kill()
        supervisor.join(5)
        supervisor.close()

    deadline = time.monotonic() + 5
    while True:
        try:
            prepared, _, _ = resume(source_run)
            break
        except ValueError as error:
            assert "already active" in str(error)
            assert time.monotonic() < deadline, "Worker did not release its lock"
            time.sleep(0.01)
    assert prepared.metadata["resume"]["attempts"][-1]["recoveredStaleRun"] is True

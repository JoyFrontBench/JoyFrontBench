import json
import signal
from pathlib import Path

import pytest

from front_openhands import cli
from front_openhands.cli import build_parser, main, status_exit_code
from front_openhands.runner import RunInterrupted


def test_run_defaults_to_500_iterations() -> None:
    args = build_parser().parse_args(
        ["run", "--task", "001", "--model", "chat_model"]
    )
    assert args.max_iterations == 500


def test_run_accepts_wall_clock_timeout() -> None:
    args = build_parser().parse_args(
        [
            "run",
            "--task",
            "001",
            "--model",
            "chat_model",
            "--timeout-seconds",
            "18000",
        ]
    )
    assert args.timeout_seconds == 18000


def test_resume_inherits_iteration_limit_by_default() -> None:
    args = build_parser().parse_args(
        ["resume", "--source-run", "reasoning_chat_model/001/failed-run"]
    )
    assert args.max_iterations is None


def test_resume_accepts_wall_clock_timeout() -> None:
    args = build_parser().parse_args(
        [
            "resume",
            "--source-run",
            "reasoning_chat_model/001/failed-run",
            "--timeout-seconds",
            "18000",
        ]
    )
    assert args.timeout_seconds == 18000


def test_successful_statuses_return_zero() -> None:
    assert status_exit_code("completed") == 0
    assert status_exit_code("dry-run") == 0


def test_non_completed_statuses_return_nonzero() -> None:
    assert status_exit_code("error") == 1
    assert status_exit_code("stopped") == 1
    assert status_exit_code("running") == 1


def test_key_only_configuration_supports_a_native_dry_run(
    tmp_path: Path, monkeypatch, capsys,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "dry-run-secret")
    for variable in (
        "OPENAI_BASE_URL", "MODEL_WIRE_API", "MODEL_MAX_TOKENS",
        "MODEL_CONTEXT_TOKENS", "MODEL_REASONING_EFFORT",
    ):
        monkeypatch.delenv(variable, raising=False)
    result = main([
        "run", "--task", "001", "--model", "example-model",
        "--runs-root", str(tmp_path), "--run-id", "key-only", "--dry-run",
    ])
    assert result == 0
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "dry-run"
    metadata = Path(output["metadata"]).read_text()
    assert "dry-run-secret" not in metadata
    assert not (tmp_path / "config").exists()


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
def test_signal_exit_codes(monkeypatch, capsys, signum) -> None:
    def interrupt(*args, **kwargs):
        raise RunInterrupted(signum)

    monkeypatch.setattr(cli, "prepare_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "execute_run", interrupt)

    result = main(["run", "--task", "001", "--model", "test-model"])

    assert result == 128 + signum
    assert "Interrupted." in capsys.readouterr().err

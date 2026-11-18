import json
from pathlib import Path

from front_opencode.cli import build_parser, main, status_exit_code


def test_run_defaults_to_500_steps() -> None:
    args = build_parser().parse_args(
        ["run", "--task", "001", "--model", "chat_model"]
    )
    assert args.max_steps == 500


def test_resume_requires_only_source_run() -> None:
    args = build_parser().parse_args(
        ["resume", "--source-run", "anthropic_model/001/run-1"]
    )
    assert args.source_run.as_posix() == "anthropic_model/001/run-1"
    assert args.max_steps is None
    assert args.timeout_seconds is None


def test_successful_statuses_return_zero() -> None:
    assert status_exit_code("completed") == 0
    assert status_exit_code("dry-run") == 0


def test_non_completed_statuses_return_nonzero() -> None:
    assert status_exit_code("failed") == 1
    assert status_exit_code("timed-out") == 1
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

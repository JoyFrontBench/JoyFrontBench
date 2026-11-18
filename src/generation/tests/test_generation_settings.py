import importlib
import json
from pathlib import Path

import pytest
from front_generation.models import ModelConfig as SharedModelConfig


@pytest.fixture(params=("opencode", "openhands"))
def harness_name(request: pytest.FixtureRequest) -> str:
    return request.param


@pytest.fixture
def repo_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "repository"
    tasks = root / "data" / "tasks"
    tasks.mkdir(parents=True)
    (tasks / "joyfrontbench-001.md").write_text("# Task\nBuild a small page.\n")
    (root / ".env").write_text("OPENAI_API_KEY=file-test-secret\n")
    for variable in (
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "MODEL_CONTEXT_TOKENS",
        "MODEL_MAX_TOKENS",
        "MODEL_REASONING_EFFORT",
        "MODEL_WIRE_API",
        "FRONT_ENV_FILE",
    ):
        monkeypatch.delenv(variable, raising=False)
    return root


def test_model_loaders_share_the_same_defaults(harness_name: str) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    model = models.build_model_config("example-model", environment={})
    assert isinstance(model, SharedModelConfig)
    assert model.context_tokens == 1_000_000
    assert model.request.max_tokens == 32_768
    assert model.reasoning_effort.default == "high"
    assert model.reasoning_effort.selected == "high"


def test_shared_model_metadata_and_repr_hide_credentials(harness_name: str) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    model = models.build_model_config(
        "example-model", environment={"OPENAI_API_KEY": "configuration-secret"},
    )

    assert model.api_key == "configuration-secret"
    assert "configuration-secret" not in repr(model)
    assert "configuration-secret" not in json.dumps(model.public_metadata())


@pytest.mark.parametrize(
    ("wire_api", "reasoning_path", "token_field"),
    [
        ("chat.completions", ("reasoning_effort",), "max_tokens"),
        ("responses", ("reasoning", "effort"), "max_output_tokens"),
        ("anthropic.messages", ("output_config", "effort"), "max_tokens"),
    ],
)
def test_defaults_use_protocol_specific_fields(
    harness_name: str,
    wire_api: str,
    reasoning_path: tuple[str, ...],
    token_field: str,
) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    model = models.build_model_config(
        "example-model",
        environment={"MODEL_WIRE_API": wire_api},
    )
    assert model.reasoning_effort.request_path == reasoning_path
    assert model.reasoning_effort.selected == "high"
    assert model.request.max_tokens_field == token_field


@pytest.mark.parametrize("value", ["0", "-1", "not-a-number", "1024"])
def test_context_overrides_are_validated(harness_name: str, value: str) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    with pytest.raises(ValueError):
        models.build_model_config(
            "example-model",
            environment={"MODEL_CONTEXT_TOKENS": value},
        )


def test_resume_keeps_legacy_budgets_and_unspecified_reasoning(
    harness_name: str,
    repo_root: Path,
) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    metadata = models.load_model(repo_root, "example-model").public_metadata()
    metadata["contextTokens"] = 131_072
    metadata["request"]["maxTokens"] = 16_384
    metadata["reasoningEffort"] = None
    restored = models.restore_model(repo_root, metadata, environment={})
    assert restored.context_tokens == 131_072
    assert restored.request.max_tokens == 16_384
    assert restored.reasoning_effort is None


@pytest.mark.parametrize("wire_api", ["responses", "anthropic.messages"])
def test_resume_honors_explicit_environment_overrides(
    harness_name: str,
    repo_root: Path,
    wire_api: str,
) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    metadata = models.load_model(repo_root, "example-model").public_metadata()
    restored = models.restore_model(
        repo_root,
        metadata,
        environment={
            "MODEL_CONTEXT_TOKENS": "128000",
            "MODEL_MAX_TOKENS": "4096",
            "MODEL_REASONING_EFFORT": "low",
            "MODEL_WIRE_API": wire_api,
        },
    )
    assert restored.context_tokens == 128_000
    assert restored.request.max_tokens == 4096
    assert restored.reasoning_effort.selected == "low"
    expected_path = (
        ("reasoning", "effort")
        if wire_api == "responses"
        else ("output_config", "effort")
    )
    assert restored.reasoning_effort.request_path == expected_path
    assert metadata["contextTokens"] == 1_000_000
    assert metadata["reasoningEffort"]["selected"] == "high"


def test_resume_rejects_unknown_protocol(harness_name: str, repo_root: Path) -> None:
    models = importlib.import_module(f"front_{harness_name}.models")
    metadata = models.load_model(repo_root, "example-model").public_metadata()
    with pytest.raises(ValueError, match="Unsupported wireApi"):
        models.restore_model(
            repo_root,
            metadata,
            environment={"MODEL_WIRE_API": "invalid"},
        )


@pytest.mark.parametrize("saved_task", [True, False])
@pytest.mark.parametrize("change", ["replace", "remove-prefix"])
def test_resume_rejects_changed_task_text(
    harness_name: str,
    repo_root: Path,
    saved_task: bool,
    change: str,
) -> None:
    runner = importlib.import_module(f"front_{harness_name}.runner")
    prepared = runner.prepare_run(
        repo_root,
        task_reference="001",
        model_name="example-model",
        run_id="changed-task",
    )
    original = prepared.task_path.read_text(encoding="utf-8")
    if not saved_task:
        (prepared.run_dir / "task.md").unlink()
    updated = (
        "Build a different page.\n"
        if change == "replace"
        else original.split("\n", 1)[1]
    )
    prepared.task_path.write_text(updated, encoding="utf-8")
    prepared.metadata["status"] = "failed"
    runner.write_metadata(prepared)

    with pytest.raises(ValueError, match="Task changed since source run"):
        runner.prepare_resume_run(repo_root, source_run=prepared.run_dir)


@pytest.mark.parametrize(
    "command_args",
    [
        ["run", "--task", "001", "--model", "example-model"],
        ["resume", "--source-run", "example-model/001/run-1"],
    ],
)
def test_model_cli_options_do_not_override_saved_or_environment_values_by_default(
    harness_name: str,
    command_args: list[str],
) -> None:
    cli = importlib.import_module(f"front_{harness_name}.cli")
    args = cli.build_parser().parse_args(command_args)
    assert args.context_tokens is None
    assert args.max_output_tokens is None
    assert args.reasoning_effort is None
    assert args.wire_api is None


@pytest.mark.parametrize("use_overrides", [False, True])
def test_native_dry_run_records_effective_generation_settings(
    harness_name: str,
    repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
    use_overrides: bool,
) -> None:
    cli = importlib.import_module(f"front_{harness_name}.cli")
    command = [
        "--repo-root",
        str(repo_root),
        "run",
        "--task",
        "001",
        "--model",
        "example-model",
        "--run-id",
        "settings-test",
        "--dry-run",
    ]
    step_option = "--max-steps" if harness_name == "opencode" else "--max-iterations"
    step_key = "maxSteps" if harness_name == "opencode" else "maxIterations"
    if use_overrides:
        (repo_root / ".env").write_text(
            "OPENAI_API_KEY=file-test-secret\n"
            "MODEL_CONTEXT_TOKENS=900000\nMODEL_MAX_TOKENS=16384\n"
            "MODEL_REASONING_EFFORT=high\nMODEL_WIRE_API=chat.completions\n"
        )
        monkeypatch.setenv("MODEL_CONTEXT_TOKENS", "800000")
        monkeypatch.setenv("MODEL_MAX_TOKENS", "4096")
        monkeypatch.setenv("MODEL_REASONING_EFFORT", "medium")
        monkeypatch.setenv("MODEL_WIRE_API", "anthropic.messages")
        command.extend(
            [
                "--context-tokens",
                "128000",
                "--max-output-tokens",
                "8192",
                "--reasoning-effort",
                "low",
                "--wire-api",
                "responses",
                step_option,
                "17",
            ]
        )
    assert cli.main(command) == 0
    output = json.loads(capsys.readouterr().out)
    raw_metadata = Path(output["metadata"]).read_text()
    assert "file-test-secret" not in raw_metadata
    metadata = json.loads(raw_metadata)
    model = metadata["model"]
    assert model["contextTokens"] == (128_000 if use_overrides else 1_000_000)
    assert model["request"]["maxTokens"] == (8192 if use_overrides else 32_768)
    assert model["reasoningEffort"]["selected"] == ("low" if use_overrides else "high")
    assert model["wireApi"] == ("responses" if use_overrides else "chat.completions")
    assert metadata["run"][step_key] == (17 if use_overrides else 500)
    if harness_name == "opencode":
        config_path = Path(output["runDir"]) / "config" / "opencode.json"
        config = json.loads(config_path.read_text())
        provider_model = config["provider"]["front-harness"]["models"]["example-model"]
        assert provider_model["limit"] == {
            "context": model["contextTokens"],
            "output": model["request"]["maxTokens"],
        }
        assert (
            provider_model["options"]["reasoningEffort"]
            == (model["reasoningEffort"]["selected"])
        )
        assert config["agent"]["build"]["steps"] == metadata["run"][step_key]

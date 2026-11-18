import os
import subprocess
from pathlib import Path

import pytest
from front_generation.models import load_environment

from front_openhands.models import load_model

RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run.sh"


@pytest.fixture
def isolated_environment(monkeypatch):
    for name in (
        "OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL_WIRE_API", "MODEL_MAX_TOKENS",
        "MODEL_CONTEXT_TOKENS", "MODEL_REASONING_EFFORT",
        "FRONT_ENV_FILE",
    ):
        monkeypatch.delenv(name, raising=False)


def test_native_environment_precedence(
    tmp_path: Path, monkeypatch, isolated_environment,
) -> None:
    (tmp_path / ".env").write_text(
        "OPENAI_API_KEY=root-secret\nMODEL_MAX_TOKENS=4096\n", encoding="utf-8",
    )
    (tmp_path / "candidate.env").write_text(
        "OPENAI_API_KEY=selected-secret\nMODEL_WIRE_API=responses\n", encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FRONT_ENV_FILE", "candidate.env")
    monkeypatch.setenv("OPENAI_API_KEY", "shell-secret")

    model = load_model(tmp_path, "test-model")

    assert model.api_key == "shell-secret"
    assert model.request.max_tokens == 4096
    assert model.wire_api == "responses"


def test_native_environment_uses_selected_file_credentials(
    tmp_path: Path, monkeypatch, isolated_environment,
) -> None:
    selected = tmp_path / "candidate.env"
    selected.write_text("OPENAI_API_KEY=selected-secret\n", encoding="utf-8")
    monkeypatch.setenv("FRONT_ENV_FILE", str(selected))

    assert load_environment(tmp_path)["OPENAI_API_KEY"] == "selected-secret"


def test_native_environment_rejects_missing_explicit_file(
    tmp_path: Path, monkeypatch, isolated_environment,
) -> None:
    (tmp_path / ".env").write_text("OPENAI_API_KEY=root-secret\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "shell-secret")
    monkeypatch.setenv("FRONT_ENV_FILE", str(tmp_path / "missing.env"))

    with pytest.raises(FileNotFoundError, match="Environment file not found"):
        load_environment(tmp_path)


def test_native_environment_accepts_shell_only_credentials(
    tmp_path: Path, monkeypatch, isolated_environment,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "shell-secret")

    assert load_model(tmp_path, "test-model").api_key == "shell-secret"


@pytest.fixture
def launcher(tmp_path: Path):
    repo_root = tmp_path / "repo"
    (repo_root / "data" / "tasks").mkdir(parents=True)
    binaries = tmp_path / "bin"
    binaries.mkdir()
    docker = binaries / "docker"
    docker.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n', encoding="utf-8")
    docker.chmod(0o755)
    environment = {
        "PATH": f"{binaries}:{os.environ.get('PATH', '')}",
        "HOME": str(tmp_path),
        "FRONT_REPO_ROOT": str(repo_root),
        "FRONT_ENV_FILE": "",
        "OPENHANDS_RUNS_ROOT": str(repo_root / "runs"),
        "OPENHANDS_SKIP_BUILD": "true",
        "OPENAI_API_KEY": "shell-secret",
    }

    def run(**overrides):
        return subprocess.run(
            ["bash", str(RUNNER), "--help"],
            cwd=tmp_path,
            env={**environment, **overrides},
            capture_output=True,
            text=True,
            timeout=10,
        )

    return repo_root, run


def test_launcher_rejects_missing_explicit_file_before_docker(launcher) -> None:
    repo_root, run = launcher
    (repo_root / ".env").write_text("OPENAI_API_KEY=root-secret\n", encoding="utf-8")

    result = run(FRONT_ENV_FILE=str(repo_root / "missing.env"))

    assert result.returncode != 0
    assert "Environment file not found" in result.stderr
    assert result.stdout == ""
    assert not (repo_root / "runs").exists()


def test_launcher_environment_precedence(launcher) -> None:
    repo_root, run = launcher
    base = repo_root / ".env"
    selected = repo_root.parent / "candidate.env"
    base.write_text("MODEL_MAX_TOKENS=4096\n", encoding="utf-8")
    selected.write_text("OPENAI_API_KEY=selected-secret\n", encoding="utf-8")

    result = run(FRONT_ENV_FILE=selected.name)

    assert result.returncode == 0, result.stderr
    arguments = result.stdout.splitlines()
    env_files = [
        arguments[index + 1]
        for index, argument in enumerate(arguments)
        if argument == "--env-file"
    ]
    assert env_files == [str(base), selected.name]
    assert arguments.index("OPENAI_API_KEY") > arguments.index(selected.name)
    assert "secret" not in result.stdout


def test_launcher_accepts_shell_only_credentials(launcher) -> None:
    _, run = launcher

    result = run()

    assert result.returncode == 0, result.stderr
    assert "--env-file" not in result.stdout
    assert "--env\nOPENAI_API_KEY\n" in result.stdout


def test_launcher_forwards_generation_environment_overrides(launcher) -> None:
    _, run = launcher
    overrides = {
        "MODEL_CONTEXT_TOKENS": "200000",
        "MODEL_MAX_TOKENS": "8192",
        "MODEL_REASONING_EFFORT": "low",
        "MODEL_WIRE_API": "responses",
    }
    result = run(**overrides)
    assert result.returncode == 0, result.stderr
    for variable in overrides:
        assert f"--env\n{variable}\n" in result.stdout

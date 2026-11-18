import os
import subprocess
from pathlib import Path

import pytest

RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run.sh"


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
        **os.environ,
        "PATH": f"{binaries}:{os.environ.get('PATH', '')}",
        "FRONT_REPO_ROOT": str(repo_root),
        "FRONT_ENV_FILE": "",
        "FRONT_TASKS_ROOT": str(repo_root / "data" / "tasks"),
        "OPENCODE_RUNS_ROOT": str(repo_root / "runs"),
        "OPENCODE_SKIP_BUILD": "true",
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


def test_launcher_rejects_missing_explicit_environment_before_docker(launcher) -> None:
    repo_root, run = launcher
    (repo_root / ".env").write_text("OPENAI_API_KEY=root-secret\n", encoding="utf-8")

    result = run(FRONT_ENV_FILE=str(repo_root / "missing.env"))

    assert result.returncode != 0
    assert "Environment file not found" in result.stderr
    assert result.stdout == ""
    assert not (repo_root / "runs").exists()


def test_launcher_loads_base_then_selected_then_shell(launcher) -> None:
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


def test_launcher_accepts_shell_credentials_without_environment_file(launcher) -> None:
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

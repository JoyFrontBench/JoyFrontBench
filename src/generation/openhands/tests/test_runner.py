import json
import os
import subprocess
import uuid
from pathlib import Path

import jsonschema
import pytest
from front_generation.paths import find_repo_root
from front_generation.tasks import resolve_task, task_key

from front_openhands.runner import (
    DEFAULT_PLAYWRIGHT_VERSION,
    _build_agent_prompt,
    _playwright_runtime_instructions,
    _validate_completed_run,
    mark_dry_run,
    prepare_resume_run,
    prepare_run,
    write_metadata,
)

REPO_ROOT = find_repo_root()


def test_prepare_run_uses_the_empty_mounted_directory(
    tmp_path: Path, monkeypatch,
) -> None:
    run_dir = tmp_path / "chat_model/001/mounted"
    run_dir.mkdir(parents=True)
    monkeypatch.setenv("FRONT_RUN_DIR", str(run_dir))

    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="mounted",
        environment={"OPENAI_API_KEY": "secret-value"},
    )

    assert prepared.run_dir == run_dir
    assert prepared.workspace.is_dir()
    assert (run_dir / "metadata.json").is_file()


def test_task_id_resolves_to_markdown() -> None:
    task = resolve_task(REPO_ROOT, "001")
    assert task.name == "joyfrontbench-001.md"
    assert task.suffix == ".md"
    assert task_key(task) == "001"


def test_dry_run_metadata_matches_schema(tmp_path: Path) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="test-run",
        max_iterations=25,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    metadata = mark_dry_run(prepared)
    schema = json.loads(
        (
            REPO_ROOT / "src" / "generation"
            / "openhands"
            / "schemas"
            / "run-metadata.schema.json"
        ).read_text(encoding="utf-8")
    )

    jsonschema.validate(metadata, schema)
    assert metadata["status"] == "dry-run"
    assert metadata["schemaVersion"] == 2
    assert metadata["model"]["contextTokens"] == prepared.model.context_tokens
    assert (
        metadata["model"]["request"]["maxTokens"] == prepared.model.request.max_tokens
    )
    assert metadata["model"]["enabled"] is True
    assert metadata["model"]["request"]["maxTokensField"] == "max_tokens"
    assert metadata["model"]["reasoningEffort"]["selected"] == "high"
    assert metadata["runtime"]["playwrightVersion"] == DEFAULT_PLAYWRIGHT_VERSION
    assert (prepared.run_dir / "prompt.md").is_file()
    assert prepared.workspace.is_dir()
    assert "secret-value" not in (
        prepared.run_dir / "metadata.json"
    ).read_text(encoding="utf-8")


def test_completed_run_requires_workspace_output(tmp_path: Path) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="empty-completed-run",
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    prepared.metadata["status"] = "completed"

    _validate_completed_run(prepared)

    assert prepared.metadata["status"] == "failed"
    assert prepared.metadata["error"]["type"] == "IncompleteAgentRun"
    assert prepared.metadata["validation"] == {"workspaceFiles": 0}


def test_agent_prompt_enforces_playwright_runtime() -> None:
    task_prompt = "Create the requested application."
    prompt = _build_agent_prompt(task_prompt)

    assert prompt.startswith("Playwright runtime contract:")
    assert f"exact version {DEFAULT_PLAYWRIGHT_VERSION}" in prompt
    assert "front-playwright-check ." in prompt
    assert "Do not run `playwright install`" in prompt
    assert prompt.endswith(task_prompt)


def test_playwright_version_matches_shared_build_contract() -> None:
    expected = (
        REPO_ROOT / "src" / "generation" / "playwright-version.txt"
    ).read_text(encoding="utf-8").strip()

    assert DEFAULT_PLAYWRIGHT_VERSION == expected
    assert expected in _playwright_runtime_instructions()
    assert (
        f"ARG PLAYWRIGHT_VERSION={expected}"
        in (REPO_ROOT / "src" / "generation" / "openhands" / "Dockerfile").read_text(
            encoding="utf-8"
        )
    )


def test_saved_task_excludes_runtime_protocol(tmp_path: Path) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="saved-task-run",
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    task_text = prepared.task_path.read_text(encoding="utf-8")

    assert (prepared.run_dir / "task.md").read_text(encoding="utf-8") == task_text
    assert set(prepared.metadata["task"]) == {"id", "path"}
    assert prepared.prompt != task_text
    assert prepared.prompt.endswith(task_text)


@pytest.mark.parametrize("saved_task", [True, False])
def test_resume_reuses_conversation_without_resetting_iteration_budget(
    tmp_path: Path,
    saved_task: bool,
) -> None:
    source = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="reasoning_chat_model",
        runs_root=tmp_path,
        run_id="rate-limited-run",
        max_iterations=500,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    if not saved_task:
        (source.run_dir / "task.md").unlink()
    source.metadata["status"] = "failed"
    source.metadata["error"] = {
        "type": "ConversationRunError",
        "message": "rate limited",
    }
    source.metadata["completedAt"] = "2026-08-13T23:20:50Z"
    source.metadata["durationSeconds"] = 3904.655
    write_metadata(source)

    conversation_id = uuid.uuid4()
    conversation_dir = source.persistence_dir / conversation_id.hex
    events_dir = conversation_dir / "events"
    events_dir.mkdir(parents=True)
    (conversation_dir / "base_state.json").write_text(
        json.dumps({"id": str(conversation_id)}),
        encoding="utf-8",
    )
    for index, response_id in enumerate(("response-1", "response-2")):
        (events_dir / f"event-{index:05d}-test.json").write_text(
            json.dumps(
                {
                    "source": "agent",
                    "llm_response_id": response_id,
                }
            ),
            encoding="utf-8",
        )

    resumed, restored_id, remaining = prepare_resume_run(
        REPO_ROOT,
        source_run=source.run_dir,
        runs_root=tmp_path,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )

    assert resumed.run_dir == source.run_dir
    assert resumed.workspace == source.workspace
    assert restored_id == conversation_id
    assert remaining == 498
    assert resumed.metadata["run"]["maxIterations"] == 500
    assert resumed.metadata["resume"]["conversationId"] == str(conversation_id)
    assert resumed.metadata["resume"]["attempts"][-1]["usedIterations"] == 2
    assert resumed.metadata["resume"]["attempts"][-1]["remainingIterations"] == 498


def test_resume_rejects_completed_run(tmp_path: Path) -> None:
    source = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="completed-run",
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    source.metadata["status"] = "completed"
    write_metadata(source)

    with pytest.raises(ValueError, match="Cannot resume"):
        prepare_resume_run(
            REPO_ROOT,
            source_run=source.run_dir,
            runs_root=tmp_path,
            environment={
                "OPENAI_API_KEY": "secret-value",
                "TEST_MODEL_ENABLED": "true",
            },
        )


def test_playwright_checker_rejects_dependency_ranges(tmp_path: Path) -> None:
    browser_root = tmp_path / "browsers"
    browser_root.mkdir()
    (browser_root / ".docker-info").write_text(
        json.dumps({"driverVersion": DEFAULT_PLAYWRIGHT_VERSION}),
        encoding="utf-8",
    )
    project = tmp_path / "project"
    project.mkdir()
    package_json = project / "package.json"
    package_json.write_text(
        json.dumps(
            {
                "devDependencies": {
                    "@playwright/test": DEFAULT_PLAYWRIGHT_VERSION,
                }
            }
        ),
        encoding="utf-8",
    )
    command = [
        "bash",
        str(
            REPO_ROOT / "src" / "generation"
            / "scripts"
            / "front-playwright-check.sh"
        ),
        str(project),
    ]
    environment = {
        **os.environ,
        "FRONT_PLAYWRIGHT_VERSION": DEFAULT_PLAYWRIGHT_VERSION,
        "PLAYWRIGHT_BROWSERS_PATH": str(browser_root),
    }

    accepted = subprocess.run(
        command,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert accepted.returncode == 0

    package_json.write_text(
        json.dumps(
            {
                "devDependencies": {
                    "@playwright/test": f"^{DEFAULT_PLAYWRIGHT_VERSION}",
                }
            }
        ),
        encoding="utf-8",
    )
    rejected = subprocess.run(
        command,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert rejected.returncode == 1
    assert f"must be exactly {DEFAULT_PLAYWRIGHT_VERSION}" in rejected.stderr

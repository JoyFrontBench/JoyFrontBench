import json
from pathlib import Path
from typing import Any

import pytest
from front_generation.paths import find_repo_root
from front_generation.tasks import resolve_task, task_key

REPO_ROOT = find_repo_root()
PROMPTS_ROOT = REPO_ROOT / "data"
QUESTIONS = json.loads((PROMPTS_ROOT / "dataset.json").read_text(encoding="utf-8"))[
    "questions"
]


def test_repository_root_from_arbitrary_working_directory(tmp_path, monkeypatch):
    monkeypatch.delenv("FRONT_REPO_ROOT", raising=False)
    monkeypatch.chdir(tmp_path)

    assert find_repo_root() == REPO_ROOT


@pytest.mark.parametrize("question", QUESTIONS, ids=lambda question: question["id"])
def test_release_tasks_match_dataset(question: dict[str, Any]) -> None:
    reference = f"{question['number']:03d}"
    expected = PROMPTS_ROOT / question["prompt_file"]

    assert question["id"] == f"frontenjoyai-{reference}"
    assert expected.name == f"joyfrontbench-{reference}.md"
    assert resolve_task(REPO_ROOT, reference) == expected
    assert resolve_task(REPO_ROOT, question["id"]) == expected
    assert resolve_task(REPO_ROOT, expected.stem) == expected
    assert resolve_task(REPO_ROOT, expected.name) == expected
    assert task_key(expected) == reference


@pytest.mark.parametrize(
    "reference", ["031", "094", "frontenjoyai-031", "joyfrontbench-031"]
)
def test_unpublished_task_ids_are_not_available(reference: str) -> None:
    with pytest.raises(FileNotFoundError, match="Task not found"):
        resolve_task(REPO_ROOT, reference)


@pytest.mark.parametrize(
    "reference", ["001", "joyfrontbench-001", "frontenjoyai-001", "joyfrontbench-001.md"]
)
def test_task_resolution_only_requires_prompts(tmp_path: Path, reference: str) -> None:
    tasks_root = tmp_path / "data" / "tasks"
    tasks_root.mkdir(parents=True)
    expected = tasks_root / "joyfrontbench-001.md"
    expected.write_text("Build a page.\n", encoding="utf-8")

    assert resolve_task(tmp_path, reference) == expected
    assert task_key(expected) == "001"


def test_legacy_task_filename_still_resolves(tmp_path: Path) -> None:
    tasks_root = tmp_path / "data" / "tasks"
    tasks_root.mkdir(parents=True)
    expected = tasks_root / "frontenjoyai-001.md"
    expected.write_text("Build a page.\n", encoding="utf-8")

    assert resolve_task(tmp_path, "001") == expected
    assert resolve_task(tmp_path, "frontenjoyai-001") == expected
    assert task_key(expected) == "001"


def test_question_number_rejects_ambiguous_prompts(tmp_path: Path) -> None:
    tasks_root = tmp_path / "data" / "tasks"
    tasks_root.mkdir(parents=True)
    for filename in ("joyfrontbench-001.md", "001-custom.md"):
        (tasks_root / filename).write_text("Build a page.\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Ambiguous task reference"):
        resolve_task(tmp_path, "001")


def test_repo_discovery_uses_release_layout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tasks_root = tmp_path / "data" / "tasks"
    tasks_root.mkdir(parents=True)
    monkeypatch.delenv("FRONT_REPO_ROOT", raising=False)
    monkeypatch.chdir(tasks_root)

    assert find_repo_root(tmp_path) == tmp_path
    assert find_repo_root() == tmp_path

from pathlib import Path

import pytest
from front_generation.paths import create_run_directory


def test_native_run_creates_a_new_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("FRONT_RUN_DIR", raising=False)
    run_dir = tmp_path / "model/001/run"

    create_run_directory(run_dir)

    assert run_dir.is_dir()
    with pytest.raises(FileExistsError, match="already exists"):
        create_run_directory(run_dir)


def test_mounted_run_accepts_only_an_empty_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRONT_RUN_DIR", str(tmp_path))

    create_run_directory(tmp_path)
    artifact = tmp_path / "metadata.json"
    artifact.write_text("saved", encoding="utf-8")

    with pytest.raises(FileExistsError, match="already exists"):
        create_run_directory(tmp_path)
    assert artifact.read_text(encoding="utf-8") == "saved"


def test_run_cannot_escape_the_selected_mount(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRONT_RUN_DIR", str(tmp_path / "mounted"))
    run_dir = tmp_path / "other"

    with pytest.raises(ValueError, match="does not match"):
        create_run_directory(run_dir)
    assert not run_dir.exists()
